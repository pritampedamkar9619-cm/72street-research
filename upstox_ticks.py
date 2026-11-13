"""Live tick recorder on the Upstox market-data websocket (v3, full mode), plus option-chain snapshots.

Subscribes to, for every F&O underlying: the cash stock, its near-month future (and next month in the last
week of the series); the main indices and India VIX; NIFTY and BANKNIFTY options of the nearest expiry within
about 6% of spot; and nearest-expiry options of RELIANCE, HDFCBANK, ICICIBANK, INFY and SBIN within 15%.
Every update the exchange sends for these is written down.

    python upstox_ticks.py         # runs until 15:40 India time, reconnecting on any drop

data/ticks/YYYY-MM-DD/keys.json            {id: [instrument_key, label]}
data/ticks/YYYY-MM-DD/ticks_HH.jsonl.gz    one line per update:
    [recv_ms, id, ltp, ltt_ms, ltq, vtt, oi, iv, delta, bid, bid_qty, ask, ask_qty, tbq, tsq, atp]   (index lines: [recv_ms, id, ltp, ltt_ms])
data/ticks/YYYY-MM-DD/chains/SYM.jsonl.gz  option-chain snapshots: NIFTY/BANKNIFTY every minute (2 expiries), every F&O stock every 10 minutes
data/ticks/YYYY-MM-DD/minutes.json        1-minute candles of every F&O stock and index since 9:15, rewritten every 15 seconds
    {"day", "ts", "pc": {sym: previous close}, "m": {sym: [[t, o, h, l, c, v, vwap], ...]}}   (the Live F&O page reads this)
data/ is not in git."""
import asyncio, gzip, json, os, sys, threading, time, traceback
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import upstox_api as U
from upstox_client.feeder.proto import MarketDataFeedV3_pb2 as pb

BASE = os.path.join(ROOT, "data", "ticks")
OPT_STOCKS = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "SBIN"]
END_MIN = 15 * 60 + 40
STATE = {"msgs": 0, "rows": 0, "keys": 0, "connected": False, "last": None, "chains": 0, "errors": 0}


def mins():
    n = datetime.now(); return n.hour * 60 + n.minute


def day_dir():
    p = os.path.join(BASE, datetime.now().strftime("%Y-%m-%d")); os.makedirs(os.path.join(p, "chains"), exist_ok=True); return p


def build_subs():
    ins = U.instruments()
    uni = U.universe(ins)
    labels = {}
    for s, k in U.INDICES.items():
        labels[k] = s
    for s, x in uni.items():
        if x["type"] == "EQUITY" and x["eq"]:
            labels[x["eq"]] = s
        futs = x["futs"][:2] if x["futs"] and x["futs"][0][0] / 1000 - time.time() < 8 * 86400 else x["futs"][:1]
        for e, k in futs:
            labels[k] = f"{s} FUT {datetime.fromtimestamp(e / 1000):%d%b}".upper()
    spot = U.ltp([U.INDICES["NIFTY"], U.INDICES["BANKNIFTY"]] + [uni[s]["eq"] for s in OPT_STOCKS if s in uni])
    for s, band in [("NIFTY", .06), ("BANKNIFTY", .06)] + [(s, .15) for s in OPT_STOCKS]:
        sp = spot.get(U.INDICES.get(s) or uni.get(s, {}).get("eq"))
        if not sp:
            continue
        exp, rows = U.options(ins, s)
        for k, t, key in rows:
            if abs(k / sp - 1) <= band:
                labels[key] = f"{s} {datetime.fromtimestamp(exp / 1000):%d%b} {k:g} {t}".upper()
    return labels, uni, ins


class Minutes:
    """1-minute candles of the cash stocks and indices, built from the ticks; the minutes before the recorder
    started come from Upstox's intraday candles, so the day is complete from 9:15."""
    def __init__(self, labels):
        self.syms = {k: v for k, v in labels.items() if k.startswith("NSE_EQ") or k.startswith("NSE_INDEX")}
        self.m, self.pc, self.vtt, self.start = {}, {}, {}, int(time.time() // 60 * 60)
        self.lock = threading.Lock()

    def backfill(self):
        n = 0
        for k, sym in self.syms.items():
            try:
                bars = U.candles_1m_today(k)
            except Exception:
                continue
            with self.lock:
                book = self.m.setdefault(sym, {})
                for t, o, h, l, c, v, _ in bars:
                    if t < self.start and t not in book:
                        book[t] = [t, o, h, l, c, v, None]
            n += 1
        print(f"backfilled {n} symbols' minutes before {datetime.fromtimestamp(self.start):%H:%M}", flush=True)

    def tick(self, key, ltp, ltt, vtt=None, atp=None, cp=None):
        sym = self.syms.get(key)
        if not sym or not ltp:
            return
        if cp:
            self.pc[sym] = cp
        t = int((ltt or time.time() * 1000) // 60000 * 60)
        if t < self.start:
            return
        with self.lock:
            book = self.m.setdefault(sym, {})
            b = book.get(t)
            dv = 0
            if vtt:
                last = self.vtt.get(key)
                dv = max(0, vtt - last) if last is not None else 0
                self.vtt[key] = vtt
            if b is None:
                book[t] = [t, ltp, ltp, ltp, ltp, dv, atp or None]
            else:
                b[2] = max(b[2], ltp); b[3] = min(b[3], ltp); b[4] = ltp; b[5] += dv
                if atp: b[6] = atp

    def save(self):
        with self.lock:
            out = {"day": datetime.now().strftime("%Y-%m-%d"), "ts": time.time(), "pc": dict(self.pc),
                   "m": {s: [book[t] for t in sorted(book)] for s, book in self.m.items()}}
        p = os.path.join(day_dir(), "minutes.json")
        json.dump(out, open(p + ".tmp", "w"), separators=(",", ":"))
        os.replace(p + ".tmp", p)


MIN = None


class Writer:
    def __init__(self, labels):
        self.d = day_dir()
        kp = os.path.join(self.d, "keys.json")
        old = json.load(open(kp)) if os.path.exists(kp) else {}
        self.ids = {v[0]: int(i) for i, v in old.items()}
        for k, lab in labels.items():
            if k not in self.ids:
                self.ids[k] = len(self.ids)
        json.dump({i: [k, labels.get(k, k)] for k, i in self.ids.items()}, open(kp, "w"))
        self.buf, self.lock = [], threading.Lock()

    def add(self, row):
        with self.lock:
            self.buf.append(row)

    def flush(self):
        with self.lock:
            rows, self.buf = self.buf, []
        if not rows:
            return
        p = os.path.join(self.d, f"ticks_{datetime.now():%H}.jsonl.gz")
        with gzip.open(p, "at", encoding="utf8") as f:          # appended gzip members read back as one stream
            f.write("\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n")
        STATE["rows"] += len(rows)


def decode(msg, w):
    r = pb.FeedResponse(); r.ParseFromString(msg)
    now = int(time.time() * 1000)
    STATE["msgs"] += 1
    for key, f in r.feeds.items():
        i = w.ids.get(key)
        if i is None:
            continue
        if f.HasField("fullFeed"):
            ff = f.fullFeed
            if ff.HasField("indexFF"):
                lt = ff.indexFF.ltpc
                w.add([now, i, lt.ltp, int(lt.ltt)])
                if MIN: MIN.tick(key, lt.ltp, lt.ltt, cp=lt.cp)
            else:
                m = ff.marketFF
                lt = m.ltpc
                q = m.marketLevel.bidAskQuote[0] if len(m.marketLevel.bidAskQuote) else None
                w.add([now, i, lt.ltp, int(lt.ltt), int(lt.ltq), int(m.vtt), m.oi, round(m.iv, 4),
                       round(m.optionGreeks.delta, 4) if m.HasField("optionGreeks") else None,
                       q.bidP if q else None, int(q.bidQ) if q else None, q.askP if q else None, int(q.askQ) if q else None,
                       m.tbq, m.tsq, m.atp])
                if MIN: MIN.tick(key, lt.ltp, lt.ltt, int(m.vtt), m.atp, lt.cp)
        elif f.HasField("ltpc"):
            w.add([now, i, f.ltpc.ltp, int(f.ltpc.ltt)])
            if MIN: MIN.tick(key, f.ltpc.ltp, f.ltpc.ltt, cp=f.ltpc.cp)


async def stream(labels):
    import websockets
    w = Writer(labels)
    STATE["keys"] = len(labels)
    keys = list(labels)
    while mins() < END_MIN:
        try:
            uri = U.get("/v3/feed/market-data-feed/authorize")["data"]["authorized_redirect_uri"]
            async with websockets.connect(uri, max_size=None, ping_interval=20, ping_timeout=20) as ws:
                STATE["connected"] = True
                for j in range(0, len(keys), 500):
                    await ws.send(json.dumps({"guid": f"s{j}", "method": "sub", "data": {"mode": "full", "instrumentKeys": keys[j:j + 500]}}).encode())
                last = time.time()
                while mins() < END_MIN:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=5)
                        if isinstance(msg, bytes):
                            decode(msg, w)
                            STATE["last"] = datetime.now().strftime("%H:%M:%S")
                    except asyncio.TimeoutError:
                        pass
                    if time.time() - last > 5:
                        w.flush(); last = time.time()
        except Exception:
            STATE["connected"] = False; STATE["errors"] += 1
            traceback.print_exc()
            w.flush()
            await asyncio.sleep(5)
    w.flush()
    STATE["connected"] = False


def chain_row(r):
    c, p = r.get("call_options", {}), r.get("put_options", {})
    cm, pm, cg, pg = c.get("market_data", {}), p.get("market_data", {}), c.get("option_greeks", {}), p.get("option_greeks", {})
    return [r["strike_price"], cm.get("oi"), cm.get("prev_oi"), cm.get("ltp"), cm.get("volume"), cg.get("iv"), cg.get("delta"),
            pm.get("oi"), pm.get("prev_oi"), pm.get("ltp"), pm.get("volume"), pg.get("iv"), pg.get("delta")]


def snap_chain(sym, key, ins, n_exp):
    now = time.time() * 1000
    exps = sorted({d["expiry"] for d in ins if d.get("segment") == "NSE_FO" and d.get("instrument_type") == "CE"
                   and d.get("underlying_symbol") == sym and d.get("expiry", 0) > now})[:n_exp]
    line = {"t": int(time.time()), "spot": None, "exp": {}}
    for e in exps:
        ex = datetime.fromtimestamp(e / 1000).strftime("%Y-%m-%d")
        rows = U.chain(key, ex)
        if rows:
            line["spot"] = line["spot"] or rows[0].get("underlying_spot_price")
            line["exp"][ex] = [chain_row(r) for r in rows]
    if line["exp"]:
        with gzip.open(os.path.join(day_dir(), "chains", f"{sym}.jsonl.gz"), "at", encoding="utf8") as f:
            f.write(json.dumps(line, separators=(",", ":")) + "\n")
        STATE["chains"] += 1


def chains_loop(uni, ins):
    """Chain row: [strike, ce_oi, ce_prev_oi, ce_ltp, ce_vol, ce_iv, ce_delta, pe_oi, pe_prev_oi, pe_ltp, pe_vol, pe_iv, pe_delta]"""
    stocks = sorted(s for s, x in uni.items() if x["type"] == "EQUITY")
    tick = 0
    while 555 <= mins() < 931:
        t0 = time.time()
        for s in ("NIFTY", "BANKNIFTY"):
            try:
                snap_chain(s, U.INDICES[s], ins, 2)
            except Exception:
                STATE["errors"] += 1; traceback.print_exc()
        if tick % 10 == 0:                       # every F&O stock, spread over the minute
            for s in stocks:
                try:
                    snap_chain(s, uni[s]["eq"], ins, 1)
                except Exception:
                    STATE["errors"] += 1
        tick += 1
        time.sleep(max(1, 60 - (time.time() - t0)))


def status_loop():
    p = os.path.join(BASE, "status.json")
    while True:
        try:
            if MIN: MIN.save()
        except Exception:
            traceback.print_exc()
        try:
            os.makedirs(BASE, exist_ok=True)
            json.dump({**STATE, "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}, open(p, "w"))
        except Exception:
            pass
        time.sleep(15)


def main():
    global MIN
    if not U.token_ok():
        print("Upstox token missing or expired: put today's UPSTOX_ACCESS_TOKEN in data/upstox.env"); return
    labels, uni, ins = build_subs()
    print(f"subscribing to {len(labels)} instruments", flush=True)
    MIN = Minutes(labels)
    threading.Thread(target=MIN.backfill, daemon=True).start()
    threading.Thread(target=status_loop, daemon=True).start()
    threading.Thread(target=chains_loop, args=(uni, ins), daemon=True).start()
    asyncio.run(stream(labels))
    print(f"done: {STATE}", flush=True)


if __name__ == "__main__":
    main()
