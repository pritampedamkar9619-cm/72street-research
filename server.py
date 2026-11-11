"""72 Street AI Dashboard: local server.

Run:  python server.py      then open http://127.0.0.1:8772
Serves the web app from ./web and a JSON API under /api. A background thread
snapshots option chains every minute while the market is open, which is what
makes "OI added per minute" a live number."""
import json, os, sys, threading, time, traceback
os.environ["TZ"] = "IST-5:30"                     # every clock reading below is India time, on any host (India has no daylight saving)
if hasattr(time, "tzset"):
    time.tzset()
from collections import deque, defaultdict
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bootstrap  # noqa: F401  unpacks starter data on a fresh host
import engine as E
from data_nse import nse, yahoo, yf_symbol, INDEX_SYMBOLS
import history as HX
import insights as INS
import stockdata as SD
import universe as UNI
import structure as ST

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)
PORT = int(os.environ.get("PORT", 8772))

MAIN = ["NIFTY 50", "NIFTY BANK", "NIFTY MIDCAP 100", "NIFTY SMALLCAP 100", "INDIA VIX", "NIFTY FINANCIAL SERVICES", "NIFTY NEXT 50"]
SECTORS = {"NIFTY IT": "IT", "NIFTY AUTO": "Auto", "NIFTY FMCG": "FMCG", "NIFTY METAL": "Metal", "NIFTY PHARMA": "Pharma",
           "NIFTY PSU BANK": "PSU Bank", "NIFTY PRIVATE BANK": "Private Bank", "NIFTY REALTY": "Realty", "NIFTY MEDIA": "Media",
           "NIFTY ENERGY": "Energy", "NIFTY OIL & GAS": "Oil & Gas", "NIFTY HEALTHCARE INDEX": "Healthcare",
           "NIFTY CONSUMER DURABLES": "Consumer Durables", "NIFTY INFRASTRUCTURE": "Infra", "NIFTY CAPITAL MARKETS": "Capital Markets",
           "NIFTY COMMODITIES": "Commodities", "NIFTY CHEMICALS": "Chemicals", "NIFTY INDIA DEFENCE": "Defence",
           "NIFTY FINANCIAL SERVICES": "Financials", "NIFTY CPSE": "CPSE", "NIFTY PSE": "PSE", "NIFTY INDIA CONSUMPTION": "Consumption",
           "NIFTY INDIA DIGITAL": "Digital", "NIFTY EV & NEW AGE AUTOMOTIVE": "EV", "NIFTY MNC": "MNC", "NIFTY HOUSING": "Housing",
           "NIFTY INDIA TOURISM": "Tourism", "NIFTY INDIA MANUFACTURING": "Manufacturing", "NIFTY TRANSPORTATION & LOGISTICS": "Logistics"}
GLOBAL = {"^GSPC": ("S&P 500", "us"), "^IXIC": ("Nasdaq", "us"), "^DJI": ("Dow Jones", "us"), "^FTSE": ("FTSE 100", "eu"),
          "^GDAXI": ("DAX", "eu"), "^FCHI": ("CAC 40", "eu"), "^N225": ("Nikkei 225", "asia"), "^HSI": ("Hang Seng", "asia"),
          "000001.SS": ("Shanghai", "asia"), "^KS11": ("Kospi", "asia"),
          "BTC-USD": ("Bitcoin", "crypto"), "ETH-USD": ("Ethereum", "crypto"), "SOL-USD": ("Solana", "crypto"), "XRP-USD": ("XRP", "crypto"),
          "GC=F": ("Gold", "metal"), "SI=F": ("Silver", "metal"), "HG=F": ("Copper", "metal"),
          "CL=F": ("WTI crude", "energy"), "BZ=F": ("Brent crude", "energy"), "NG=F": ("Natural gas", "energy"),
          "USDINR=X": ("USD / INR", "fx"), "DX-Y.NYB": ("Dollar index", "fx"), "^TNX": ("US 10Y yield", "fx")}

def ist(t):
    """Unix seconds to a naive India-time datetime (candle times are UTC)."""
    return datetime.fromtimestamp(t + 19800, timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------- live snapshots
SNAP = defaultdict(lambda: deque(maxlen=400))     # (sym, exp) -> deque of (time, rows)
WANTED = {"NIFTY": time.time() + 1e12, "BANKNIFTY": time.time() + 1e12}   # sym -> keep until
STATE = {"market_open": False, "last_cycle": None, "errors": 0}


def nearest_expiry(sym):
    info = nse.contract_info(sym)
    exps = info.get("expiryDates") or []
    return exps[0] if exps else None, exps


def market_open():
    try:
        ms = nse.market_status()
        for m in ms.get("marketState", []):
            if m.get("market") == "Capital Market":
                return m.get("marketStatus", "").lower() in ("open", "live")
    except Exception:
        pass
    return False


def collector():
    while True:
        try:
            STATE["market_open"] = market_open()
            if STATE["market_open"]:
                for sym, until in list(WANTED.items()):
                    if until < time.time():
                        WANTED.pop(sym, None); continue
                    exp, _ = nearest_expiry(sym)
                    if not exp:
                        continue
                    raw = nse.option_chain(sym, exp, ttl=30)
                    _, _, rows = E.chain_rows(raw)
                    SNAP[(sym, exp)].append((time.time(), rows))
            STATE["last_cycle"] = datetime.now().strftime("%H:%M:%S")
        except Exception:
            STATE["errors"] += 1
            traceback.print_exc()
        time.sleep(60)


# ---------------------------------------------------------------- FII / DII history
HIST = os.path.join(DATA, "fiidii_history.json")


FIIDII_ARCHIVE = {"ts": 0}


def fiidii_archive():
    """About a month of daily FII/DII cash figures from Trendlyne's public archive of the exchange's
    provisional data. NSE itself only ever shows the latest day. The right table is found by checking
    that buy minus sell equals net for both FII and DII on every row."""
    import html as _html, re as _re, requests
    r = requests.get("https://trendlyne.com/macro-data/fii-dii/latest/cash-pastmonth/", timeout=20,
                     headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"})
    r.raise_for_status()
    t = _html.unescape(r.text)
    for m in _re.finditer(r"\[\[\s*\"", t):                     # tables may open with a summary row
        e = t.find("]]", m.start())
        try:
            block = json.loads(t[m.start():e + 2])
        except Exception:
            continue
        rows = [x for x in block if isinstance(x, list) and len(x) >= 7 and isinstance(x[0], str)
                and _re.match(r"\d{4}-\d{2}-\d{2}$", x[0]) and all(isinstance(v, (int, float)) for v in x[1:7])]
        ok = rows and all(abs(x[1] - x[2] - x[3]) < 1 and abs(x[6] - x[5] - x[4]) < 1 and 1000 < x[1] < 80000 for x in rows)
        if ok:
            out = {}
            for x in rows:
                d = datetime.strptime(x[0], "%Y-%m-%d").strftime("%d-%b-%Y")
                out[d] = {"fii": x[3], "fii_buy": x[1], "fii_sell": x[2], "dii": x[4], "dii_buy": x[6], "dii_sell": x[5], "src": "archive"}
            return out
    return {}


FIIDII_LOCK = threading.Lock()


def save_hist(hist):
    json.dump(hist, open(HIST + ".tmp", "w", encoding="utf8"))
    os.replace(HIST + ".tmp", HIST)          # a reader sees the old file or the new one, never half of it


def fiidii_history():
    with FIIDII_LOCK:
        return _fiidii_history()


def _fiidii_history():
    hist = {}
    if os.path.exists(HIST):
        hist = json.load(open(HIST, encoding="utf8"))
    else:
        # verified closing figures from NSE, so the history does not start empty
        hist = {"16-Oct-2026": {"fii": 1165.92, "dii": -3661.28}, "19-Oct-2026": {"fii": -1148.64, "dii": 3201.19},
                "21-Oct-2026": {"fii": 1022.32, "dii": 1614.32}}
    try:
        today = {}
        for x in nse.fii_dii():
            key = "fii" if "FII" in x["category"] else "dii"
            today.setdefault(x["date"], {})[key] = float(x["netValue"])
            today[x["date"]][key + "_buy"] = float(x["buyValue"]); today[x["date"]][key + "_sell"] = float(x["sellValue"])
        before = json.dumps(hist, sort_keys=True)
        for d, v in today.items():
            hist.setdefault(d, {}).update(v)
        if json.dumps(hist, sort_keys=True) != before:
            save_hist(hist)
    except Exception:
        traceback.print_exc()
    if time.time() - FIIDII_ARCHIVE["ts"] > 6 * 3600:            # fill days the dashboard was not running for
        FIIDII_ARCHIVE["ts"] = time.time()
        try:
            added = 0
            for d, v in fiidii_archive().items():
                if d not in hist or "fii" not in hist[d] or "dii" not in hist[d]:
                    hist[d] = v; added += 1
            if added:
                save_hist(hist)
        except Exception:
            traceback.print_exc()
    items = sorted(hist.items(), key=lambda kv: datetime.strptime(kv[0], "%d-%b-%Y"))
    return [{"date": d, **v} for d, v in items][-30:]


# ---------------------------------------------------------------- API handlers
def idx_map():
    a = nse.all_indices()
    return a, {r["index"]: r for r in a["data"]}


def slim(r, name=None):
    return {"name": name or r["index"], "last": r["last"], "chg": r["percentChange"], "pts": round(r["variation"], 2),
            "open": r.get("open"), "high": r["high"], "low": r["low"], "prev": r["previousClose"],
            "yh": r.get("yearHigh"), "yl": r.get("yearLow"), "adv": r.get("advances"), "dec": r.get("declines"),
            "w1": r.get("oneWeekAgoVal"), "pe": r.get("pe")}


def api_pulse(q):
    a, m = idx_map()
    main = [slim(m[n]) for n in MAIN if n in m]
    try:
        sx = yahoo.history("^BSESN", period="1y", interval="1d", ttl=300)
        if len(sx) > 1:
            l_, p_ = sx[-1], sx[-2]
            main.insert(1, {"name": "SENSEX", "last": l_["c"], "pts": round(l_["c"] - p_["c"], 2), "chg": round((l_["c"] / p_["c"] - 1) * 100, 2),
                            "high": l_["h"], "low": l_["l"], "prev": p_["c"], "yh": max(x["h"] for x in sx)})
    except Exception:
        pass
    sectors = sorted([slim(m[k], v) for k, v in SECTORS.items() if k in m], key=lambda s: -float(s["chg"]))
    n500 = m.get("NIFTY 500", {})
    adv, dec = int(n500.get("advances") or 0), int(n500.get("declines") or 0)
    movers = {}
    for kind in ("gainers", "loosers"):
        try:
            v = nse.variations(kind)
            movers[kind] = [{"sym": x["symbol"], "ltp": x["ltp"], "chg": round(x["perChange"], 2)} for x in v["NIFTY"]["data"][:6]]
            movers[kind + "_fo"] = [{"sym": x["symbol"], "ltp": x["ltp"], "chg": round(x["perChange"], 2)} for x in v["FOSec"]["data"][:8]]
        except Exception:
            movers[kind] = []
    try:
        h52, l52 = nse.high52().get("high", 0), nse.low52().get("low", 0)
    except Exception:
        h52 = l52 = None
    nifty, vix = m.get("NIFTY 50", {}), m.get("INDIA VIX", {})
    lead, lag = sectors[0], sectors[-1]
    ratio = f"{adv:,} stocks rose and {dec:,} fell in the Nifty 500"
    head = (f"Nifty {'up' if nifty.get('percentChange', 0) >= 0 else 'down'} {abs(nifty.get('percentChange', 0)):.2f}% at {nifty.get('last', 0):,.0f}. "
            f"{ratio}. {lead['name']} {'led the NSE sector indices' if float(lead['chg']) > 0 else 'held up best among NSE sector indices'} ({lead['chg']:+.2f}%), {lag['name']} {'fell most' if float(lag['chg']) < 0 else 'rose least'} ({lag['chg']:+.2f}%). "
            f"VIX {vix.get('last', 0):.2f}.")
    out = {"ts": a.get("timestamp"), "open": STATE["market_open"], "main": main, "sectors": sectors,
           "breadth": {"adv": adv, "dec": dec, "unch": int(n500.get("unchanged") or 0), "h52": h52, "l52": l52},
           "movers": movers, "headline": head}
    try:                                       # the Today word, so Market Pulse and Today read the day the same way
        w, t, ln = market_state(out)
        out["mood"] = {"word": w, "tone": t, "line": ln}
    except Exception:
        traceback.print_exc()
    return out


FUT_ROWS = {"rows": {}, "basis": "", "ts": 0}


def futures_buildup():
    """Futures buildup per stock with every expiry added together.
    A single contract's OI swings 50 to 200% in expiry week as positions roll to the next
    month, so per-contract lists mislabel rollover as fresh longs or shorts."""
    import history as H
    if H.FUT["days"] is None or time.time() - H.FUT.get("ts", 0) > 3 * 3600:
        try:
            H.build_fut(); H.FUT["ts"] = time.time()
        except Exception:
            traceback.print_exc()
    book = H.FUT["days"] or {}
    last_day = sorted(book)[-1] if book else None
    base = book.get(last_day, {}) if last_day else {}
    rows = {}
    basis = f"close of {datetime.strptime(last_day, '%Y-%m-%d').strftime('%d %b')}, all expiries added" if last_day else ""
    if base:
        try:
            oc = nse.oi_contracts()
            cur = datetime.strptime(oc.get("currTradingDate", "01-Jan-2000"), "%d-%b-%Y").strftime("%Y-%m-%d")
            if not (STATE["market_open"] or cur > last_day):
                raise LookupError("no session newer than the last bhavcopy")   # NSE still shows an old day: use the bhavcopy
            agg = {}
            for block in oc["data"]:
                for rs in block.values():
                    if not isinstance(rs, list):
                        continue
                    for r in rs:
                        if r.get("instrument") != "Stock Futures":
                            continue
                        a = agg.setdefault(r["symbol"], {"chg": 0, "ids": set(), "ltp": r["underlyingValue"], "vol": -1})
                        if r["identifier"] in a["ids"]:
                            continue
                        a["ids"].add(r["identifier"]); a["chg"] += r["changeInOI"]
                        if r.get("volume", 0) > a["vol"]:
                            a["vol"], a["ltp"] = r["volume"], r["underlyingValue"]
            for sym, a in agg.items():
                prev = base.get(sym)
                if prev and prev[0] and prev[1]:
                    rows[sym] = {"sym": sym, "ltp": a["ltp"], "pchg": round((a["ltp"] / prev[1] - 1) * 100, 2),
                                 "oi_chg": a["chg"], "oi_pchg": round(a["chg"] / prev[0] * 100, 1)}
            basis = "live, all expiries added" if STATE["market_open"] else f"session of {datetime.strptime(cur, '%Y-%m-%d').strftime('%d %b')}, all expiries added"
        except LookupError:
            rows = {}
        except Exception:
            traceback.print_exc(); rows = {}
    if not rows:
        for sym in base:
            n = H.fut_net(sym)
            if n and n["oi1"] is not None and n["p1"] is not None and sym not in INDEX_SYMBOLS:
                rows[sym] = {"sym": sym, "ltp": base[sym][1], "pchg": n["p1"], "oi_chg": None, "oi_pchg": n["oi1"]}
    FUT_ROWS.update(rows=rows, basis=basis, ts=time.time())
    fresh, fbasis = fut_rows_now()
    if fresh is not FUT_ROWS["rows"]:
        rows, basis = fresh, fbasis
    fut = {k: [] for k in ("long_buildup", "short_buildup", "short_covering", "long_unwinding")}
    for r in rows.values():
        if r.get("oi_pchg") is None or abs(r["oi_pchg"]) < 2 or r["sym"] in ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"):
            continue
        k = ("long_buildup" if r["pchg"] >= 0 else "short_buildup") if r["oi_pchg"] > 0 else ("short_covering" if r["pchg"] >= 0 else "long_unwinding")
        fut[k].append(r)
    counts = {k: len(v) for k, v in fut.items()}
    for k in fut:
        fut[k] = sorted(fut[k], key=lambda r: -abs(r["oi_pchg"]))[:10]
    return fut, counts, basis


def api_flow(q):
    a, m = idx_map()
    hist = fiidii_history()
    sectors = sorted([slim(m[k], v) for k, v in SECTORS.items() if k in m], key=lambda s: -float(s["chg"]))
    fut, counts, basis = futures_buildup()
    spurts = []
    try:
        for r in nse.oi_spurts()["data"]:
            if r["symbol"].endswith(("FPI",)) or not r.get("prevOI"):
                continue
            spurts.append({"sym": r["symbol"], "oi_pchg": round(r["changeInOI"] / r["prevOI"] * 100, 1),
                           "value": round(r.get("total") or 0), "ltp": r.get("underlyingValue")})
        spurts = sorted(spurts, key=lambda r: -abs(r["oi_pchg"]))[:12]
    except Exception:
        traceback.print_exc()
    last = hist[-1] if hist else {}
    recent = hist[-5:]
    fii5 = sum(h.get("fii", 0) for h in recent); dii5 = sum(h.get("dii", 0) for h in recent)
    head = (f"Latest session ({last.get('date', '')}): foreign investors net {'bought' if last.get('fii', 0) >= 0 else 'sold'} "
            f"₹{abs(last.get('fii', 0)):,.0f} cr, domestic institutions net {'bought' if last.get('dii', 0) >= 0 else 'sold'} "
            f"₹{abs(last.get('dii', 0)):,.0f} cr. Over the last {len(recent)} sessions: FII {('+' if fii5 >= 0 else '−')}₹{abs(fii5):,.0f} cr, DII {('+' if dii5 >= 0 else '−')}₹{abs(dii5):,.0f} cr.")
    return {"fiidii": hist, "sectors": sectors, "futures": fut, "fut_counts": counts, "fut_basis": basis, "spurts": spurts, "headline": head}


WANT_MAX = 12


def want(sym):
    """Keep snapshotting this chain for 15 minutes. Only the 12 most recently opened stay on the list."""
    WANTED[sym] = max(WANTED.get(sym, 0), time.time() + 900)
    temp = sorted((u, s) for s, u in WANTED.items() if u < time.time() + 1e11)
    for _, s in temp[:max(0, len(temp) - WANT_MAX)]:
        WANTED.pop(s, None)


def api_options(q, watch=True):
    sym = (q.get("sym") or ["NIFTY"])[0].upper()
    exp_default, exps = nearest_expiry(sym)
    exp = (q.get("exp") or [exp_default])[0]
    if not exp:
        return {"error": f"{sym} has no options listed"}
    if watch:
        want(sym)
    raw = nse.option_chain(sym, exp)
    snaps = SNAP.get((sym, exp))
    prev, minutes = None, None
    if snaps and len(snaps) >= 2 and STATE["market_open"]:
        t1, _ = snaps[-1]
        for t0, rows0 in reversed(snaps):
            if t1 - t0 >= 55:
                prev, minutes = rows0, (t1 - t0) / 60
                break
    out = E.option_summary(raw, exp, prev, minutes)
    out.update({"sym": sym, "expiries": exps[:8], "market_open": STATE["market_open"],
                "snapshots": len(snaps) if snaps else 0})
    return out


def api_candles(q):
    sym = (q.get("sym") or ["NIFTY"])[0].upper()
    tf = (q.get("tf") or ["5m"])[0]
    period = {"5m": "5d", "15m": "1mo", "1h": "3mo", "1d": "1y"}.get(tf, "5d")
    return {"sym": sym, "tf": tf, "candles": yahoo.history(yf_symbol(sym), period=period, interval=tf, ttl=60 if tf != "1d" else 900)}


def api_radar(q):
    sym = (q.get("sym") or ["RELIANCE"])[0].upper()
    candles = yahoo.history(yf_symbol(sym), period="2y", interval="1d", ttl=900)
    opt = None
    try:
        opt = api_options({"sym": [sym]})
        opt.pop("rows", None)
    except Exception:
        opt = None
    out = E.radar(candles, opt)
    out.update({"sym": sym, "spark": [round(c["c"], 2) for c in candles[-120:]],
                "chg": round((candles[-1]["c"] / candles[-2]["c"] - 1) * 100, 2) if len(candles) > 1 else 0})
    if opt and not opt.get("error"):
        out["opt"] = {k: opt.get(k) for k in ("pcr", "max_pain", "floor", "ceiling", "atm_iv", "straddle", "expiry", "momentum")}
    return out


CALM = {"data": None, "ts": 0, "busy": False}


def build_calm():
    if CALM["busy"]:
        return
    CALM["busy"] = True
    try:
        syms = [s for s in nse.fno_list() if s not in INDEX_SYMBOLS]
        tick = {yf_symbol(s): s for s in syms}
        daily = yahoo.batch_daily(list(tick), period="6mo")
        exp, _ = nearest_expiry("RELIANCE")
        exp_d = datetime.strptime(exp, "%d-%b-%Y") if exp else None
        results = {}
        for e in nse.events():
            if "result" in (e.get("purpose") or "").lower():
                try:
                    d = datetime.strptime(e["date"], "%d-%b-%Y")
                except ValueError:
                    continue
                if d.date() >= datetime.now().date():
                    results[e["symbol"]] = min(results.get(e["symbol"], d), d)
        pts = []
        for t, c in daily.items():
            if len(c) < 40:
                continue
            s = tick[t]; closes = [x["c"] for x in c]; last = closes[-1]
            win = c[-20:]
            rng = (max(x["h"] for x in win) - min(x["l"] for x in win)) / last * 100
            rv = E.realised_vol(closes)
            turn = sum(x["c"] * x["v"] for x in c[-20:]) / 20 / 1e7
            rd = results.get(s)
            status = "none" if not rd else ("before" if exp_d and rd <= exp_d else "after")
            pts.append({"sym": s, "rv": round(rv, 1), "range": round(rng, 1), "turn": round(turn, 1), "last": round(last, 2),
                        "chg20": round((last / closes[-21] - 1) * 100, 1), "results": rd.strftime("%d %b") if rd else None,
                        "status": status, "calm": round(rv * 0.6 + rng * 0.4 * 3, 1)})
        pts.sort(key=lambda p: p["calm"])
        CALM.update(data={"expiry": exp, "points": pts}, ts=time.time())
    finally:
        CALM["busy"] = False


def api_calm(q):
    if CALM["data"] is None or time.time() - CALM["ts"] > 3 * 3600:
        if CALM["data"] is None:
            build_calm()
        else:
            threading.Thread(target=lambda: (build_calm(), build_results()), daemon=True).start()
    d = CALM["data"] or {"points": []}
    quiet = [p for p in d["points"] if p["status"] != "before"][:5]
    d["headline"] = ("Quietest F&O stocks over the last 20 sessions, with no results due before the "
                     f"{d.get('expiry', '')} expiry: " + ", ".join(p["sym"] for p in quiet) + ".")
    return d


def api_global(q):
    data = yahoo.batch_daily(list(GLOBAL), period="1mo", ttl=300)
    out = []
    for t, (name, grp) in GLOBAL.items():
        c = data.get(t)
        if not c or len(c) < 2:
            continue
        out.append({"t": t, "name": name, "grp": grp, "last": round(c[-1]["c"], 4 if grp == "fx" and c[-1]["c"] < 10 else 2),
                    "chg": round((c[-1]["c"] / c[-2]["c"] - 1) * 100, 2), "spark": [round(x["c"], 4) for x in c[-22:]]})
    by = {o["t"]: o for o in out}
    if "GC=F" in by and "USDINR=X" in by:
        inr = by["USDINR=X"]["last"]
        by["GC=F"]["inr"] = round(by["GC=F"]["last"] * inr / 31.1035 * 10)
        if "SI=F" in by:
            by["SI=F"]["inr"] = round(by["SI=F"]["last"] * inr / 31.1035 * 1000)
    return {"items": out}


EXTRA = {}
PLEDGE_FILE = os.path.join(ROOT, "data", "pledge.json") if "ROOT" in globals() else "data/pledge.json"
PLEDGE_LOCK = threading.Lock()


def promoter_pledge(sym):
    """Promoter pledge from the latest NSE shareholding filing. One filing a quarter, so kept on disk."""
    import re
    rows = nse.get("/api/corporate-share-holdings-master", {"index": "equities", "symbol": sym}, ttl=86400)
    rows = [r for r in rows or [] if r.get("xbrl") and str(r["xbrl"]).endswith(".xml")] if isinstance(rows, list) else []
    if not rows:
        return None
    r = rows[0]
    with PLEDGE_LOCK:
        try:
            book = json.load(open(PLEDGE_FILE, encoding="utf8"))
        except Exception:
            book = {}
    hit = book.get(sym)
    if hit and hit.get("key") == r["xbrl"]:
        return hit
    resp = nse.s.get(r["xbrl"], timeout=30, headers={"Referer": "https://www.nseindia.com/"})
    if resp.status_code != 200 or "xbrl" not in resp.text[:600]:
        nse._session()                               # the cached listing can leave the session cold
        resp = nse.s.get(r["xbrl"], timeout=30, headers={"Referer": "https://www.nseindia.com/"})
    t = resp.text
    if "xbrl" not in t[:600]:
        return None
    ctx = "ShareholdingOfPromoterAndPromoterGroup_ContextI"

    def fact(tag):
        m = re.search(r'<in-bse-shp:%s(?=\s)[^>]*contextRef="%s"[^>]*>([^<]*)<' % (tag, ctx), t)
        return float(m.group(1)) if m and m.group(1).strip() else 0.0
    held = fact("NumberOfShares")
    if held <= 0:
        return None                                  # no promoter, nothing to pledge
    pledged, total = fact("NumberOfSharesEncumberedUnderPledged"), fact("NumberOfSharesEncumbered")
    out = {"key": r["xbrl"], "date": str(r.get("date", "")).title(), "pledged": round(pledged / held * 100, 2),
           "other": round(max(total - pledged, 0) / held * 100, 2)}
    with PLEDGE_LOCK:
        try:
            book = json.load(open(PLEDGE_FILE, encoding="utf8"))
        except Exception:
            book = {}
        book[sym] = out
        json.dump(book, open(PLEDGE_FILE + ".tmp", "w", encoding="utf8"))
        os.replace(PLEDGE_FILE + ".tmp", PLEDGE_FILE)
    return out


def api_extra(q):
    """Slow-changing extras for a stock page: financial health and P/E against its own past."""
    sym = (q.get("sym") or [""])[0].upper()
    hit = EXTRA.get(sym)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    h, pe = None, None
    try:
        h = SD.health(sym)
    except Exception:
        traceback.print_exc()
    try:
        eps = SD.eps_years(sym)
        mon = yahoo.history(yf_symbol(sym), period="7y", interval="1mo", ttl=86400)
        px_ = {ist(c["t"]).strftime("%b %Y"): c["c"] for c in mon}
        cut = [i + 1 for i, (x, y) in enumerate(zip(mon, mon[1:])) if y["c"] < x["c"] * 0.55]
        if cut:                                      # split, bonus or demerger: only years after it compare
            px_ = {ist(c["t"]).strftime("%b %Y"): c["c"] for c in mon[cut[-1]:]}
        rows = []
        for per, e in eps.items():
            p = px_.get(per)
            if p and e and e > 0 and 0 < p / e < 300:
                rows.append({"y": per, "pe": round(p / e, 1)})
        rows = rows[-6:]
        if len(rows) >= 3:
            v = sorted(r["pe"] for r in rows)
            med = v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2
            now = None
            tile = ((SD.load_fund(sym) or {}).get("tiles") or {}).get("Stock P/E")
            if tile and tile > 0:
                live = (market_rows()["bysym"].get(sym) or {}).get("l")
                now = SD.live_val(sym, live).get("pe") or round(tile, 1)    # same figure as the valuation table
            pe = {"rows": rows, "median": round(med, 1), "now": now}
    except Exception:
        traceback.print_exc()
    pl = None
    try:
        if h is not None:
            pl = promoter_pledge(sym)
    except Exception:
        traceback.print_exc()
    out = {"health": h, "pe": pe, "pledge": pl}
    EXTRA[sym] = (time.time(), out)
    return out


FILINGS = {}
FILING_SKIP = ("share certificate", "trading window", "newspaper", "depositories and participants", "esop", "esos", "esps",
               "limited review", "record date", "date of payment", "book closure", "loss of", "duplicate", "compliance certificate",
               "certificate under", "postal ballot", "closure of", "investor complaints", "statement of deviation", "related party",
               "reg. 74", "regulation 74", "scrutinizer", "annual secretarial", "structured digital database")
FILING_KIND = [("order", "Order win"), ("contract", "Order win"), ("acquisition", "Acquisition"), ("amalgamation", "Merger"), ("merger", "Merger"),
               ("credit rating", "Credit rating"), ("buyback", "Buyback"), ("dividend", "Dividend"), ("bonus", "Bonus"), ("split", "Split"),
               ("financial result", "Results"), ("outcome of board", "Board meeting"), ("board meeting", "Board meeting"),
               ("analyst", "Analyst meet"), ("investor presentation", "Investor presentation"), ("press release", "Press release"),
               ("media release", "Press release"), ("news verification", "Clarifies news"), ("news clarification", "Clarifies news"),
               ("rumour", "Clarifies news"), ("clarification", "Clarifies news"), ("resignation", "Leadership change"), ("cessation", "Leadership change"),
               ("appointment", "Leadership change"), ("change in director", "Leadership change"), ("change in management", "Leadership change"),
               ("retirement", "Leadership change"), ("takeover", "Big holder change"), ("sast", "Big holder change"), ("pledge", "Pledge"),
               ("insider trading", "Insider trade"), ("allotment", "Shares issued"), ("fund raising", "Fund raising"), ("qip", "Fund raising"),
               ("preferential", "Fund raising"), ("litigation", "Legal"), ("penalt", "Legal"), ("tax", "Tax matter")]


def api_filings(q):
    """Company announcements to NSE over the last 45 days, routine paperwork left out."""
    sym = (q.get("sym") or [""])[0].upper()
    hit = FILINGS.get(sym)
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    d0 = datetime.now() - timedelta(days=45)
    try:
        raw = nse.get("/api/corporate-announcements", {"index": "equities", "symbol": sym, "from_date": d0.strftime("%d-%m-%Y"),
                                                       "to_date": datetime.now().strftime("%d-%m-%Y")}, ttl=900)
    except Exception:
        return {"rows": [], "error": True}
    rows = raw if isinstance(raw, list) else (raw or {}).get("data", [])
    out, seen = [], set()
    for r in rows:
        desc = str(r.get("desc") or "").strip()
        text = " ".join(str(r.get("attchmntText") or "").split())
        low = (desc + " " + text).lower()
        if not desc or any(k in low for k in FILING_SKIP):
            continue
        kind = next((v for k, v in FILING_KIND if k in desc.lower()), None) or next((v for k, v in FILING_KIND if k in text.lower()), "Update")
        if text.lower().startswith(((r.get("sm_name") or "").lower() + " has informed the exchange")) or len(text) < 25:
            text = desc
        text = text if len(text) <= 230 else text[:227].rsplit(" ", 1)[0] + "…"
        key = (kind, text[:80])
        if key in seen:
            continue
        seen.add(key)
        try:
            when = datetime.strptime(r["an_dt"], "%d-%b-%Y %H:%M:%S")
        except Exception:
            continue
        out.append({"when": when.strftime("%d %b, %H:%M"), "iso": when.strftime("%Y-%m-%d"), "kind": kind, "text": text, "plain": text == desc,
                    "url": r.get("attchmntFile") if str(r.get("attchmntFile") or "").startswith("https://") else None})
        if len(out) >= 12:
            break
    res = {"rows": out}
    FILINGS[sym] = (time.time(), res)
    return res


SCR = {"data": None, "ts": 0, "busy": False}


def build_screener():
    """One compact row per listed stock, from data we already hold. Rebuilt every half hour."""
    import statistics
    SD.init()
    book = market_rows()
    uni = UNI.load()
    try:
        plg = json.load(open(PLEDGE_FILE, encoding="utf8"))
    except Exception:
        plg = {}
    recent = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    res = {c["sym"] for c in (REP["data"] or []) if c.get("filed_iso", "") >= recent}
    rows = []
    for r in book["rows"]:
        sym, u = r["s"], uni.get(r["s"]) or {}
        sf = SD.scr_fields(sym)
        pe, roce, de = sf["pe"], sf["roce"], sf["de"]
        if pe:
            pe = SD.live_val(sym, r.get("l")).get("pe") or pe
        last, hi, lo = r.get("l"), u.get("hi52"), u.get("lo52")
        rows.append({"s": sym, "n": r["n"], "g": r["g"], "c": r["c"], "m": r["m"], "l": last, "p": r["p"],
                     "r3": u.get("r3m"), "t": u.get("trend"), "pe": pe if pe and 0 < pe < 500 else None,
                     "roce": roce if roce is not None and -100 < roce < 200 else None, "de": de, "bank": sf["bank"],
                     "hi": round((float(last) / hi - 1) * 100, 1) if last and hi else None,
                     "lo": round((float(last) / lo - 1) * 100, 1) if last and lo else None,
                     "pl": (plg.get(sym) or {}).get("pledged"), "res": sym in res, "tv": u.get("tv20")})
    by = {}
    for x in rows:
        if x["pe"]:
            by.setdefault(x["g"], []).append(x["pe"])
    med = {g: round(statistics.median(v), 1) for g, v in by.items() if len(v) >= 5}
    for x in rows:
        x["spe"] = med.get(x["g"])
    rows.sort(key=lambda x: -x["m"])
    SCR.update(data={"rows": rows, "ts": book.get("ts"), "sectors": sorted(by)}, ts=time.time())
    return SCR["data"]


def api_screener(q):
    if SCR["data"] is None or time.time() - SCR["ts"] > 1800:
        if SCR["data"] is None:
            return build_screener()
        if not SCR["busy"]:
            def go():
                SCR["busy"] = True
                try:
                    build_screener()
                except Exception:
                    traceback.print_exc()
                finally:
                    SCR["busy"] = False
            threading.Thread(target=go, daemon=True).start()
    return SCR["data"]


def api_screens(q):
    """New 52 week highs and lows, thin micro caps left out, largest first."""
    book = market_rows()["bysym"]

    def pick(rows):
        out = []
        for x in rows:
            r = book.get(x["symbol"])
            if r and r["c"] != "Micro":
                out.append({"sym": x["symbol"], "name": r["n"], "cap": r["c"], "g": r.get("g"), "ltp": x["ltp"], "chg": round(x["pChange"], 2), "m": r["m"]})
        return sorted(out, key=lambda r: -r["m"])
    try:
        highs = pick(nse.high52()["data"])
    except Exception:
        highs = []
    try:
        lows = pick(nse.low52()["data"])
    except Exception:
        lows = []
    return {"highs": highs[:25], "lows": lows[:25], "highs_n": len(highs), "lows_n": len(lows)}


def api_symbols(q):
    try:
        lst = nse.fno_list()
    except Exception:
        lst = []
    return {"symbols": ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"] + sorted(lst)}


def api_status(q):
    return {**STATE, "watching": sorted(WANTED), "snap_counts": {f"{k[0]} {k[1]}": len(v) for k, v in SNAP.items()}}


# ---------------------------------------------------------------- live F&O
import livefo as LF

# Futures OI per stock, every live contract added up. NSE's "OI spurts" feeds list only the biggest
# movers (and the per-underlying one mixes options in), so each F&O stock is read on its own:
# about 220 calls, one round every 3 to 4 minutes in market hours.
FUT_LIVE = {"rows": {}, "ts": 0, "round": None, "hist": {}, "hist_day": None}


def fut_quote(sym):
    d = nse.get("/api/NextApi/apiClient/GetQuoteApi", {"functionName": "getSymbolDerivativesData", "symbol": sym}, ttl=90)
    f = [x for x in d.get("data", []) if x.get("instrumentType") == "FUTSTK"]
    if not f:
        return None
    oi = sum(int(x.get("openInterest") or 0) for x in f)
    chg = sum(int(x.get("changeinOpenInterest") or 0) for x in f)
    near = min(f, key=lambda x: datetime.strptime(x["expiryDate"], "%d-%b-%Y"))
    base = oi - chg
    return {"sym": sym, "oi": oi, "oi_chg": chg, "oi_pchg": round(chg / base * 100, 1) if base > 0 else None,
            "pchg": round(float(near.get("pchange") or 0), 2), "ltp": near.get("underlyingValue")}


def fut_live_job():
    time.sleep(40)
    done_after_close = None
    while True:
        mins = datetime.now().hour * 60 + datetime.now().minute
        weekday = datetime.now().weekday() < 5
        in_hours = weekday and 555 <= mins <= 935
        today = datetime.now().strftime("%Y-%m-%d")
        if in_hours or (weekday and mins > 945 and done_after_close != today) or not FUT_LIVE["rows"]:
            try:
                syms = [x for x in nse.fno_list() if x not in INDEX_SYMBOLS]
                if FUT_LIVE["hist_day"] != today:
                    FUT_LIVE.update(hist={}, hist_day=today)
                for sym in syms:
                    try:
                        r = fut_quote(sym)
                        if r:
                            FUT_LIVE["rows"][sym] = {**r, "t": time.time()}
                            if in_hours:                  # OI through the day: one point per round
                                h = FUT_LIVE["hist"].setdefault(sym, [])
                                now_m = datetime.now().hour * 60 + datetime.now().minute
                                if not h or now_m - h[-1][0] >= 2:
                                    h.append([now_m, r["oi"], r["ltp"]])
                    except Exception:
                        pass
                FUT_LIVE.update(ts=time.time(), round=datetime.now().strftime("%H:%M"))
                if not in_hours and mins > 945:
                    done_after_close = today
            except Exception:
                traceback.print_exc()
        if weekday and mins > 945 and not FUT_LIVE.get("bhav") == today:
            # NSE's end of day file (usually out by 7 pm) is the official OI: switch to it once published
            try:
                import history as H
                if today in H.build_fut():
                    FUT_LIVE.update(bhav=today, ts=time.time())
            except Exception:
                traceback.print_exc()
        time.sleep(20 if in_hours else secs_to_open(600))


def fut_rows_now():
    """Best per-stock futures OI available: the per-stock round if fresh, else the older feeds."""
    mins = datetime.now().hour * 60 + datetime.now().minute
    today = datetime.now().strftime("%Y-%m-%d")
    if FUT_LIVE.get("bhav") == today and not (555 <= mins <= 935):
        import history as H
        rows = {}
        for sym in (H.FUT["days"] or {}).get(today, {}):
            n = H.fut_net(sym)
            if n and n["date"] == today and n["oi1"] is not None:
                rows[sym] = {"sym": sym, "oi_pchg": n["oi1"], "pchg": n["p1"], "oi_chg": None}
        if len(rows) > 100:
            return rows, "NSE end of day file, contracts alive on both days compared"
    fresh = {k: v for k, v in FUT_LIVE["rows"].items() if time.time() - v["t"] < 15 * 60}
    if len(fresh) > 100:
        return fresh, ("live, every contract added up" if STATE["market_open"] else "today's session, every contract added up")
    return FUT_ROWS["rows"], FUT_ROWS.get("basis", "")


def livefo_job():
    """Every two minutes in market hours; once after the close so the board shows the full session."""
    time.sleep(15)
    done_after_close = None
    while True:
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            mins = datetime.now().hour * 60 + datetime.now().minute
            weekday = datetime.now().weekday() < 5
            in_hours = weekday and 555 <= mins <= 935
            LF.load()
            need = (in_hours or (weekday and mins > 935 and done_after_close != today) or not LF.STATE["rows"]
                    or FUT_LIVE["ts"] > LF.STATE["ts"] + 60)          # a fresh OI round finished since the last board
            if need:
                SD.init(); UNI.load()
                syms = [x for x in nse.fno_list() if x not in INDEX_SYMBOLS]
                try:
                    futures_buildup()                     # refreshes FUT_ROWS (live OI, all expiries)
                except Exception:
                    traceback.print_exc()
                secs = {k: SD.nice_sector(m["sector"]) for k, m in SD.STATE["master"].items()}
                secs.update(SM.load())
                rows, LF.STATE["oi_basis"] = fut_rows_now()
                LF.build(syms, UNI.STATE["data"] or {}, secs, rows, log=print)
                if not in_hours and mins > 935:
                    done_after_close = today
        except Exception:
            traceback.print_exc()
        time.sleep(120 if in_hours else secs_to_open(600))


def secs_to_open(cap):
    """Sleep no longer than until 9:15 on a weekday, so the first live board lands at the open."""
    now = datetime.now()
    if now.weekday() >= 5:
        return cap
    t = now.replace(hour=9, minute=15, second=5, microsecond=0)
    left = (t - now).total_seconds()
    return max(5, min(cap, left)) if left > 0 else cap


import fnopage as FN
import sectormap as SM
HEAT = {"data": None, "ts": 0}


def market_rows():
    """Every listed stock in one NSE call, joined to our list: price, day move, size, sector."""
    if HEAT["data"] and time.time() - HEAT["ts"] < 60:
        return HEAT["data"]
    SD.init()
    secs = SM.load()
    d = nse.get("/api/live-analysis-stocksTraded", None, ttl=60)
    seen, rows = set(), []
    for r in d["total"]["data"]:
        sym = r.get("symbol")
        m = SD.STATE["master"].get(sym)
        if not m or sym in seen or r.get("series") not in ("EQ", "BE", "BZ", "SM", "ST") or r.get("pchange") is None:
            continue
        seen.add(sym)
        mc = SD.live_val(sym, r.get("lastPrice")).get("mcap") or m["mcap"] or 0
        rows.append({"s": sym, "n": m["name"], "g": secs.get(sym) or SD.nice_sector(m["sector"]), "c": m["cap"] or "Micro",
                     "p": round(float(r["pchange"]), 2), "l": r.get("lastPrice"), "m": round(mc)})
    book = {"rows": rows, "ts": d.get("timestamp"), "bysym": {r["s"]: r for r in rows}}
    HEAT.update(data=book, ts=time.time())
    return book


def sector_stats(rows):
    g = {}
    for r in rows:
        g.setdefault(r["g"], []).append(r)
    out = {}
    for k, v in g.items():
        v2 = sorted(v, key=lambda x: -x["p"])
        out[k] = {"n": len(v), "up": sum(1 for x in v if x["p"] > 0), "chg": round(sum(x["p"] * x["m"] for x in v) / (sum(x["m"] for x in v) or 1), 2), "rank": [x["s"] for x in v2]}
    return out


def api_heatmap(q):
    b = market_rows()
    return {"ts": b["ts"], "open": STATE["market_open"], "rows": [{k: r[k] for k in ("s", "n", "g", "c", "p", "m", "l")} for r in b["rows"]]}


ROT = {"data": None, "ts": 0}


def api_rotation(q):
    """Sectors by week: size-weighted move against the whole market, and traded value against the sector's usual.
    An estimate of where activity moved, built from prices and turnover. Not actual money flow."""
    if not (ROT["data"] and time.time() - ROT["ts"] < 3600):
        build_rotation()
    return ROT["data"]


def build_rotation():
    wk = json.load(open(UNI.WEEKS, encoding="utf8"))
    rows = {r["s"]: r for r in market_rows()["rows"]}
    weeks = sorted({w[0] for v in wk.values() for w in v})[-13:]
    sec = {}
    for sym, v in wk.items():
        r = rows.get(sym)
        if r and r["m"]:
            sec.setdefault(r["g"], []).append((r["m"], {w[0]: w for w in v}))
    allm = [x for v in sec.values() for x in v]

    def wavg(items, w):
        a = b = 0.0
        for m, d in items:
            x = d.get(w)
            if x and x[1] is not None:
                a += m * x[1]; b += m
        return a / b if b else None

    market = {w: wavg(allm, w) for w in weeks}
    out = []
    for name, items in sec.items():
        if len(items) < 3:
            continue
        val = {w: sum(d[w][2] for _, d in items if d.get(w)) for w in weeks}
        cells = []
        for i, w in enumerate(weeks):
            x = wavg(items, w)
            prev = [val[p] for p in weeks[max(0, i - 8):i] if val[p]]
            usual = sum(prev) / len(prev) if len(prev) >= 4 else None
            cells.append({"x": round(x - market[w], 2) if x is not None and market[w] is not None else None,
                          "r": round(x, 2) if x is not None else None, "t": round(val[w] / usual, 2) if usual and val[w] else None})
        out.append({"name": name, "n": len(items), "cells": cells[1:]})
    for r in out:
        last = [c["x"] for c in r["cells"][-4:] if c["x"] is not None]
        r["m4"] = round(sum(last), 2)
    out.sort(key=lambda r: -r["m4"])
    data = {"weeks": weeks[1:], "rows": out, "market": [round(market[w], 2) if market[w] is not None else None for w in weeks[1:]]}
    ROT.update(data=data, ts=time.time(), weeks=weeks, market=market, wk=wk)
    return data


def api_sector(q):
    """One line for a stock page: did it move with its sector or on its own?"""
    sym = (q.get("sym") or [""])[0].upper().strip()
    b = market_rows()
    r = b["bysym"].get(sym)
    if not r:
        return {"missing": True}
    st_ = sector_stats(b["rows"])[r["g"]]
    return {"sector": r["g"], "chg": st_["chg"], "up": st_["up"], "n": st_["n"], "pos": st_["rank"].index(sym) + 1, "own": r["p"], "open": STATE["market_open"], "ts": b["ts"]}


def fno_stock(sym, exp=None, term=True):
    return FN.build(sym, nse, yahoo, E, row=LF.STATE["rows"].get(sym), exp=exp, term=term)


def api_fno(q):
    sym = (q.get("sym") or [""])[0].upper().strip()
    if sym not in set(nse.fno_list()) and sym not in FN.INDICES:
        return {"error": f"{sym or 'That symbol'} is not an F&O stock."}
    out = dict(fno_stock(sym, (q.get("exp") or [None])[0]))
    if not out.get("error"):
        r = LF.stock(sym) if sym not in FN.INDICES else {"error": 1}
        if not r.get("error"):
            out["today"] = {k: r.get(k) for k in ("bars", "session", "prev", "vwap", "last_bar", "line", "open", "high", "low", "usual")}
            out["today"]["oi_hist"] = FUT_LIVE["hist"].get(sym, []) if FUT_LIVE["hist_day"] == r.get("session") else []
        out["open_mkt"] = STATE["market_open"]
    return out


def warm_pages():
    """Fill the slow first calls right after a start, so the first visitor does not pay for them."""
    time.sleep(3)
    for fn in (api_today, api_flow, api_heatmap, api_track, api_screener):
        try:
            fn({})
        except Exception:
            traceback.print_exc()


def fno_job():
    """Works out IV history from NSE's end of day files, and writes the day's verdicts down after the close."""
    time.sleep(90)
    while True:
        try:
            FN.build_hist()
            today = datetime.now().strftime("%Y-%m-%d")
            mins = datetime.now().hour * 60 + datetime.now().minute
            if datetime.now().weekday() < 5 and mins >= 960 and not STATE["market_open"]:
                syms = [x for x in nse.fno_list() if x not in INDEX_SYMBOLS]
                FN.log_day(today, syms, lambda x: fno_stock(x, term=False))
        except Exception:
            traceback.print_exc()
        time.sleep(1800)


def oi_moving(window=30, n=10):
    """Where futures positions changed most in the last `window` minutes, with the price move alongside."""
    out = []
    for sym, h in FUT_LIVE["hist"].items():
        if len(h) < 2 or not h[-1][1]:
            continue
        end = h[-1]
        base = next((x for x in reversed(h[:-1]) if end[0] - x[0] >= window), h[0])
        if not base[1] or not base[2] or end[0] - base[0] < 4:
            continue
        oi = (end[1] / base[1] - 1) * 100
        px = (end[2] / base[2] - 1) * 100
        if abs(oi) < 0.5 or abs(end[1] - base[1]) < 100:      # ignore a handful of contracts on a thin stock
            continue
        kind = ("long_buildup" if px >= 0 else "short_buildup") if oi > 0 else ("short_covering" if px >= 0 else "long_unwinding")
        out.append({"sym": sym, "oi": round(oi, 2), "px": round(px, 2), "kind": kind, "mins": end[0] - base[0],
                    "contracts": end[1] - base[1]})
    out.sort(key=lambda r: -abs(r["oi"]))
    return out[:n]


def opt_brief(sym):
    """Option walls for one stock, without adding it to the minute-by-minute watch list."""
    try:
        exp, _ = nearest_expiry(sym)
        if not exp:
            return None
        o = E.option_summary(nse.option_chain(sym, exp), exp, None, None)
        return {k: o.get(k) for k in ("expiry", "floor", "ceiling", "pcr", "max_pain", "straddle", "spot")}
    except Exception:
        return None


def api_livefo(q):
    sym = (q.get("sym") or [""])[0].upper().strip()
    if sym:
        r = LF.stock(sym)
        if not r.get("error"):
            r["oi_hist"] = FUT_LIVE["hist"].get(sym, []) if FUT_LIVE["hist_day"] == r.get("session") else []
            r["opt"] = opt_brief(sym)
        return r
    LF.load()
    secs = SM.load()
    for k, r in LF.STATE["rows"].items():           # a saved board keeps up with the sector map
        r["sector"] = secs.get(k, r["sector"])
    b = LF.board()
    b["sec_of"] = {k: r["sector"] for k, r in LF.STATE["rows"].items()}     # so a sector in Sector flow can open into its stocks
    b["open"] = STATE["market_open"]
    b["oi_basis"] = LF.STATE.get("oi_basis") or FUT_ROWS.get("basis")
    b["oi_now"] = oi_moving() if FUT_LIVE["hist_day"] == b.get("session") else []
    b["oi_rounds"] = max((len(h) for h in FUT_LIVE["hist"].values()), default=0)
    return b


def api_health(q):
    """How old each source is. 'ok' or 'degraded', for an uptime monitor to watch."""
    now = time.time()
    age = lambda t: round((now - t) / 60, 1) if t else None          # minutes
    nse_paths = {"indices": "/api/allIndices", "futures_oi": "/api/live-analysis-oi-spurts-contracts", "fii_dii": "/api/fiidiiTradeReact"}
    checks = {k: {"ok_min_ago": age(nse.ok.get(p)), "failing": (nse.fail.get(p, 0) > nse.ok.get(p, 0))} for k, p in nse_paths.items()}
    pat = os.path.join(DATA, "patterns_today.csv")
    checks.update({
        "universe": {"ok_min_ago": age(UNI.STATE["ts"])},
        "results_cards": {"ok_min_ago": age(REP["ts"])},
        "patterns": {"ok_min_ago": age(os.path.getmtime(pat)) if os.path.exists(pat) else None},
        "stock_pages": {"cached": len(STOCK_CACHE), "preload": STATE.get("preload"), "queue": PENDING["n"]},
    })
    try:
        checks["live_fo"] = {"ok_min_ago": age(LF.STATE["ts"]), "stocks": len(LF.STATE.get("rows") or {}), "source": LF.STATE.get("source"), "last_bar": LF.STATE.get("last_bar")}
        checks["futures_oi_per_stock"] = {"ok_min_ago": age(FUT_LIVE["ts"]), "stocks": len(FUT_LIVE["rows"]), "round_done": FUT_LIVE["round"]}
    except Exception:
        pass
    bad = []
    if checks["indices"]["failing"]:
        bad.append("NSE index data is failing")
    if STATE["market_open"] and checks["indices"]["ok_min_ago"] is not None and checks["indices"]["ok_min_ago"] > 5:
        bad.append("NSE index data older than 5 minutes in market hours")
    if (checks["universe"]["ok_min_ago"] or 1e9) > 48 * 60:
        bad.append("whole-market scan older than 2 days")
    mins = datetime.now().hour * 60 + datetime.now().minute
    if STATE["market_open"] and mins >= 565 and "live_fo" in checks and (checks["live_fo"]["ok_min_ago"] or 99) > 10:
        bad.append("Live F&O older than 10 minutes in market hours")
    return {"status": "degraded" if bad else "ok", "problems": bad, "market_open": STATE["market_open"],
            "time": datetime.now().strftime("%d %b %H:%M:%S"), "checks": checks}


# ---------------------------------------------------------------- expiry tracker
HXS = {"h": None, "ts": 0}


def hx():
    if HXS["h"] is None or time.time() - HXS["ts"] > 3600:
        HXS["h"] = HX.build(days_back=120) if HXS["h"] is not None or not os.path.exists(HX.OUT) else HX.load()
        HXS["ts"] = time.time()
        if HXS["h"] is not None and datetime.now().hour >= 19:
            threading.Thread(target=lambda: HXS.update(h=HX.build(5)), daemon=True).start()
    return HXS["h"]


def api_expiry(q):
    sym = (q.get("sym") or ["NIFTY"])[0].upper()
    h = hx()
    s = HX.series(sym, h)
    exp = (q.get("exp") or [None])[0]
    if exp and exp != s["current"]:
        s["cycle"] = [{"date": d, **h["days"][d][sym][exp]} for d in sorted(h["days"]) if exp in h["days"][d].get(sym, {})]
        s["current"] = exp
    if not s["cycle"]:
        return {"error": f"No option history for {sym}"}
    rec = [r for r in s["record"] if r["gap_pct"] is not None]
    within = sum(1 for r in rec if abs(r["gap_pct"]) <= 1)
    first, last = s["cycle"][0], s["cycle"][-1]
    nice = datetime.strptime(s["current"], "%Y-%m-%d").strftime("%d %b")
    asof = None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%d-%b-%Y"):          # whichever form the history keys use
        try:
            asof = datetime.strptime(str(last.get("date")), fmt).strftime("%d %b")
            break
        except ValueError:
            pass
    s["headline"] = (f"{sym}, {nice} expiry{f', at the {asof} close' if asof else ''}: max pain {last['mp']:,.0f}, PCR {last['pcr']:.2f}, spot {last['spot']:,.0f}. "
                     + (f"In the last {len(rec)} expiries, price settled within 1% of the max pain seen three sessions earlier {within} times." if rec else ""))
    s["first"], s["last"] = first, last
    return s


# ---------------------------------------------------------------- results calendar
RES = {"data": None, "ts": 0, "busy": False}
try:                                   # start from the last saved calendar so pages are not empty after a restart
    _saved = json.load(open(os.path.join(DATA, "results_cal.json"), encoding="utf8"))
    if time.time() - _saved["ts"] < 12 * 3600:
        RES.update(data=_saved["rows"], ts=_saved["ts"])
except Exception:
    pass


def build_results():
    if RES["busy"]:
        return
    RES["busy"] = True
    try:
        for _ in range(90):                   # the usual-move column needs the calm data first
            if not CALM["busy"]:
                break
            time.sleep(2)
        if CALM["data"] is None:
            build_calm()
        fno = set(nse.fno_list())
        _, exps = nearest_expiry("RELIANCE")
        exp_d = [(e, datetime.strptime(e, "%d-%b-%Y")) for e in exps]
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        seen, rows = set(), []
        evs = []
        for e in nse.events():
            if "result" not in (e.get("purpose") or "").lower() or e["symbol"] not in fno or e["symbol"] in seen:
                continue
            try:
                d = datetime.strptime(e["date"], "%d-%b-%Y")
            except ValueError:
                continue
            if today <= d <= today + timedelta(days=21):
                seen.add(e["symbol"]); evs.append((d, e))
        calm = {p["sym"]: p for p in (CALM["data"] or {}).get("points", [])}
        for d, e in sorted(evs, key=lambda x: x[0]):
            exp = next((x for x, xd in exp_d if xd >= d), None)
            if not exp:
                continue
            try:
                o = E.option_summary(nse.option_chain(e["symbol"], exp, ttl=1800), exp)
            except Exception:
                continue
            if o.get("error") or not o["spot"]:
                continue
            mv = o["straddle"] / o["spot"] * 100
            rv = calm.get(e["symbol"], {}).get("rv")
            usual = rv / 100 * (o["dte"] / 365) ** 0.5 * 100 * 0.8 if rv else None   # typical straddle-sized move without an event
            rows.append({"sym": e["symbol"], "company": e.get("company", ""), "date": d.strftime("%d %b"), "iso": d.strftime("%Y-%m-%d"),
                         "dow": d.strftime("%a"), "expiry": exp, "dte": o["dte"], "spot": o["spot"], "move_pct": round(mv, 2),
                         "move_rs": round(o["straddle"], 2), "lo": round(o["spot"] - o["straddle"], 2), "hi": round(o["spot"] + o["straddle"], 2),
                         "iv": o["atm_iv"], "usual_pct": round(usual, 2) if usual else None,
                         "premium": round(mv / usual, 2) if usual else None, "pcr": o["pcr"]})
        RES.update(data=rows, ts=time.time())
        json.dump({"ts": RES["ts"], "rows": rows}, open(os.path.join(DATA, "results_cal.json"), "w", encoding="utf8"))
        try:
            record_priced(rows)
        except Exception:
            traceback.print_exc()
    finally:
        RES["busy"] = False


def api_results(q):
    if RES["data"] is None:
        build_results()
    elif time.time() - RES["ts"] > 1800:
        threading.Thread(target=build_results, daemon=True).start()
    if RES["data"] is None:
        return {"rows": [], "building": True, "headline": "Pricing every upcoming result. This takes about a minute the first time."}
    rows = RES["data"] or []
    if not rows:
        return {"rows": [], "headline": "No F&O company results in the next three weeks."}
    big = max(rows, key=lambda r: r["move_pct"])
    return {"rows": rows, "headline": f"{len(rows)} F&O companies report in the next three weeks. Options price the biggest move in "
                                     f"{big['sym']}, about ±{big['move_pct']:.1f}% by the {big['expiry'][:6]} expiry."}


# ---------------------------------------------------------------- today + stock
def api_search(q):
    return {"items": SD.search_list()}


def market_state(p):
    b = p["breadth"]; tot = (b["adv"] + b["dec"]) or 1; dec = b["dec"] / tot
    vix = next((m for m in p["main"] if m["name"] == "INDIA VIX"), None)
    vchg = float(vix["chg"]) if vix else 0
    n50 = next((m for m in p["main"] if m["name"] == "NIFTY 50"), None)
    nchg = float(n50["chg"]) if n50 else 0
    if dec >= 0.8 and nchg <= -1 and vchg > 0:
        return "Bhaari Mandi", "dn", "Almost everything fell and fear is rising fast."
    if dec >= 0.65 and vchg > 0:
        return "Mandi", "dn", "Selling is broad and fear is rising."
    if dec >= 0.65:
        return "Bikwali", "dn", "Most stocks fell, but there is no panic."
    # VIX often rises on a big up day as traders buy protection before events. On a strong day that is
    # a footnote in the line, not a reason to call the day cautious.
    vix_note = " India VIX rose too, so options got pricier." if vchg > 0 else ""
    if dec <= 0.35 and nchg >= 1.5:
        return "Bumper Tezi", "up", f"Nifty up {nchg:.1f}% and most stocks rose with it.{vix_note}"
    if dec <= 0.2 and nchg >= 1:
        return "Bumper Tezi", "up", f"Almost everything rose.{vix_note}" if vix_note else "Almost everything rose and fear is easing."
    if dec <= 0.35 and (vchg <= 0 or nchg >= 1):
        return "Tezi", "up", f"Buying is broad, Nifty up {nchg:.1f}%.{vix_note}" if vix_note else "Buying is broad and fear is easing."
    if dec <= 0.35:
        return "Tezi, sambhal ke", "up", (f"Most stocks rose, but the Nifty gained only {nchg:.1f}% and traders kept buying protection." if nchg < 0.5
                                          else f"Most stocks rose and the Nifty gained {nchg:.1f}%, but traders kept buying protection.")
    # a strong index day with more stocks up than down is a rally, even if the smaller stocks lagged
    if nchg >= 0.75 and dec < 0.5:
        return ("Tezi" if nchg >= 1 or vchg <= 0 else "Tezi, sambhal ke"), "up", (f"Nifty up {nchg:.1f}%, led by the big stocks. The wider market rose less."
                                                                                   + (vix_note if nchg >= 1 else " Traders kept buying protection." if vchg > 0 else ""))
    if nchg <= -0.75 and dec > 0.5:
        return ("Mandi" if vchg > 0 else "Bikwali"), "dn", (f"Nifty down {abs(nchg):.1f}%, led by the big stocks. The wider market fell less"
                                                            + (", and fear is rising." if vchg > 0 else ", with no panic."))
    if abs(nchg) < 0.25:
        return "Bazaar so raha hai", "neutral", "A quiet day. Neither side is pushing."
    return "Na tezi, na mandi", "neutral", "Neither side has control. Stock picking matters more than direction."


def api_today(q):
    p = api_pulse(q)
    o = api_options({"sym": ["NIFTY"]}); o.pop("rows", None)
    b = api_options({"sym": ["BANKNIFTY"]}); b.pop("rows", None)
    state, tone, line = market_state(p)
    reads = INS.pulse({**p, "mood": None})[:3]     # the mood word is already the big box on Today
    upcoming = []
    if RES["data"]:
        today = datetime.now().strftime("%Y-%m-%d")
        nxt = sorted({r["iso"] for r in RES["data"] if r["iso"] >= today})[:2]
        upcoming = [r for r in RES["data"] if r["iso"] in nxt][:8]
    nifty = next((m for m in p["main"] if m["name"] == "NIFTY 50"), {})
    bank = next((m for m in p["main"] if m["name"] == "NIFTY BANK"), {})
    vix = next((m for m in p["main"] if m["name"] == "INDIA VIX"), {})
    lv = lambda x, nm: {"name": nm, "spot": x["spot"], "floor": x["floor"], "ceiling": x["ceiling"], "move": x["straddle"], "expiry": x["expiry"]}
    return {"ts": p["ts"], "open": p["open"], "state": state, "tone": tone, "line": line,
            "headline": f"{state}. {line}", "nifty": nifty, "bank": bank, "vix": vix, "breadth": p["breadth"],
            "levels": [lv(o, "Nifty"), lv(b, "Bank Nifty")], "reads": reads, "upcoming": upcoming, "brief": brief(o, upcoming),
            "leaders": p["sectors"][:3], "laggards": p["sectors"][-3:], "focus": api_focus({})["rows"][:6], "focus_stamp": focus_stamp()}


def brief(o, upcoming):
    """Three facts to carry into the session. Dates and data, nothing to act on."""
    out = []
    now = datetime.now()
    try:
        if upcoming:
            first = upcoming[0]["iso"]
            names = [r["sym"] for r in upcoming if r["iso"] == first]
            d = datetime.strptime(first, "%Y-%m-%d")
            when = "Today" if d.date() == now.date() else d.strftime("%a %d %b")
            out.append({"k": "Results", "t": f"{when}: {', '.join(names[:3])}" + (f" and {len(names) - 3} more" if len(names) > 3 else "")})
    except Exception:
        traceback.print_exc()
    try:
        e = datetime.strptime(o["expiry"], "%d-%b-%Y")
        days = (e.date() - now.date()).days
        out.append({"k": "Expiry", "t": f"Nifty {'today' if days == 0 else 'tomorrow' if days == 1 else e.strftime('%a %d %b')}, priced move ±{o['straddle']:,.0f} points"})
    except Exception:
        traceback.print_exc()
    try:
        it = {x["name"]: x for x in api_global({})["items"]}
        bits = [f"{n} {it[n]['chg']:+.1f}%" for n in ("S&P 500", "Nikkei 225", "Brent crude") if n in it and it[n].get("chg") is not None]
        if bits:
            out.append({"k": "Overnight", "t": " · ".join(bits)})
    except Exception:
        traceback.print_exc()
    return out


def latest_price(d):
    """Yahoo can run a session behind NSE. The headline price follows NSE's all-stocks feed when it has the stock."""
    try:
        r = market_rows()["bysym"].get(d.get("sym"))
        p = d.get("price")
        if r and p and r.get("l"):
            old, new = p.get("last"), round(float(r["l"]), 2)
            if old and new != old:            # returns follow the headline price, so the page never shows two different one-year figures
                cs = d.get("candles") or []
                if cs and abs(cs[-1]["c"] - old) < 1e-6:
                    cs[-1] = {**cs[-1], "c": new, "h": max(cs[-1]["h"], new), "l": min(cs[-1]["l"], new)}
                for k in ("r1m", "r3m", "r1y"):
                    if p.get(k) is not None:
                        p[k] = round(((1 + p[k] / 100) * new / old - 1) * 100, 1)
            p.update(last=new, chg=r["p"], asof=str(market_rows()["ts"])[:11].replace("-", " "))
    except Exception:
        traceback.print_exc()


def api_stock(q):
    sym = (q.get("sym") or ["RELIANCE"])[0].upper().strip()
    SD.init()
    if sym not in SD.STATE["master"] and not SD.load_fund(sym):
        now_ = next((k for k, v in SD.WAS.items() if sym in [x.upper().replace(" ", "") for x in v]), None)
        return {"error": f"{sym} now trades as {now_}. Search {now_} to open it." if now_ else f"We do not have {sym}. Check the symbol, for example RELIANCE or HDFCBANK."}
    out = {"sym": sym}
    try:
        out["rstatus"] = SD.results_status(sym, nse)
    except Exception:
        traceback.print_exc()
    out.update(SD.fundamentals(sym))
    SD.add_ratios(out)
    try:
        candles = yahoo.history(yf_symbol(sym), period="2y", interval="1d", ttl=900)
    except Exception:
        candles = []
    # a 30%+ overnight gap is almost always a demerger, split or bonus the feed did not adjust
    # (Tata Motors to TMPV, Oct 2025). Start the history after the break instead of drawing a fake crash.
    for i in range(len(candles) - 1, 0, -1):
        pc, op = candles[i - 1]["c"], candles[i]["o"]
        if pc and abs(op / pc - 1) > 0.30:
            out["price_break"] = {"date": datetime.fromtimestamp(candles[i]["t"]).strftime("%d %b %Y"),
                                  "from": round(pc, 2), "to": round(op, 2)}
            candles = candles[i:]
            break
    fno = sym in set(nse.fno_list())
    opt = None
    if fno:
        try:
            opt = api_options({"sym": [sym]}, watch=False)     # a stock page reads the chain once; it does not join the per-minute polling
            opt.pop("rows", None)
        except Exception:
            opt = None
    if candles:
        c = [x["c"] for x in candles]
        last = c[-1]
        ret = lambda n: round((last / c[-n - 1] - 1) * 100, 1) if len(c) > n else None   # None when history is shorter
        out["price"] = {"last": round(last, 2), "chg": round((last / c[-2] - 1) * 100, 2) if len(c) > 1 else 0,
                        "hi52": round(max(x["h"] for x in candles[-250:]), 2), "lo52": round(min(x["l"] for x in candles[-250:]), 2),
                        "r1m": ret(21), "r3m": ret(63), "r1y": ret(250), "asof": datetime.fromtimestamp(candles[-1]["t"]).strftime("%d %b %Y")}
        out["candles"] = [{"t": x["t"], "o": round(x["o"], 2), "h": round(x["h"], 2), "l": round(x["l"], 2), "c": round(x["c"], 2)} for x in candles[-260:]]
        try:
            out["structure"] = ST.for_page(candles, start_t=out["candles"][0]["t"])
        except Exception:
            traceback.print_exc()
        try:
            import chartscore as CS
            vx = yahoo.history("^INDIAVIX", period="1mo", interval="1d", ttl=3600)
            out["chart"] = CS.score_candles(candles, vx[-1]["c"] if vx else None)
        except Exception:
            traceback.print_exc()
        try:
            tech = E.radar(candles, opt)
            if not tech.get("error"):
                out["tech"] = tech
        except ZeroDivisionError:
            pass                                  # no traded volume in the window: nothing to read
    if opt and not opt.get("error"):
        out["opt"] = {k: opt.get(k) for k in ("spot", "pcr", "max_pain", "floor", "ceiling", "atm_iv", "straddle", "expiry", "momentum", "call_wall", "put_wall")}
    out["fno"] = fno
    # futures buildup from total OI across expiries (rollover-proof)
    try:
        import history as H
        n = H.fut_net(sym)
        if n:
            out["fut_net"] = n
    except Exception:
        pass
    res = next((r for r in (RES["data"] or []) if r["sym"] == sym), None)
    if res:
        out["results"] = res
    else:
        try:
            for e in nse.events():
                if e["symbol"] == sym and "result" in (e.get("purpose") or "").lower():
                    d = datetime.strptime(e["date"], "%d-%b-%Y")
                    if d.date() >= datetime.now().date():
                        out["results"] = {"date": d.strftime("%d %b"), "dow": d.strftime("%a")}
                        break
        except Exception:
            pass
    out["pattern"] = SD.pattern_for(sym)
    out["call"] = SD.desk_call(sym)
    latest_price(out)
    live_valuation(out)
    return out


def live_valuation(out):
    """P/E, P/B, dividend yield and market value at the price the page shows, not the day the figures were copied."""
    lv = SD.live_val(out.get("sym"), (out.get("price") or {}).get("last"))
    if lv:
        mine = out.get("mine") or {}
        for k in ("pe", "pb", "dy"):
            if mine.get(k) is not None and lv.get(k) is not None:
                mine[k] = lv[k]
        if lv.get("mcap") and out.get("profile"):
            out["profile"] = {**out["profile"], "mcap": lv["mcap"]}


# ---------------------------------------------------------------- stock cache, warm-up, my stocks
from concurrent.futures import ThreadPoolExecutor
STOCK_CACHE = {}
STOCK_LOCKS = defaultdict(threading.Lock)


def get_stock(sym, max_age=None):
    sym = sym.upper().strip()
    ttl = max_age if max_age is not None else (1200 if STATE["market_open"] else 4 * 3600)
    hit = STOCK_CACHE.get(sym)
    if hit and time.time() - hit[0] < ttl:
        return _fresh_call(hit[1])
    if hit and max_age is None:
        if not STOCK_LOCKS[sym].locked() and PENDING["n"] < 10:      # a queue longer than that just waits for the next visit
            PENDING["n"] += 1
            threading.Thread(target=_refresh, args=(sym,), daemon=True).start()   # refresh behind the scenes
        return _fresh_call(hit[1])
    with STOCK_LOCKS[sym]:
        hit = STOCK_CACHE.get(sym)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        with COLD_SEM:                     # never more than three fresh builds at once, however many visitors
            return _build_stock(sym, locked=True)


COLD_SEM = threading.BoundedSemaphore(3)
REFRESH_SEM = threading.BoundedSemaphore(2)
PENDING = {"n": 0}


def _refresh(sym):
    with REFRESH_SEM:                      # at most two background refreshes at a time, to stay polite to NSE
        try:
            _build_stock(sym)
        finally:
            PENDING["n"] -= 1


def _build_stock(sym, locked=False):
    if not locked:
        if not STOCK_LOCKS[sym].acquire(blocking=False):
            return (STOCK_CACHE.get(sym) or (0, {}))[1]
    try:
        d = api_stock({"sym": [sym]})
        rs = d.get("rstatus") or {}
        if not d.get("error") and rs.get("state") == "out" and rs.get("filed_dt"):
            try:
                fdt = datetime.strptime(rs["filed_dt"], "%d-%b-%Y %H:%M:%S")
                if (datetime.now() - fdt).days <= 30:
                    d["result_card"] = make_card(sym, d, fdt)
            except Exception:
                traceback.print_exc()
        if not d.get("error"):
            try:
                d["read"] = INS.stock(d); d["summary"] = INS.summary(d)
                d["changes"] = INS.changes(d)
            except Exception:
                traceback.print_exc()
            old = STOCK_CACHE.get(sym)
            if d.get("candles"):
                STOCK_CACHE[sym] = (time.time(), d)
            elif old and old[1].get("candles"):
                return old[1]                     # a failed price fetch never replaces a good page
            else:
                STOCK_CACHE[sym] = (0, d)         # shown for now, retried on the next visit
        return d
    finally:
        if not locked:
            STOCK_LOCKS[sym].release()


CACHE_FILE = os.path.join(DATA, "stock_cache.pkl")


SAVE_LOCK = threading.Lock()


def save_cache():
    import pickle
    try:
        with SAVE_LOCK:                           # two savers at once collide on the temp file
            with open(CACHE_FILE + ".tmp", "wb") as fh:      # closed before the rename, or Windows refuses it
                pickle.dump(dict(STOCK_CACHE), fh)
            os.replace(CACHE_FILE + ".tmp", CACHE_FILE)
    except Exception:
        traceback.print_exc()


def load_cache():
    """Pages open instantly after a restart: last known data is served while fresh data loads."""
    import pickle
    try:
        if os.path.exists(CACHE_FILE) and time.time() - os.path.getmtime(CACHE_FILE) < 3 * 86400:
            STOCK_CACHE.update(pickle.load(open(CACHE_FILE, "rb")))
            for sym, (ts, d) in list(STOCK_CACHE.items()):
                if not d.get("candles") or ("chart" not in d and d.get("candles")):
                    STOCK_CACHE[sym] = (0, d)                  # empty, or saved before chart strength existed: refresh in the background
            STATE["warm_done"] = "from disk"
            threading.Thread(target=reword_cache, daemon=True).start()   # pages are served from the start; wording catches up behind
    except Exception:
        traceback.print_exc()


def reword_cache():
    """Saved pages follow the current wording rules, not the ones they were saved under."""
    for sym, (ts, d) in list(STOCK_CACHE.items()):
        try:
            SD.add_ratios(d)
            live_valuation(d)
            if d.get("fut_net"):
                d["fut_net"] = HX.fut_net(sym) or d["fut_net"]
            rs = d.get("rstatus") or {}
            if d.get("result_card") and rs.get("filed_dt"):
                d["result_card"] = make_card(sym, d, datetime.strptime(rs["filed_dt"], "%d-%b-%Y %H:%M:%S"))
            d["read"] = INS.stock(d); d["summary"] = INS.summary(d); d["changes"] = INS.changes(d)
        except Exception:
            pass


def _fresh_call(d):
    """Desk calls change outside the cache, so read them on every request."""
    c = SD.desk_call(d["sym"])
    if c != d.get("call"):
        d["call"] = c
        d["changes"] = INS.changes(d)
    return d


def api_stock_cached(q):
    d = get_stock((q.get("sym") or ["RELIANCE"])[0])
    if not d.get("error"):
        latest_price(d)
        if (d.get("structure") or {}).get("v") != ST.VERSION and d.get("candles"):
            try:                                   # pages cached before structure existed, or before its rules last changed
                d["structure"] = ST.for_page(d["candles"])
                d["read"] = INS.stock(d); d["summary"] = INS.summary(d)     # the trend tile reads the structure
            except Exception:
                traceback.print_exc()
                d["structure"] = None
        if d.get("structure"):
            d["structure"]["tested"] = structure_tested()
    return d


# ---------------------------------------------------------------- price structure (structure.py)
STRUCT_STATS = {"mt": 0, "data": None}


def structure_stats():
    """data/structure_stats.json, written by structure_test.py. Re-read when the file changes."""
    p = os.path.join(DATA, "structure_stats.json")
    try:
        mt = os.path.getmtime(p)
        if mt != STRUCT_STATS["mt"]:
            STRUCT_STATS.update(data=json.load(open(p, encoding="utf8")), mt=mt)
    except (OSError, ValueError):
        pass
    return STRUCT_STATS["data"]


def structure_tested():
    s = structure_stats()
    if not s:
        return None
    return {"built": s["built"], "source": s["source"], "stocks": s["stocks"], "span": s["span"],
            "lines": {k: v["line"] for k, v in s["kinds"].items()}}


def api_structure_stats(q):
    s = structure_stats()
    return s or {"error": "The structure test has not been run yet."}


def api_structure_today(q, scope="fno"):
    """Market-wide counts of today's structure events, from the last all-stock scan."""
    p = os.path.join(DATA, "structure_scan.json")
    try:
        book = json.load(open(p, encoding="utf8"))
    except (OSError, ValueError):
        return {"error": "The first scan has not run yet. It runs after the close."}
    fno = set(nse.fno_list())
    SD.init()
    master = SD.STATE.get("master") or {}
    rows = {k: v for k, v in book["rows"].items() if (k in fno if scope == "fno" else True)}
    day = max((r["day"] for r in rows.values()), default=None)
    groups = {}
    for sym, r in rows.items():
        if r["day"] != day:
            continue
        for e in r["today"]:
            key = f'{e["kind"]}_{e["dir"]}'
            groups.setdefault(key, []).append({"sym": sym, "name": (master.get(sym) or {}).get("name") or sym, "cap": (master.get(sym) or {}).get("cap") or "Micro"})
    shape = {"up": 0, "down": 0, "none": 0}
    for r in rows.values():
        shape[r["trend"]] = shape.get(r["trend"], 0) + 1
    return {"day": day, "built": book.get("built"), "scope": scope, "stocks": len(rows), "groups": groups, "shape": shape,
            "fresh": sum(1 for r in rows.values() if r.get("fresh"))}


def watch_row(sym):
    d = get_stock(sym)
    if d.get("error"):
        return {"sym": sym, "error": d["error"]}
    res = next((r for r in (RES["data"] or []) if r["sym"] == sym), None)
    if res and not (d.get("results") or {}).get("move_pct"):
        d["results"] = res                      # results pricing may have loaded after this stock was cached
        d["changes"] = INS.changes(d)
    p = d.get("price") or {}
    return {"sym": sym, "name": (d.get("profile") or {}).get("name") or sym, "industry": ((d.get("industry") or [None])[-1] or (d.get("profile") or {}).get("sector_name")),
            "last": p.get("last"), "chg": p.get("chg"), "r1m": p.get("r1m"), "glance": d.get("glance", []),
            "changes": d.get("changes", []), "call": d.get("call"), "spark": [c["c"] for c in (d.get("candles") or [])[-60:]],
            "floor": (d.get("opt") or {}).get("floor"), "ceiling": (d.get("opt") or {}).get("ceiling"),
            "rstate": (d.get("rstatus") or {}).get("state"), "filed": (d.get("rstatus") or {}).get("filed"),
            "quarter": (d.get("rstatus") or {}).get("quarter"), "res_date": (d.get("results") or {}).get("date"),
            "in_focus": any(f["sym"] == sym for f in FOCUS["data"])}


def api_watch(q):
    syms = [s for s in ((q.get("syms") or [""])[0]).upper().replace(" ", "").split(",") if s][:30]
    if not syms:
        return {"rows": []}
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(watch_row, syms))
    flagged = sum(1 for r in rows if any(c["tone"] in ("dn", "warn") for c in r.get("changes", [])))
    news = sum(len(r.get("changes", [])) for r in rows)
    head = (f"{len(rows)} stocks on your list. {news} things worth knowing" + (f", {flagged} need a look." if flagged else ".")) if news else f"{len(rows)} stocks on your list. Nothing unusual today."
    return {"rows": rows, "headline": head}


FOCUS = {"data": [], "ts": 0}


def build_focus():
    """Rank every stock we hold in memory by how much is going on, and explain each."""
    SD.init()                                # sizes are needed for the small-cap limit below
    if REP["data"] is None:
        api_reported({})                     # results cards first: without them a results move reads as a plain big move
    recent = (datetime.now() - timedelta(days=10)).strftime("%Y-%m-%d")
    cards = {c["sym"]: c for c in (REP["data"] or []) if c["filed_iso"] >= recent}   # only fresh results move a stock into focus
    rows = []
    for sym, (ts, d) in list(STOCK_CACHE.items()):
        if d.get("error") or sym in INDEX_SYMBOLS:
            continue
        try:
            u = UNI.get(sym)
            cap_ = (SD.STATE["master"].get(sym) or {}).get("cap")
            if cap_ == "Micro":
                continue                                  # thin and easy to move, never spotlighted
            floor_ = {"Small": 2}.get(cap_, 1)            # ₹ crore a day: smaller stocks need more trading to mean anything
            if u and (u.get("tv20") or 0) < floor_:
                continue                                  # too thinly traded to read anything into
            f = INS.focus(d, cards.get(sym), u)
        except Exception:
            traceback.print_exc(); continue
        if not f or f["score"] < 3:
            continue
        p = d.get("price") or {}
        rows.append({"sym": sym, "name": (d.get("profile") or {}).get("name") or sym, "industry": ((d.get("industry") or [None])[-1] or (d.get("profile") or {}).get("sector_name")),
                     "cap": (SD.STATE["master"].get(sym) or {}).get("cap"),
                     "last": p.get("last"), "chg": p.get("chg"), "spark": [c["c"] for c in (d.get("candles") or [])[-60:]], **f})
    rows.sort(key=lambda r: -r["score"])
    # keep both sides of the market in view: at most 4 of one tone in the top 6
    top, n, small = [], {"up": 0, "dn": 0, "warn": 0}, 0
    for r in rows:
        is_small = r.get("cap") in ("Small", "Micro")
        if n[r["tone"]] < 4 and not (is_small and small >= 3):     # both sides of the market, and not all small caps
            top.append(r); n[r["tone"]] += 1; small += is_small
        if len(top) == 8:
            break
    FOCUS.update(data=top, ts=time.time(), pool=len(STOCK_CACHE))
    if STATE.get("warm_done") and REP["data"] is not None:
        try:
            log_focus(top[:6])
        except Exception:
            traceback.print_exc()
    return top


def last_session():
    """The session NSE's all-stocks feed is showing. Cached pages can lag it when Yahoo runs a day behind."""
    try:
        return datetime.strptime(str(market_rows()["ts"])[:11], "%d-%b-%Y")
    except Exception:
        return None


def focus_stamp():
    """'Updated 10:42' while the market is open, else which close the list is from."""
    if STATE["market_open"]:
        return {"live": True, "text": "Live, updated " + datetime.fromtimestamp(FOCUS["ts"]).strftime("%H:%M") + ", refreshes through the day"}
    day = last_session()
    return {"live": False, "text": f"From the {day.strftime('%d %b')} close" if day else "From the last close"}


def api_focus(q):
    if time.time() - FOCUS["ts"] > 300:
        build_focus()
    return {"rows": FOCUS["data"], "pool": FOCUS.get("pool", 0), "stamp": focus_stamp()}


def live_focus():
    """While the market is open, keep the stocks most likely to be in focus fresh:
    today's focus list and the day's biggest F&O movers first, then the rest in rotation."""
    time.sleep(60)
    rot = 0
    while True:
        try:
            if STATE["market_open"]:
                movers = []
                try:
                    m = api_pulse({}).get("movers", {})
                    movers = [x["sym"] for k in ("gainers_fo", "loosers_fo") for x in m.get(k, [])[:8]]
                except Exception:
                    pass
                first = list(dict.fromkeys([r["sym"] for r in FOCUS["data"]] + movers))
                rest = sorted(STOCK_CACHE)
                batch = first + rest[rot:rot + 15]
                rot = (rot + 15) % max(len(rest), 1)
                for sym in batch:
                    try:
                        get_stock(sym, max_age=600)
                    except Exception:
                        pass
                    time.sleep(0.5)
                build_focus()
                time.sleep(60)
            else:
                time.sleep(300)
        except Exception:
            traceback.print_exc(); time.sleep(120)


# ---------------------------------------------------------------- track record of Stocks in focus
# Every closed session, the day's picks are written down with their lean and closing price.
# 5 and 20 sessions later each one is checked against an index of similar-size stocks. Nothing is ever edited after the fact.
TRACK = os.path.join(DATA, "focus_log.json")
TRACK_LOCK = threading.Lock()
TRACK_CUTOFF = 21              # a session's list is final at 9 pm that evening; anything first written later is marked late and not scored
TRACK_BENCH = {"Large": ("^CNX100", "Nifty 100"), "Mid": ("NIFTYMIDCAP150.NS", "Midcap 150"),
               "Small": ("NIFTYSMLCAP250.NS", "Smallcap 250"), "Micro": ("NIFTYSMLCAP250.NS", "Smallcap 250")}
TRACK_GAP = 5                  # the same stock with the same signal again within 5 sessions is the same call, counted once
TRACK_MIN = {"stocks": 30, "sessions": 20}


def _iso(asof):
    try:
        return datetime.strptime(asof, "%d %b %Y").strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def log_focus(rows):
    """Record the picks of the last closed session. A session's list is frozen once the next one closes."""
    if STATE["market_open"] or not rows:
        return
    day = None
    ls = last_session()
    if ls:
        day = ls.strftime("%Y-%m-%d")
    for r in rows:
        hit = STOCK_CACHE.get(r["sym"])
        if hit and not day:
            day = _iso((hit[1].get("price") or {}).get("asof"))
            if day:
                break
    if not day or datetime.strptime(day, "%Y-%m-%d").weekday() >= 5:
        return                                       # a weekend special session (Muhurat) is not logged
    with TRACK_LOCK:
        try:
            book = json.load(open(TRACK, encoding="utf8")) if os.path.exists(TRACK) else []
        except Exception:
            book = []
        if book and max(e["date"] for e in book) > day:
            return                                   # never write into the past
        now = datetime.now()
        final = datetime.strptime(day, "%Y-%m-%d") + timedelta(hours=TRACK_CUTOFF)
        if now > final and any(e["date"] == day for e in book):
            return                                   # frozen at the cutoff
        book = [e for e in book if e["date"] != day]   # the latest view of this session wins until the cutoff
        for r in rows:
            e = {"date": day, "sym": r["sym"], "lean": r["tone"], "title": r["title"], "tags": r["tags"],
                 "price": r["last"], "logged": now.strftime("%Y-%m-%d %H:%M")}
            if now > final:
                e["late"] = True                     # written after news could have come out: shown, never scored
            book.append(e)
        json.dump(book, open(TRACK, "w", encoding="utf8"), indent=1)


def _closes(ticker):
    out = {}
    for c in yahoo.history(ticker, period="1y", interval="1d", ttl=3600):
        t = datetime.fromtimestamp(c["t"])
        if t.weekday() < 5:                          # a weekend special session (Muhurat) is not a full session
            out[t.strftime("%Y-%m-%d")] = c["c"]
    return out


def api_track(q):
    import statistics as stx
    try:
        book = json.load(open(TRACK, encoding="utf8")) if os.path.exists(TRACK) else []
    except Exception:
        book = []
    nifty = _closes("^NSEI")
    ndays = sorted(nifty)
    pos = {d: k for k, d in enumerate(ndays)}
    bench = {}
    SD.init()                                    # sizes pick each stock's index
    master = SD.STATE.get("master") or {}
    last_seen, rows = {}, []
    for e in sorted(book, key=lambda e: (e["date"], e["sym"])):
        r = dict(e)
        cap = (master.get(e["sym"]) or {}).get("cap") or "Micro"
        tk, r["bench"] = TRACK_BENCH.get(cap, TRACK_BENCH["Micro"])
        r["cap"] = cap
        i = pos.get(e["date"])
        prev = last_seen.get((e["sym"], e["lean"]))
        r["repeat"] = prev is not None and i is not None and i - prev <= TRACK_GAP
        if i is not None:
            last_seen[(e["sym"], e["lean"])] = i
        try:                                     # entries from before the cutoff rule are judged by when they were written
            r["late"] = bool(e.get("late")) or datetime.strptime(e["logged"], "%Y-%m-%d %H:%M") > datetime.strptime(e["date"], "%Y-%m-%d") + timedelta(hours=TRACK_CUTOFF)
        except (KeyError, ValueError):
            r["late"] = bool(e.get("late"))
        r["special"] = datetime.strptime(e["date"], "%Y-%m-%d").weekday() >= 5      # logged before weekend sessions were skipped
        r["counted"] = e["lean"] in ("up", "dn") and not r["repeat"] and not r["late"] and not r["special"]
        if tk not in bench:
            try:
                bench[tk] = _closes(tk)
            except Exception:
                bench[tk] = {}
        bc = bench[tk]
        try:
            px_ = _closes(yf_symbol(e["sym"]))
        except Exception:
            px_ = {}
        if i is not None and e["date"] in px_ and e["date"] in bc:
            for h in (5, 20):
                d1 = ndays[i + h] if i + h < len(ndays) else None
                if d1 and d1 in px_ and d1 in bc:
                    sr = (px_[d1] / px_[e["date"]] - 1) * 100
                    br = (bc[d1] / bc[e["date"]] - 1) * 100
                    r[f"r{h}"], r[f"x{h}"] = round(sr, 2), round(sr - br, 2)
                    r[f"n{h}"] = round(sr - (nifty[d1] / nifty[e["date"]] - 1) * 100, 2)     # against Nifty, for reference
                    if e["lean"] in ("up", "dn"):
                        r[f"ok{h}"] = (sr - br > 0) if e["lean"] == "up" else (sr - br < 0)
            r["age"] = len(ndays) - 1 - i
        rows.append(r)

    def stat(h):
        s_ = [r for r in rows if r["counted"] and f"x{h}" in r]
        up = [r[f"x{h}"] for r in s_ if r["lean"] == "up"]
        dn = [r[f"x{h}"] for r in s_ if r["lean"] == "dn"]
        hits = sum(1 for r in s_ if r[f"ok{h}"])
        out = {"n": len(s_), "stocks": len({r["sym"] for r in s_}), "sessions": len({r["date"] for r in s_}), "hits": hits,
               "rate": round(hits / len(s_) * 100) if s_ else None,
               "luck": round(1.96 * 50 / len(s_) ** 0.5) if s_ else None,       # a coin toss lands within 50% plus or minus this, 19 times in 20
               "up": {"n": len(up), "avg": round(stx.mean(up), 2) if up else None},
               "dn": {"n": len(dn), "avg": round(stx.mean(dn), 2) if dn else None}}
        if up and dn:
            out["spread"] = round(stx.mean(up) - stx.mean(dn), 2)
            if len(up) > 1 and len(dn) > 1:
                out["se"] = round((stx.variance(up) / len(up) + stx.variance(dn) / len(dn)) ** 0.5, 2)
        out["ready"] = out["stocks"] >= TRACK_MIN["stocks"] and out["sessions"] >= TRACK_MIN["sessions"]
        return out
    days = sorted({r["date"] for r in rows})
    summary = {h: stat(h) for h in (5, 20)}
    out_ = lambda r: r["special"] or r["late"]
    excluded = {"special": sum(1 for r in rows if r["special"]),            # each left-out reading counted under one reason only
                "late": sum(1 for r in rows if r["late"] and not r["special"]),
                "mixed": sum(1 for r in rows if not out_(r) and r["lean"] not in ("up", "dn")),
                "repeat": sum(1 for r in rows if not out_(r) and r["lean"] in ("up", "dn") and r["repeat"])}
    try:
        chart = UNI.v3_test(nifty)
        fno_t = None
        try:
            log = json.load(open(UNI.V3LOG, encoding="utf8")) if os.path.exists(UNI.V3LOG) else {}
            fno_t = FN.verdict_test(nifty, {d: {k: v[1] for k, v in r.items()} for d, r in log.items()})
        except Exception:
            traceback.print_exc()
    except Exception:
        traceback.print_exc(); chart = None
    return {"chart": chart, "fno": locals().get("fno_t"), "started": days[0] if days else None, "sessions": len(days), "picks": len(rows),
            "pending5": sum(1 for r in rows if "r5" not in r), "summary": summary, "excluded": excluded, "min": TRACK_MIN,
            "trading": [x for x in ndays if days and x >= days[0]],     # real sessions, so a holiday is not reported as a missed log
            "rows": sorted(rows, key=lambda r: (r["date"], r["sym"]), reverse=True)[:120]}


def universe_job():
    """Scan every stock once a day after the close (about a minute and a half), then give the
    most active ones a full reading so Stocks in focus covers the whole market."""
    time.sleep(30)
    while True:
        try:
            UNI.load()
            age = time.time() - UNI.STATE["ts"]
            after_close = (not STATE["market_open"]) and (datetime.now().hour >= 16 or age > 40 * 3600)
            if age > 18 * 3600 and (after_close or age > 30 * 3600):
                # a missed evening (machine off) must not leave a whole day on stale closes: scan anyway,
                # but only an after-close scan is written into the track record
                SD.init()
                UNI.scan(list(SD.STATE["master"]), log=lambda m: None, record=after_close)
            rep = [c["sym"] for c in (REP["data"] or [])]
            for sym in UNI.candidates(reported=rep):
                try:
                    get_stock(sym, max_age=6 * 3600)
                except Exception:
                    pass
                time.sleep(0.5)
            build_focus()
            save_cache()
        except Exception:
            traceback.print_exc()
        time.sleep(1800)


def nightly():
    """Re-scan chart patterns once a day after the close."""
    import subprocess
    while True:
        try:
            out = os.path.join(DATA, "patterns_today.csv")
            age = time.time() - os.path.getmtime(out) if os.path.exists(out) else 1e9
            if age > 18 * 3600 and (datetime.now().hour >= 16 or age > 40 * 3600):
                subprocess.run([sys.executable, os.path.join(ROOT, "patterns_run.py")], cwd=ROOT, timeout=1800,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for k, (ts, d) in list(STOCK_CACHE.items()):
                    STOCK_CACHE[k] = (0, d)
        except Exception:
            traceback.print_exc()
        time.sleep(1800)


def warm():
    """Pre-load the biggest stocks so their pages open instantly."""
    time.sleep(20)
    while True:
        try:
            SD.init()
            path = next((p for p in (os.path.join(ROOT, "vendor", "ind_nifty100list.csv"), os.path.join(os.path.dirname(ROOT), "fundamental sectors", "ind_nifty100list.csv")) if os.path.exists(p)), "")
            syms = []
            if os.path.exists(path):
                import csv as _csv
                syms = [r["Symbol"] for r in _csv.DictReader(open(path, encoding="utf8"))]
            for s in ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "ITC", "LT", "BHARTIARTL", "TMPV", "ETERNAL", "BAJFINANCE"] + syms:
                try:
                    get_stock(s, max_age=1200 if STATE["market_open"] else 4 * 3600)   # one at a time, never in the background
                except Exception:
                    pass
                time.sleep(0.5)
            STATE["warm_done"] = datetime.now().strftime("%H:%M")
            save_cache()
            preload_all()
        except Exception:
            traceback.print_exc()
        time.sleep(3 * 3600)


def preload_all():
    """Every stock in the universe gets a ready page once a night, so a visitor never waits on a
    live fetch. Runs only outside market hours, one stock at a time, most traded first."""
    rows = UNI.load()
    if not rows:
        return
    busy = lambda: STATE["market_open"] or (datetime.now().weekday() < 5 and 8 <= datetime.now().hour < 16)
    if busy():
        return
    syms = sorted(rows, key=lambda s: -(rows[s].get("tv20") or 0))
    done = 0
    for i, s in enumerate(syms):
        if busy():
            break                                    # morning came: stop and let the live jobs run
        hit = STOCK_CACHE.get(s)
        if hit and time.time() - hit[0] < 16 * 3600:
            continue
        try:
            get_stock(s, max_age=16 * 3600)
            done += 1
        except Exception:
            pass
        time.sleep(0.8)
        if done and done % 100 == 0:
            save_cache()
    STATE["preload"] = {"at": datetime.now().strftime("%d %b %H:%M"), "built": done, "cached": len(STOCK_CACHE)}
    save_cache()


# ---------------------------------------------------------------- just reported
PRICED = os.path.join(DATA, "priced_moves.json")
REP = {"data": None, "ts": 0, "busy": False}


def record_priced(rows):
    """Keep what options priced before each result, so we can compare after."""
    try:
        book = json.load(open(PRICED, encoding="utf8")) if os.path.exists(PRICED) else {}
    except Exception:
        book = {}
    today = datetime.now().strftime("%Y-%m-%d")
    for r in rows:
        key = f"{r['sym']}|{r['iso']}"
        if r["iso"] >= today:                 # only before the event; never overwrite after it
            book[key] = {"move_pct": r["move_pct"], "spot": r["spot"], "expiry": r["expiry"], "recorded": today}
    json.dump(book, open(PRICED, "w", encoding="utf8"), indent=1)


def priced_for(sym, day):
    try:
        book = json.load(open(PRICED, encoding="utf8"))
    except Exception:
        return None
    best = None
    for k, v in book.items():
        s, iso = k.split("|")
        if s == sym and abs((datetime.strptime(iso, "%Y-%m-%d").date() - day).days) <= 3:
            best = v
    return best


OI_DAYS = {"mt": None, "days": None}


def oi_days():
    """NSE's daily F&O summary (5 MB): read once, again only when the file changes."""
    f = os.path.join(DATA, "oi_history.json")
    try:
        mt = os.path.getmtime(f)
        if OI_DAYS["mt"] != mt:
            OI_DAYS.update(days=(json.load(open(f, encoding="utf8")) or {}).get("days", {}), mt=mt)
    except Exception:
        return OI_DAYS["days"]
    return OI_DAYS["days"]


def priced_hist(sym, pre_iso, react_iso):
    """What options priced at the close before the reaction day, from NSE's daily F&O files.
    The ATM straddle of the nearest expiry on or after the reaction day, as a % of spot."""
    days = oi_days()
    if days is None:
        return None
    day = days.get(pre_iso) or {}
    exps = day.get(sym) or {}
    best = None
    for exp, v in exps.items():
        if exp >= react_iso and v.get("straddle") and v.get("spot"):
            if best is None or exp < best[0]:
                best = (exp, v)
    if not best:
        return None
    exp, v = best
    return {"move_pct": round(v["straddle"] / v["spot"] * 100, 2), "expiry": exp, "source": "bhavcopy"}


def reaction(candles, filed_dt):
    """Move in the first session that could react to the result."""
    candles = [c for c in candles or [] if c.get("c") == c.get("c") and c.get("c")
               and ist(c["t"]).weekday() < 5]     # Yahoo can leave a blank close; a weekend special session (Muhurat) is not the reaction
    if not candles:
        return None, None
    day = filed_dt.date()
    if filed_dt.hour * 60 + filed_dt.minute >= 15 * 60 + 30 or filed_dt.weekday() >= 5:
        day = day + timedelta(days=1)
    for i, c in enumerate(candles):
        cd = ist(c["t"]).date()
        if cd >= day and i > 0:
            return round((c["c"] / candles[i - 1]["c"] - 1) * 100, 2), cd.strftime("%a %d %b")
    return None, None


def make_card(sym, d, filed):
    rx, rx_day = reaction(d.get("candles"), filed)
    pr = priced_for(sym, filed.date())
    if not pr and rx_day:
        cs = d.get("candles") or []
        for i, x in enumerate(cs):
            if i and ist(x["t"]).strftime("%a %d %b") == rx_day:
                pre = ist(cs[i - 1]["t"]).strftime("%Y-%m-%d")
                pr = priced_hist(sym, pre, ist(x["t"]).strftime("%Y-%m-%d"))
                break
    ls, lp = d.get("latest_sales"), d.get("latest_profit")
    q = d.get("quarters") or {}
    margin = round(lp / ls * 100, 1) if ls and lp is not None and ls > 0 else None
    m_prev = None
    if len(q.get("sales", [])) >= 5 and q["sales"][-5] and q["profit"][-5] is not None and q["sales"][-5] > 0:
        m_prev = round(q["profit"][-5] / q["sales"][-5] * 100, 1)
    c = {"sym": sym, "name": (d.get("profile") or {}).get("name") or sym, "industry": ((d.get("industry") or [None])[-1] or (d.get("profile") or {}).get("sector_name")),
         "filed": filed.strftime("%a %d %b, %H:%M"), "filed_iso": filed.strftime("%Y-%m-%d %H:%M"),
         "quarter": (d.get("rstatus") or {}).get("quarter"), "sales": ls, "profit": lp, "sales_yoy": d.get("sales_yoy"),
         "profit_yoy": d.get("profit_yoy"), "profit_qoq": d.get("profit_qoq"), "margin": margin, "margin_prev": m_prev,
         "reaction": rx, "reaction_day": rx_day, "priced": pr["move_pct"] if pr else None, "priced_exp": (pr or {}).get("expiry"), "lender": d.get("lender"),
         "last": (d.get("price") or {}).get("last")}
    cs = d.get("candles") or []
    if rx_day and cs:
        last_day = ist(cs[-1]["t"]).strftime("%a %d %b")
        c["rx_is_last"] = rx_day == last_day
        for x in cs:
            if ist(x["t"]).strftime("%a %d %b") == rx_day:
                c["since"] = round((cs[-1]["c"] / x["c"] - 1) * 100, 1)
                break
    if len(q.get("profit", [])) >= 5:
        c["profit_prev"] = q["profit"][-5]
    c["read"] = INS.result_card(c)
    return c


def season_start(now):
    """The day after the last quarter end: the whole current results season."""
    m = ((now.month - 1) // 3) * 3                  # 0, 3, 6 or 9: the month the last quarter ended
    if m == 0:
        return datetime(now.year - 1, 12, 31) + timedelta(days=1)
    import calendar
    return datetime(now.year, m, calendar.monthrange(now.year, m)[1]) + timedelta(days=1)


def build_reported():
    """Results cards for every company in our stock list that has reported this results season.
    Cards already built are kept; only new or still-waiting ones are (re)built, and progress is saved as we go."""
    if REP["busy"]:
        return
    REP["busy"] = True
    try:
        if REP["data"] is None and os.path.exists(os.path.join(DATA, "reported.json")):
            try:
                saved = json.load(open(os.path.join(DATA, "reported.json"), encoding="utf8"))
                REP.update(data=saved["cards"], ts=saved["ts"])          # carry on from saved progress
            except Exception:
                pass
        SD.init()
        master = SD.STATE["master"]
        to = datetime.now(); fr = season_start(to)
        anns = []
        d0 = fr
        while d0 <= to:                                   # in weekly slices, so no single request is too big
            d1 = min(d0 + timedelta(days=6), to)
            try:
                anns += nse.get("/api/corporate-announcements", {"index": "equities", "from_date": d0.strftime("%d-%m-%Y"), "to_date": d1.strftime("%d-%m-%Y")}, ttl=1800) or []
            except Exception:
                traceback.print_exc()
            d0 = d1 + timedelta(days=1)
        seen, picks = set(), []
        for a in sorted(anns, key=lambda a: a["an_dt"]):
            if a.get("desc") != "Outcome of Board Meeting" or a["symbol"] not in master or a["symbol"] in seen:
                continue
            txt = (a.get("attchmntText") or "").lower()
            if "result" not in txt and "outcome of board meeting dated" not in txt:
                continue
            seen.add(a["symbol"]); picks.append(a)
        old = {c["sym"]: c for c in (REP["data"] or [])}
        cutoff = fr.strftime("%Y-%m-%d")
        cards = [c for c in old.values() if c["filed_iso"] >= cutoff]
        have = {c["sym"] for c in cards}
        # big companies first, so the cards people look for appear soonest
        order = {"Large": 0, "Mid": 1, "Small": 2, "Micro": 3}
        picks.sort(key=lambda a: order.get((master.get(a["symbol"]) or {}).get("cap"), 4))
        done = 0
        for a in picks:
            sym = a["symbol"]
            prev = old.get(sym)
            if sym in have and prev and prev.get("reaction") is not None and prev["reaction"] == prev["reaction"] \
                    and not str(prev.get("reaction_day") or "").startswith(("Sat", "Sun")):     # cards read off the Muhurat session are rebuilt
                continue                                  # finished card, nothing new to learn
            try:
                d = get_stock(sym)
            except Exception:
                continue
            if d.get("error") or (d.get("rstatus") or {}).get("state") != "out":
                continue
            filed = datetime.strptime(a["an_dt"], "%d-%b-%Y %H:%M:%S")
            c = make_card(sym, d, filed)
            c["cap"] = (master.get(sym) or {}).get("cap")
            cards = [x for x in cards if x["sym"] != sym] + [c]
            done += 1
            if done % 20 == 0:                          # show and save progress without waiting for the whole run
                cards.sort(key=lambda c: c["filed_iso"], reverse=True)
                REP.update(data=list(cards), ts=REP["ts"] or time.time())
                json.dump({"ts": REP["ts"], "cards": cards}, open(os.path.join(DATA, "reported.json"), "w", encoding="utf8"))
        cards.sort(key=lambda c: c["filed_iso"], reverse=True)
        for c in cards:
            c.setdefault("cap", (master.get(c["sym"]) or {}).get("cap"))
        REP.update(data=cards, ts=time.time())
        json.dump({"ts": REP["ts"], "cards": cards}, open(os.path.join(DATA, "reported.json"), "w", encoding="utf8"))
        save_cache()
    except Exception:
        traceback.print_exc()
    finally:
        REP["busy"] = False


def api_reported(q):
    if REP["data"] is None and os.path.exists(os.path.join(DATA, "reported.json")):
        try:
            saved = json.load(open(os.path.join(DATA, "reported.json"), encoding="utf8"))
            REP.update(data=saved["cards"], ts=saved["ts"])
        except Exception:
            pass
    if REP["data"] is None and not REP["busy"]:
        threading.Thread(target=build_reported, daemon=True).start()
    elif REP["data"] is not None and time.time() - REP["ts"] > 2 * 3600:
        threading.Thread(target=build_reported, daemon=True).start()
    if REP["data"] is None:
        return {"cards": [], "building": True, "headline": "Collecting this week's results. This takes a couple of minutes the first time."}
    cards = REP["data"]
    for c in cards:
        c["read"] = INS.result_card(c)
    up = sum(1 for c in cards if (c["profit_yoy"] or 0) > 0)
    rx = [c for c in cards if c["reaction"] is not None]
    known = [c for c in rx if c.get("cap") in ("Large", "Mid")] or rx
    big = max(known, key=lambda c: abs(c["reaction"])) if known else None
    lm = sum(1 for c in cards if c.get("cap") in ("Large", "Mid"))
    q = next((c.get("quarter") for c in cards if c.get("quarter")), "")
    head = (f"{len(cards)} companies have reported the {q} quarter so far, {lm} of them large or mid caps. {up} grew profit on last year."
            + (f" Biggest reaction among large and mid caps: {big['sym']} {big['reaction']:+.1f}%." if big else "")
            + (" More cards are being added as they load." if REP["busy"] else ""))
    return {"cards": cards, "headline": head}


def api_compare(q):
    a = (q.get("a") or ["HDFCBANK"])[0].upper(); b = (q.get("b") or ["ICICIBANK"])[0].upper()
    with ThreadPoolExecutor(2) as ex:
        da, db = ex.map(get_stock, [a, b])
    for d, s_ in ((da, a), (db, b)):
        if d.get("error"):
            return {"error": d["error"]}
    slim = lambda d: {k: d.get(k) for k in ("sym", "profile", "price", "mine", "peer", "lender", "latest_q", "sales_yoy", "profit_yoy",
                                             "sales_cagr5", "profit_cagr5", "tech", "opt", "glance", "own", "chart")}
    return {"a": slim(da), "b": slim(db), "diff": INS.compare(da, db), "verdict": INS.verdict(da, db)}


# ---------------------------------------------------------------- desk calls admin (internal)
import secrets
TOKEN_FILE = os.path.join(DATA, "admin_token.txt")
if not os.path.exists(TOKEN_FILE):
    open(TOKEN_FILE, "w").write(secrets.token_urlsafe(12))
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN") or open(TOKEN_FILE).read().strip()   # set ADMIN_TOKEN on the host to keep it stable
CALLS_FILE = os.path.join(DATA, "desk_calls.json")
# the research call policy agreed with the CEO
POLICY = {"Short term": {"months": 1, "stop": (5, 15), "rr": 1.5, "quota": (10, "month")},
          "Medium term": {"months": 3, "stop": (15, 20), "rr": 1.5, "quota": (8, "month")},
          "Long term": {"months": 12, "stop": (20, 30), "rr": 1.5, "quota": (4, "month")},
          "Multibagger": {"months": 36, "stop": (30, 40), "rr": 2.5, "quota": (2, "quarter")}}


def load_calls():
    try:
        return [c for c in json.load(open(CALLS_FILE, encoding="utf8")) if not c.get("sample")]
    except Exception:
        return []


def save_calls(calls):
    json.dump(calls, open(CALLS_FILE, "w", encoding="utf8"), indent=2)


def check_call(c, calls):
    """Errors block publishing. Warnings are shown but allowed."""
    errs, warns = [], []
    pol = POLICY.get(c.get("category"))
    if not pol:
        return ["Pick a horizon category."], []
    try:
        lo, hi, stop, t1 = float(c["entry_low"]), float(c["entry_high"]), float(c["stop"]), float(c["target1"])
    except (KeyError, ValueError, TypeError):
        return ["Entry, stop and target 1 must be numbers."], []
    if lo > hi:
        errs.append("Entry low is above entry high.")
    mid = (lo + hi) / 2
    buy = c.get("action") == "BUY"
    if buy and not (stop < lo and t1 > hi):
        errs.append("For a BUY, the stop must sit below the entry and target 1 above it.")
    if not buy and not (stop > hi and t1 < lo):
        errs.append("For a SELL, the stop must sit above the entry and target 1 below it.")
    stop_pct = abs(mid - stop) / mid * 100
    rr = abs(t1 - mid) / abs(mid - stop) if mid != stop else 0
    a, b = pol["stop"]
    if not (a <= stop_pct <= b):
        errs.append(f"Stop is {stop_pct:.1f}% from the entry. Policy for {c['category'].lower()} is {a} to {b}%. Move the call to the right horizon or find a better entry, never tighten the stop to fit.")
    if rr < 1:
        errs.append(f"Risk reward to target 1 is 1:{rr:.2f}. Below 1:1 is a hard reject.")
    elif rr < pol["rr"]:
        errs.append(f"Risk reward to target 1 is 1:{rr:.2f}. Policy minimum for {c['category'].lower()} is 1:{pol['rr']}.")
    if not (c.get("level") or "").strip():
        errs.append("Name the chart level the stop sits under. No named level, no call.")
    if len((c.get("reason") or "").strip()) < 40:
        errs.append("Write the reason in at least a sentence or two.")
    n_, per = pol["quota"]
    now = datetime.now()
    same = [x for x in calls if x.get("category") == c["category"] and x.get("published")]
    def in_period(x):
        d = datetime.strptime(x["published"], "%Y-%m-%d")
        return d.year == now.year and (d.month == now.month if per == "month" else (d.month - 1) // 3 == (now.month - 1) // 3)
    used = sum(1 for x in same if in_period(x))
    if used >= n_:
        warns.append(f"Quota: {used} {c['category'].lower()} calls already this {per}. Policy allows {n_}.")
    if any(x.get("symbol") == c.get("symbol") and x.get("status") == "open" for x in calls):
        errs.append(f"There is already an open call on {c.get('symbol')}. Close it first.")
    return errs, warns, round(stop_pct, 2), round(rr, 2)


BRD_FILE = os.path.join(ROOT, "docs", "brd.html")      # internal BRD: outside web/, sent only with the desk code


def api_brd(handler):
    if handler.headers.get("X-Token") != ADMIN_TOKEN:
        return None, 401
    return open(BRD_FILE, "rb").read(), 200


def api_admin(handler, method, body=None):
    if handler.headers.get("X-Token") != ADMIN_TOKEN:
        return {"error": "Wrong access code."}, 403
    calls = load_calls()
    if method == "GET":
        today = datetime.now().strftime("%Y-%m-%d")
        for c in calls:
            c["expired"] = c.get("status") == "open" and c.get("expires", "9999") < today
        return {"calls": calls, "policy": POLICY}, 200
    op = (body or {}).get("op")
    if op in ("check", "add"):
        c = body.get("call") or {}
        c["symbol"] = (c.get("symbol") or "").upper().strip()
        SD.init()
        if c["symbol"] not in SD.STATE["master"]:
            return {"errors": [f"{c['symbol'] or 'That symbol'} is not in our stock list."], "warnings": []}, 200
        res = check_call(c, calls)
        errs, warns = res[0], res[1]
        info = {"stop_pct": res[2], "rr": res[3]} if len(res) > 2 else {}
        if op == "check" or errs:
            return {"errors": errs, "warnings": warns, **info}, 200
        pub = datetime.now()
        months = POLICY[c["category"]]["months"]
        y, mth = divmod(pub.month - 1 + months, 12)
        try:
            exp = pub.replace(year=pub.year + y, month=mth + 1)
        except ValueError:
            exp = pub.replace(year=pub.year + y, month=mth + 1, day=28)
        call = {"symbol": c["symbol"], "action": c["action"], "category": c["category"],
                "horizon": {"Short term": "Short term (under 1 month)", "Medium term": "Medium term (1 to 3 months)",
                            "Long term": "Long term (3 to 12 months)", "Multibagger": "Multibagger (1 to 3 years)"}[c["category"]],
                "published": pub.strftime("%Y-%m-%d"), "expires": exp.strftime("%Y-%m-%d"),
                "entry_low": float(c["entry_low"]), "entry_high": float(c["entry_high"]), "stop": float(c["stop"]),
                "target1": float(c["target1"]), "target2": float(c["target2"]) if c.get("target2") else None,
                "level": c["level"].strip(), "reason": c["reason"].strip(), "analyst": (c.get("analyst") or "").strip(),
                "analyst_holding": c.get("analyst_holding") or "No", "status": "open", "stop_pct": res[2], "rr": res[3]}
        calls.append(call); save_calls(calls)
        STOCK_CACHE.pop(call["symbol"], None)
        return {"ok": True, "call": call, "warnings": warns}, 200
    if op == "close":
        sym = (body.get("symbol") or "").upper()
        for c in calls:
            if c["symbol"] == sym and c.get("status") == "open":
                c.update(status="closed", closed=datetime.now().strftime("%Y-%m-%d"), exit=float(body.get("exit") or 0),
                         outcome=body.get("outcome") or "Closed early")
                save_calls(calls); STOCK_CACHE.pop(sym, None)
                return {"ok": True}, 200
        return {"error": f"No open call on {sym}."}, 200
    return {"error": "Unknown operation."}, 400


ROUTE_TAB = {"/api/pulse": "pulse", "/api/flow": "flow", "/api/radar": "radar", "/api/calm": "calm", "/api/global": "global",
             "/api/screens": "screens", "/api/results": "results", "/api/expiry": "expiry"}


def with_read(path, q, payload):
    tab = (q.get("tab") or ["options"])[0] if path == "/api/options" else ROUTE_TAB.get(path)
    fn = INS.BY_TAB.get(tab)
    if fn and isinstance(payload, dict) and not payload.get("error"):
        try:
            payload["read"] = fn(payload)
        except Exception:
            traceback.print_exc()
    return payload


ROUTES = {"/api/filings": api_filings, "/api/screener": api_screener, "/api/extra": api_extra, "/api/pulse": api_pulse, "/api/flow": api_flow, "/api/options": api_options, "/api/candles": api_candles,
          "/api/radar": api_radar, "/api/calm": api_calm, "/api/global": api_global, "/api/screens": api_screens,
          "/api/symbols": api_symbols, "/api/status": api_status,
          "/api/expiry": api_expiry, "/api/results": api_results, "/api/today": api_today, "/api/focus": api_focus, "/api/track": api_track, "/api/structure_stats": api_structure_stats, "/api/structure_today": api_structure_today, "/api/structure_today_all": lambda q: api_structure_today(q, "all"), "/api/stock": api_stock_cached, "/api/watch": api_watch, "/api/reported": api_reported, "/api/compare": api_compare,
          "/api/search": api_search, "/api/health": api_health, "/api/livefo": api_livefo, "/api/fno": api_fno, "/api/heatmap": api_heatmap, "/api/sector": api_sector, "/api/rotation": api_rotation}


def public_error(e):
    """What a visitor sees when a request fails: a plain message, never a file path or code detail."""
    if isinstance(e, (FileNotFoundError, OSError, KeyError, TypeError, ValueError, ZeroDivisionError, AttributeError)):
        return "This view could not be built right now. It retries every minute."
    msg = str(e)
    return msg if len(msg) < 160 and not any(c in msg for c in ("/", "\\", "Errno")) else "This view could not be built right now. It retries every minute."


RESP, RESP_TTL, RESP_STALE, RESP_MAX = {}, 15, 300, 3000
RESP_LOCKS = defaultdict(threading.Lock)
NO_RESP = ("/api/health", "/api/status")
QKEYS = ("sym", "exp", "tab", "tf", "syms", "a", "b")           # the only query values any view reads
SYM_KEYS = ("sym", "a", "b", "syms")


def resp_key(path, q):
    """Unknown query values are dropped, so ?x=random cannot skip the shared cache."""
    q = {k: [str(v[0])[:300]] for k, v in q.items() if k in QKEYS and v}
    return path + "?" + "&".join(f"{k}={q[k][0].upper() if k in SYM_KEYS else q[k][0]}" for k in sorted(q)), q


def known(sym):
    SD.init()
    if sym in SD.STATE["master"] or sym in INDEX_SYMBOLS or sym in FN.INDICES:
        return True
    if any(sym in [x.upper().replace(" ", "") for x in v] for v in SD.WAS.values()):
        return True                           # an old name: the stock page explains what it trades as now
    return sym in set(nse.fno_list())


def bad_symbol(q):
    for k in SYM_KEYS:
        for s in (q.get(k) or [""])[0].upper().replace(" ", "").split(","):
            if s and not known(s):
                return s
    return None


def resp_store(key, body, zipped):
    if len(RESP) >= RESP_MAX:
        now = time.time()
        for k, v in list(RESP.items()):
            if now - v[0] > RESP_STALE:
                RESP.pop(k, None)
        if len(RESP) >= RESP_MAX:
            for k, _ in sorted(RESP.items(), key=lambda kv: kv[1][0])[:RESP_MAX // 3]:
                RESP.pop(k, None)
    RESP[key] = (time.time(), body, zipped)


def resp_build(path, q, fn, key):
    body = to_json(with_read(path, q, fn(q)))
    zipped = None
    if len(body) > 2000:
        import gzip
        zipped = gzip.compress(body, 5)
    if path not in NO_RESP:
        resp_store(key, body, zipped)
    return body, zipped


def resp_refresh(path, q, fn, key):
    lock = RESP_LOCKS[key]
    try:
        resp_build(path, q, fn, key)
    except Exception:
        traceback.print_exc()
    finally:
        lock.release()


STATIC_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
                ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json"}
STATIC, STATIC_GZ = {}, tuple(STATIC_TYPES)


class Server(ThreadingHTTPServer):
    request_queue_size = 512                  # the default of 5 refuses connections under a crowd
    daemon_threads = True


def to_json(obj):
    """NaN is not valid JSON and a browser refuses the whole reply, so a blank number becomes null."""
    import re
    body = re.sub(rb'(?<=[:\[,\s])-?(?:NaN|Infinity)(?=[,\]\}\s])', b'null', json.dumps(obj, default=str).encode())
    return body.replace(b"  ", b" ")           # source names sometimes carry a double space


class Handler(SimpleHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def __init__(self, *a, **k):
        super().__init__(*a, directory=WEB, **k)

    def log_message(self, fmt, *args):
        pass

    def _send(self, obj, code=200):
        body = to_json(obj)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path):
        """The app's own files, gzipped once and kept in memory, with browser caching."""
        fs = self.translate_path(path)
        if os.path.isdir(fs):
            fs = os.path.join(fs, "index.html")
        if not fs.startswith(WEB) or not fs.endswith(STATIC_GZ) or not os.path.isfile(fs):
            return False
        mt = os.path.getmtime(fs)
        hit = STATIC.get(fs)
        if not hit or hit[0] != mt:
            import gzip
            raw = open(fs, "rb").read()
            ctype = STATIC_TYPES[os.path.splitext(fs)[1]]
            hit = STATIC[fs] = (mt, raw, gzip.compress(raw, 7), ctype)
        tag = '"%x"' % int(mt * 1000)
        if self.headers.get("If-None-Match") == tag:     # unchanged since the browser's copy: nothing to send
            self.send_response(304)
            self.send_header("ETag", tag)
            self.end_headers()
            return True
        gz = "gzip" in (self.headers.get("Accept-Encoding") or "")
        body = hit[2] if gz else hit[1]
        self.send_response(200)
        self.send_header("Content-Type", hit[3])
        self.send_header("Cache-Control", "no-cache")     # the browser checks every time, so a new release shows at once
        self.send_header("ETag", tag)
        self.send_header("Vary", "Accept-Encoding")
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/api/admin":
            return self._send({"error": "Not found"}, 404)
        try:
            n_ = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n_, 100000)) or b"{}")
            obj, code = api_admin(self, "POST", body)
        except Exception as e:
            traceback.print_exc(); obj, code = {"error": public_error(e)}, 500
        self._send(obj, code)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/admin":
            obj, code = api_admin(self, "GET")
            return self._send(obj, code)
        if u.path == "/api/brd":
            body, code = api_brd(self)
            if code != 200:
                return self._send({"error": "Wrong access code."}, code)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Robots-Tag", "noindex")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        fn = ROUTES.get(u.path)
        if not fn:
            if not u.path.startswith("/api/") and self._static(u.path):
                return
            return super().do_GET()
        key, q = resp_key(u.path, parse_qs(u.query))
        try:
            bad = bad_symbol(q)
        except Exception:
            bad = None
        if bad:                                   # made-up symbols never reach NSE
            return self._send({"error": f"We do not have {bad[:20]}. Check the symbol, for example RELIANCE or HDFCBANK."}, 404)
        hit = None if u.path in NO_RESP else RESP.get(key)
        age = time.time() - hit[0] if hit else 1e9
        body = zipped = None
        code = 200
        if age < RESP_TTL:                        # the same reply for everyone for a few seconds: this is what carries a crowd
            body, zipped = hit[1], hit[2]
        elif age < RESP_STALE:                    # a little old: answer now, rebuild once behind the scenes
            body, zipped = hit[1], hit[2]
            if RESP_LOCKS[key].acquire(blocking=False):
                threading.Thread(target=resp_refresh, args=(u.path, q, fn, key), daemon=True).start()
        else:
            with RESP_LOCKS[key]:                 # first visitor builds it; the rest wait for that one answer
                hit = RESP.get(key)
                if hit and time.time() - hit[0] < RESP_TTL:
                    body, zipped = hit[1], hit[2]
                else:
                    try:
                        body, zipped = resp_build(u.path, q, fn, key)
                    except Exception as e:
                        traceback.print_exc()
                        body, zipped, code = json.dumps({"error": public_error(e)}).encode(), None, 502
        gz = zipped is not None and "gzip" in (self.headers.get("Accept-Encoding") or "")
        if gz:
            body = zipped
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "public, max-age=15" if code == 200 and u.path not in NO_RESP else "no-store")
        self.send_header("Vary", "Accept-Encoding")
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    load_cache()
    threading.Thread(target=live_focus, daemon=True).start()
    threading.Thread(target=universe_job, daemon=True).start()
    threading.Thread(target=collector, daemon=True).start()
    threading.Thread(target=lambda: (build_calm(), build_results()), daemon=True).start()
    threading.Thread(target=hx, daemon=True).start()
    threading.Thread(target=SD.init, daemon=True).start()
    threading.Thread(target=warm, daemon=True).start()
    threading.Thread(target=nightly, daemon=True).start()
    threading.Thread(target=livefo_job, daemon=True).start()
    threading.Thread(target=fut_live_job, daemon=True).start()
    threading.Thread(target=warm_pages, daemon=True).start()
    threading.Thread(target=fno_job, daemon=True).start()
    threading.Thread(target=lambda: (time.sleep(5), build_reported()), daemon=True).start()
    print(f"72 Street AI Dashboard on http://127.0.0.1:{PORT}")
    host = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PORT") else "127.0.0.1")
    Server((host, PORT), Handler).serve_forever()
