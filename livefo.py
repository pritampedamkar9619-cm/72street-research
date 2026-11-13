"""Live F&O: every F&O stock's day so far, refreshed every two minutes in market hours.

Per stock: the path since 9:15, the move against its usual day, whether the move was
one-sided, VWAP, and the futures OI change (all expiries added, from server.futures_buildup).

Clean-move score = (last price - open) / usual daily range, and it counts only when the day
has gone one way: the distance travelled on one side of the open is more than twice the
other side. Choppy days score zero. Usual range = average high-low of the last ~34 sessions.

Describes what happened. No entries, stops, targets or picks."""
import json, os, time, threading
import numpy as np
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data", "livefo.json")
STATE = {"ts": 0, "rows": {}, "paths": {}, "c5": {}, "s5": {}, "snow": {}, "prof": {}, "session": None, "last_bar": None, "source": None, "busy": False}
LOCK = threading.Lock()
SLOTS = 75                                   # 5 minute slots from 9:15 to 15:30
BUCKETS = [(-99, -4), (-4, -2), (-2, -1), (-1, 0), (0, 1), (1, 2), (2, 4), (4, 99)]
OI_WORDS = {"long_buildup": "Long buildup", "short_buildup": "Short buildup",
            "short_covering": "Short covering", "long_unwinding": "Long unwinding"}


def _nice_step(raw):
    k = 10 ** __import__("math").floor(__import__("math").log10(raw)) if raw > 0 else 0.05
    for m in (1, 2, 2.5, 5, 10):
        if m * k >= raw:
            return max(0.05, round(m * k, 4))
    return max(0.05, 10 * k)


def profile(tp, v, lo, hi, n=30):
    """Volume at price for the day: each 1-minute candle's volume at its typical price, in about n price steps.
    poc: the most traded price. va: the band, built outward from it, holding 70% of the volume."""
    if hi <= lo or v.sum() <= 0:
        return None
    step = _nice_step((hi - lo) / n)
    k = np.round(tp / step).astype(np.int64)
    keys, inv = np.unique(k, return_inverse=True)
    sums = np.bincount(inv, weights=v)
    keep = sums > 0
    if not keep.any():
        return None
    px_ = [round(float(x) * step, 2) for x in keys[keep]]
    vs = [float(x) for x in sums[keep]]
    i = j = max(range(len(vs)), key=vs.__getitem__)
    acc, tot = vs[i], sum(vs)
    while acc < 0.7 * tot and (i > 0 or j < len(vs) - 1):
        a = vs[i - 1] if i > 0 else -1
        b = vs[j + 1] if j < len(vs) - 1 else -1
        if b >= a: j += 1; acc += vs[j]
        else: i -= 1; acc += vs[i]
    return {"step": step, "rows": [[p, round(x)] for p, x in zip(px_, vs)], "poc": px_[max(range(len(vs)), key=vs.__getitem__)],
            "va": [px_[i], px_[j]]}


def _agg5(ts, O, H, L, C, V, mask):
    """1-minute arrays (time order) to 5-minute candles: start time, open, high, low, close, volume."""
    ts, O, H, L, C, V = ts[mask], O[mask], H[mask], L[mask], C[mask], V[mask]
    if not len(ts):
        return [], [], [], [], [], []
    b = ts - ts % 300
    t5, first = np.unique(b, return_index=True)
    last = np.r_[first[1:] - 1, len(b) - 1]
    return (t5, O[first], np.maximum.reduceat(H, first), np.minimum.reduceat(L, first), C[last], np.add.reduceat(V, first))


def _slot(ts):
    return (ts.hour * 60 + ts.minute - 555) // 5


def _oi_kind(pchg, oi_pchg):
    if oi_pchg is None or abs(oi_pchg) < 2:
        return None
    if oi_pchg > 0:
        return "long_buildup" if pchg >= 0 else "short_buildup"
    return "short_covering" if pchg >= 0 else "long_unwinding"


def line_for(r):
    """One plain sentence on the move. Describes, never advises."""
    x = r.get("score") or 0
    side = "up" if r["last"] >= r["open"] else "down"
    if x:
        s = f"{'Up' if x > 0 else 'Down'} {abs(x):.1f}× its usual day's range from the open, almost all one way."
    elif r.get("usual") and abs(r["last"] - r["open"]) < 0.3 * r["usual"]:
        s = "Close to where it opened. No clear direction yet."
    else:
        s = f"{'Up' if side == 'up' else 'Down'} from the open, but it has swung both ways."
    k = r.get("oi_kind")
    if k:
        s += f" Futures: {OI_WORDS[k].lower()}, OI {'+' if r['oi_pchg'] > 0 else '−'}{abs(r['oi_pchg']):.1f}%."
    if r.get("vwap"):
        s += f" Trading {'above' if r['last'] >= r['vwap'] else 'below'} VWAP."
    return s


UPSTOX_MIN = os.path.join(ROOT, "data", "ticks")


_PREV = {}


def _prev_session(sym, before):
    """The last saved session before `before` (a date string) of 1-minute candles: Upstox history first, then Yahoo's store.
    Read once a day per stock: the history files are large."""
    if (sym, before) not in _PREV:
        _PREV[(sym, before)] = _prev_session_read(sym, before)
    return _PREV[(sym, before)]


_PREV_DAY = {}


def _prev_session_read(sym, before):
    """Small files only: the recorder's own minute file for the previous day, else the 7-day store
    (data/intraday/1m, saved each evening). The 2-year Upstox history is far too large to read on every start."""
    if before not in _PREV_DAY:
        _PREV_DAY[before] = None
        days = sorted(d for d in os.listdir(UPSTOX_MIN) if d < before and os.path.exists(os.path.join(UPSTOX_MIN, d, "minutes.json"))) if os.path.isdir(UPSTOX_MIN) else []
        if days:
            try:
                _PREV_DAY[before] = json.load(open(os.path.join(UPSTOX_MIN, days[-1], "minutes.json")))["m"]
            except Exception:
                pass
    rec = _PREV_DAY[before]
    if rec and rec.get(sym):
        return rec[sym]
    try:
        book = json.load(open(os.path.join(ROOT, "data", "intraday", "1m", f"{sym}.json"), encoding="utf8"))
        days = [d for d in book if d < before]
        return book[max(days)] if days else []
    except Exception:
        return []


def upstox_frames(fno_syms, max_age=180):
    """Today's 1-minute candles from the Upstox recorder (data/ticks/DAY/minutes.json), as pandas frames with the
    previous session in front (for 5-minute structure). None if the recorder is not running today."""
    import pandas as pd
    day = datetime.now().strftime("%Y-%m-%d")
    p = os.path.join(UPSTOX_MIN, day, "minutes.json")
    if not os.path.exists(p) or time.time() - os.path.getmtime(p) > max_age:
        return None
    try:
        book = json.load(open(p))
    except Exception:
        return None
    frames = {}
    for sym in fno_syms:
        today = book["m"].get(sym)
        if not today:
            continue
        bars = [b[:6] for b in _prev_session(sym, day)] + [b[:6] for b in today]
        d = pd.DataFrame(bars, columns=["t", "Open", "High", "Low", "Close", "Volume"])
        d.index = pd.DatetimeIndex(pd.to_datetime(d.pop("t"), unit="s", utc=True)).tz_convert("Asia/Kolkata")
        frames[sym] = (d, book["pc"].get(sym))
    return frames if len(frames) > 100 else None


IDX = [("NIFTY", "Nifty 50"), ("BANKNIFTY", "Bank Nifty"), ("FINNIFTY", "Fin Nifty"), ("INDIAVIX", "India VIX")]


def indices():
    """Index strip for the terminal from the recorder's minute file: last, change and the 5-minute path since 9:15."""
    try:                                   # today's file, or the last session's after hours and on holidays
        days = sorted(d for d in os.listdir(UPSTOX_MIN) if os.path.exists(os.path.join(UPSTOX_MIN, d, "minutes.json")))
        book = json.load(open(os.path.join(UPSTOX_MIN, days[-1], "minutes.json")))
    except Exception:
        return []
    out = []
    for sym, name in IDX:
        m, pc = book["m"].get(sym), book["pc"].get(sym)
        if not m or not pc:
            continue
        path = [None] * SLOTS
        for t, o, h, l, c, *_ in m:
            sl = ((t + 19800) % 86400 // 60 - 555) // 5
            if 0 <= sl < SLOTS:
                path[sl] = round((c / pc - 1) * 100, 2)
        out.append({"sym": sym, "name": name, "last": m[-1][4], "chg": round((m[-1][4] / pc - 1) * 100, 2), "path": path})
    return out


def build(fno_syms, uni, sectors, futrows, log=print):
    """One refresh. fno_syms: F&O stock symbols. uni: universe rows (prev close, usual range).
    sectors: sym -> sector. futrows: sym -> {oi_pchg, oi_chg} live futures OI, all expiries.
    Prices: the Upstox recorder's live 1-minute candles when it is running, else Yahoo's delayed ones."""
    import pandas as pd
    if STATE["busy"]:
        return
    STATE["busy"] = True
    try:
        t0 = time.time()
        frames, source = upstox_frames(fno_syms), "Upstox live 1 minute"
        if frames is None:
            import yfinance as yf
            source = "yahoo 1 minute"
            df = yf.download([s + ".NS" for s in fno_syms], period="2d", interval="1m", group_by="ticker", auto_adjust=False,
                             progress=False, threads=True)
            if df is None or df.empty:
                return
            frames = {}
            for sym in fno_syms:
                try:
                    d = df[sym + ".NS"].dropna(subset=["Close"])
                    if getattr(d.index, "tz", None) is not None:
                        d = d.tz_convert("Asia/Kolkata")          # the 9:15 cut below is India time, whatever the server clock
                    frames[sym] = (d, None)
                except KeyError:
                    continue
        rows, paths, c5, s5, prof = {}, {}, {}, {}, {}
        last_bar = None
        for sym, (d, pc) in frames.items():
            if d.empty:
                continue
            ts = d.index.as_unit("s").asi8                              # epoch seconds, whatever unit pandas chose; India is +5:30, a whole number of 5-minute steps
            loc = ts + 19800
            mins, dayno = (loc % 86400) // 60, loc // 86400
            O, H, L, C = (d[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
            V = np.nan_to_num(d["Volume"].to_numpy(float))
            ok = ~np.isnan(C)
            try:                                             # two sessions of 5-minute candles, for intraday structure
                g = _agg5(ts, O, H, L, C, V, ok & (mins >= 555) & (mins < 930))
                s5[sym] = [{"t": int(t), "o": round(a, 2), "h": round(b, 2), "l": round(c_, 2), "c": round(e, 2), "v": float(f_)} for t, a, b, c_, e, f_ in zip(*g)]
            except Exception:
                pass
            today = dayno[ok][-1]
            past = ok & (dayno < today)
            prev_own = float(C[past][-1]) if past.any() else None      # yesterday's last price, from this same download
            m = ok & (dayno == today) & (mins >= 555)                  # 9:15 onward
            if not m.any():
                continue
            day = d.index[m][-1].date()
            u = uni.get(sym) or {}
            prev = pc or prev_own or (u.get("prev") if u.get("asof") == day.isoformat() else u.get("last"))
            usual = u.get("adr")
            if not prev:
                continue
            o_, h_, l_, c_, v_ = O[m], H[m], L[m], C[m], V[m]
            o, h, l, last = float(o_[0]), float(h_.max()), float(l_.min()), float(c_[-1])
            tp = (h_ + l_ + c_) / 3
            vwap = float((tp * v_).sum() / v_.sum()) if v_.sum() > 0 else None
            try:
                pf = profile(tp, v_, l, h)
                if pf:
                    prof[sym] = pf
            except Exception:
                pass
            up, dn = h - o, o - l
            score = 0.0
            if usual and usual > 0:
                if up > 2 * dn and last > o:
                    score = (last - o) / usual
                elif dn > 2 * up and last < o:
                    score = (last - o) / usual
            f = futrows.get(sym) or {}
            chg = (last / prev - 1) * 100
            r = {"sym": sym, "sector": sectors.get(sym) or "Others", "prev": round(prev, 2), "open": round(o, 2),
                 "high": round(h, 2), "low": round(l, 2), "last": round(last, 2), "chg": round(chg, 2),
                 "usual": round(usual, 2) if usual else None, "score": round(score, 2),
                 "vwap": round(vwap, 2) if vwap else None, "oi_pchg": f.get("oi_pchg"), "oi_chg": f.get("oi_chg"),
                 "oi_kind": _oi_kind(chg, f.get("oi_pchg"))}
            r["line"] = line_for(r)
            rows[sym] = r
            # path: % from previous close at the end of each 5 minute slot; candles with the running VWAP
            p = [None] * SLOTS
            bars = []
            t5, bo, bh, bl, bc, bv = _agg5(ts[m], o_, h_, l_, c_, v_, np.ones(len(c_), bool))
            pv = np.add.reduceat(tp * v_, np.searchsorted(ts[m] - ts[m] % 300, t5)) if len(t5) else []
            cpv, cv = np.cumsum(pv), np.cumsum(bv)
            for i, t in enumerate(t5):
                sl = int(((t + 19800) % 86400 // 60 - 555) // 5)
                if not 0 <= sl < SLOTS:
                    continue
                p[sl] = round((float(bc[i]) / prev - 1) * 100, 2)
                bars.append([sl, round(float(bo[i]), 2), round(float(bh[i]), 2), round(float(bl[i]), 2), round(float(bc[i]), 2),
                             round(float(cpv[i] / cv[i]), 2) if cv[i] else None])
            paths[sym] = p
            c5[sym] = bars
            lb = d.index[m][-1]
            if last_bar is None or lb > last_bar:
                last_bar = lb
        if not rows:
            return
        snow = structure_now(s5, rows)
        sess = str(last_bar.date())
        joined = dict(STATE.get("joined") or {}) if STATE.get("joined_day") == sess else {}
        tb = int(last_bar.timestamp())
        for side, sgn in (("up", 1), ("dn", -1)):           # when each stock first made the top 10 of a one-way list today
            top = sorted((r for r in rows.values() if r["score"] * sgn > 0), key=lambda r: -abs(r["score"]))[:10]
            for r in top:
                if r["sym"] not in joined:
                    joined[r["sym"]] = {"side": side, "t": tb}
        with LOCK:
            STATE.update(ts=time.time(), rows=rows, paths=paths, c5=c5, s5=s5, snow=snow, prof=prof, source=source, joined=joined, joined_day=sess,
                         session=str(last_bar.date()), last_bar=last_bar.strftime("%H:%M"))
        try:
            json.dump({k: STATE.get(k) for k in ("ts", "rows", "paths", "c5", "s5", "snow", "prof", "joined", "joined_day", "session", "last_bar", "source")},
                      open(OUT + ".tmp", "w", encoding="utf8"))
            os.replace(OUT + ".tmp", OUT)
        except Exception:
            pass
        log(f"  live F&O: {len(rows)} stocks, last bar {STATE['last_bar']}, {time.time() - t0:.0f}s")
    finally:
        STATE["busy"] = False


def structure_now(s5, rows):
    """Per F&O stock, from its 5-minute candles: today's breaks of structure and changes of character,
    and whether the price sits in an order block right now. Describes what happened; no picks."""
    import structure as ST
    out = {}
    for sym, cs in s5.items():
        if len(cs) < 40:
            continue
        try:
            a = ST.analyse(cs)
        except Exception:
            continue
        if not a:
            continue
        today = datetime.fromtimestamp(cs[-1]["t"]).date()
        ev = [{"kind": e["kind"], "dir": e["dir"], "t": e["t"], "level": e["level"]} for e in a["events"]
              if e["kind"] in ("BoS", "CHoCH", "Break") and datetime.fromtimestamp(e["t"]).date() == today]
        last = cs[-1]["c"]
        live = [b for b in a["blocks"] if b["status"] != "broken" and datetime.fromtimestamp(b["made_t"]).date() == today]
        at = next((b for b in sorted(live, key=lambda b: -b["made_t"]) if b["bot"] <= last <= b["top"]), None)
        r = rows.get(sym) or {}
        out[sym] = {"trend": a["trend"], "events": ev[-4:], "last": last, "chg": r.get("chg"), "sector": r.get("sector"),
                    "at_ob": {"dir": at["dir"], "bot": at["bot"], "top": at["top"], "t": at["t"], "status": at["status"]} if at else None}
    return out


def buildup_counts():
    c = {k: 0 for k in OI_WORDS}
    for r in STATE["rows"].values():
        if r.get("oi_kind"):
            c[r["oi_kind"]] += 1
    return c


def load():
    if not STATE["rows"] and os.path.exists(OUT):
        try:
            d = json.load(open(OUT, encoding="utf8"))
            STATE.update({k: d[k] for k in ("ts", "rows", "paths", "c5", "s5", "snow", "prof", "joined", "joined_day", "session", "last_bar", "source") if k in d})
        except Exception:
            pass


def board(n=20):
    """Everything the Live F&O page needs, minus the per-stock candles."""
    load()
    with LOCK:
        rows = list(STATE["rows"].values())
        paths = STATE["paths"]
    if not rows:
        return {"empty": True}
    upn = sum(1 for r in rows if r["chg"] > 0)
    dnn = sum(1 for r in rows if r["chg"] < 0)
    hist = []
    for lo, hi in BUCKETS:
        hist.append({"lo": lo, "hi": hi, "n": sum(1 for r in rows if lo <= r["chg"] < hi and r["chg"] != 0)})
    sec = {}
    for r in rows:
        sec.setdefault(r["sector"], []).append(r["chg"])
    sectors = sorted(({"name": k, "chg": round(sum(v) / len(v), 2), "n": len(v)} for k, v in sec.items() if len(v) >= 3),
                     key=lambda x: -x["chg"])
    flow = []
    for k, v in sec.items():
        members = [r for r in rows if r["sector"] == k]
        if len(members) < 3:
            continue
        line = []
        for i in range(SLOTS):
            xs = [paths[r["sym"]][i] for r in members if r["sym"] in paths and paths[r["sym"]][i] is not None]
            line.append(round(sum(xs) / len(xs), 2) if xs else None)
        best = max(members, key=lambda r: r["chg"]) if sum(v) >= 0 else min(members, key=lambda r: r["chg"])
        up = sum(1 for r in members if r["chg"] > 0)
        flow.append({"name": k, "chg": round(sum(v) / len(v), 2), "up": up, "n": len(members), "lead": best["sym"], "lead_chg": best["chg"],
                     "broad": max(up, len(members) - up) >= 0.75 * len(members), "line": line})
    flow.sort(key=lambda x: -x["chg"])
    depth = {}
    for r in rows:
        b = max(-7, min(7, int(r["chg"]) if r["chg"] >= 0 else int(r["chg"]) - 1 + (1 if r["chg"] == int(r["chg"]) else 0)))
        depth[b] = depth.get(b, 0) + 1
    bull = sorted((r for r in rows if r["score"] > 0), key=lambda r: -r["score"])
    bear = sorted((r for r in rows if r["score"] < 0), key=lambda r: r["score"])
    for side in (bull, bear):
        for i, r in enumerate(side):
            r["rank"] = i + 1
    for r in rows:
        r["from_open"] = round((r["last"] / r["open"] - 1) * 100, 2) if r.get("open") else None
    slim = lambda r: {k: r.get(k) for k in ("sym", "sector", "last", "chg", "from_open", "score", "rank", "oi_kind", "oi_pchg", "vwap", "line")}
    return {"session": STATE["session"], "last_bar": STATE["last_bar"], "ts": STATE["ts"], "source": STATE["source"],
            "total": len(rows), "up": upn, "down": dnn, "flat": len(rows) - upn - dnn, "hist": hist, "sectors": sectors,
            "bull": [slim(r) for r in bull[:n]], "bear": [slim(r) for r in bear[:n]],
            "bull_n": len(bull), "bear_n": len(bear), "choppy": sum(1 for r in rows if not r["score"]),
            "paths": paths, "chg": {r["sym"]: r["chg"] for r in rows}, "buildup": buildup_counts(), "flow": flow, "depth": depth,
            "bu": {k: [{x: r.get(x) for x in ("sym", "sector", "chg", "oi_pchg")} for r in sorted((r for r in rows if r.get("oi_kind") == k), key=lambda r: -abs(r["oi_pchg"]))[:15]] for k in OI_WORDS}}


def stock(sym):
    load()
    r = STATE["rows"].get(sym)
    if not r:
        return {"error": f"{sym} is not in Live F&O."}
    return {**r, "bars": STATE["c5"].get(sym, []), "prof": STATE.get("prof", {}).get(sym), "session": STATE["session"], "last_bar": STATE["last_bar"],
            "source": STATE.get("source")}
