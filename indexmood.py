"""Index Mood tab: the market's mood, the move options are pricing, and how option prices compare with actual moves.
Nifty, Bank Nifty and Sensex.

Mood   = where India VIX sits against its own last 252 sessions: bottom third Calm, middle Normal, top third Nervous.
Priced = at-the-money call + put for the nearest expiry, as points and as % of the price.
Price check = priced move / (20-day daily volatility x sqrt(trading days to expiry)), cut into thirds by each index's
own history since 2019 (data/index_mood_stats.json, built by fo_platform/mood_stats.py from NSE/BSE end of day files).

Describes what the market is doing and what happened in the past. Never what to buy or sell."""
import json, math, os, time, threading, traceback
from datetime import date, datetime
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
STATS = os.path.join(ROOT, "data", "index_mood_stats.json")
VIXF = os.path.join(ROOT, "data", "vix_hist.json")
SEED = r"D:\Scanners\fo_platform\data\vix_daily.json"      # research copy, used once to seed the history if present
NAMES = {"NIFTY": "Nifty 50", "BANKNIFTY": "Bank Nifty", "SENSEX": "Sensex"}
YF = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN"}
MOOD = {"LOW": "Calm", "MID": "Normal", "HIGH": "Nervous"}
MOOD_LINE = {"LOW": "Fear is low. India VIX is in the bottom third of its range over the past year.",
             "MID": "Fear is about normal. India VIX is in the middle third of its range over the past year.",
             "HIGH": "Fear is high. India VIX is in the top third of its range over the past year."}
PRICE = {"cheap": "Cheap", "fair": "Fair", "expensive": "Expensive"}
CACHE = {"t": 0, "v": None}
LOCK = threading.Lock()


def stats():
    try:
        return json.load(open(STATS, encoding="utf8"))
    except Exception:
        return None


def bucket(dte):
    return "1-3 days" if dte <= 3 else "4-7 days" if dte <= 7 else "8-14 days" if dte <= 14 else "15-35 days"


def vix_history(nse):
    """India VIX daily closes {YYYY-MM-DD: close}, kept in data/vix_hist.json and topped up from NSE's VIX history."""
    from datetime import timedelta
    try:
        book = json.load(open(VIXF, encoding="utf8"))
    except Exception:
        book = {}
    if not book and os.path.exists(SEED):
        book = {r[0][:10]: r[4] for r in json.load(open(SEED, encoding="utf8"))}
    last = max(book) if book else (date.today() - timedelta(days=420)).isoformat()
    a = datetime.strptime(last, "%Y-%m-%d").date() - timedelta(days=3)
    changed = False
    while a <= date.today():
        b = min(a + timedelta(days=120), date.today())
        try:
            rows = (nse.get("/api/historicalOR/vixhistory", {"from": a.strftime("%d-%m-%Y"), "to": b.strftime("%d-%m-%Y")}, ttl=3600) or {}).get("data", [])
            for r in rows:
                k = datetime.strptime(r["EOD_TIMESTAMP"], "%d-%b-%Y").date().isoformat()
                if book.get(k) != r["EOD_CLOSE_INDEX_VAL"]:
                    book[k] = r["EOD_CLOSE_INDEX_VAL"]; changed = True
        except Exception:
            traceback.print_exc()
        a = b + timedelta(days=1)
    if changed:
        json.dump(book, open(VIXF + ".tmp", "w", encoding="utf8")); os.replace(VIXF + ".tmp", VIXF)
    return [(k, book[k]) for k in sorted(book)]


def vix_mood(nse, live=None):
    hh = vix_history(nse)
    today = date.today().isoformat()
    if live:
        hh = [x for x in hh if x[0] < today]
    h = [x[1] for x in hh]
    if len(h) < 130:
        return None
    now = float(live) if live else h[-1]
    past = np.array(h[-252:] if live else h[-253:-1])
    lo, hi = np.quantile(past, [1 / 3, 2 / 3])
    lvl = "HIGH" if now > hi else "LOW" if now < lo else "MID"
    pct = round(float((past < now).mean()) * 100)
    return {"vix": round(now, 2), "level": lvl, "label": MOOD[lvl], "line": MOOD_LINE[lvl], "pct": pct,
            "lo": round(float(lo), 2), "hi": round(float(hi), 2), "spark": [round(x, 2) for x in h[-120:]]}


def sensex_chain():
    """Sensex nearest expiry ATM straddle from Upstox (read-only option chain). None if the token is not valid."""
    import upstox_api as U
    key = "BSE_INDEX|SENSEX"
    c = U.get("/v2/option/contract", {"instrument_key": key}).get("data", [])
    exps = sorted({x["expiry"] for x in c if x.get("expiry") and x["expiry"] >= date.today().isoformat()})
    if not exps:
        return None
    rows = U.chain(key, exps[0])
    if not rows:
        return None
    spot = rows[0].get("underlying_spot_price")
    r = min(rows, key=lambda x: abs(x["strike_price"] - spot))
    ce = (r.get("call_options") or {}).get("market_data", {}).get("ltp") or 0
    pe = (r.get("put_options") or {}).get("market_data", {}).get("ltp") or 0
    iv = [(r.get(s) or {}).get("option_greeks", {}).get("iv") for s in ("call_options", "put_options")]
    iv = [x for x in iv if x]
    if ce <= 0 or pe <= 0:
        return None
    e = datetime.strptime(exps[0], "%Y-%m-%d")
    return {"spot": spot, "straddle": ce + pe, "expiry": e.strftime("%d-%b-%Y"), "exp_date": exps[0], "atm_iv": round(sum(iv) / len(iv), 1) if iv else None}


def index_card(sym, chain, yahoo, st, mood):
    c = [x["c"] for x in yahoo.history(YF[sym], period="6mo", interval="1d", ttl=900) if x.get("c")]
    if len(c) < 25:
        return {"sym": sym, "name": NAMES[sym], "error": "Price history is not available right now."}
    spot = chain.get("spot") if chain else None
    spot = spot or c[-1]
    ma20 = sum(c[-20:]) / 20
    out = {"sym": sym, "name": NAMES[sym], "spot": round(spot, 2), "ma20": round(ma20, 2), "vs_ma20": round((spot / ma20 - 1) * 100, 2),
           "spark": [round(x, 2) for x in c[-60:]]}
    hs = (st or {}).get("index", {}).get(sym, {})
    if not chain or not chain.get("straddle"):
        out["priced"] = None
        return out
    S = chain["straddle"]
    exp_d = datetime.strptime(chain.get("exp_date") or chain["expiry"], "%Y-%m-%d" if chain.get("exp_date") else "%d-%b-%Y").date()
    dte = max(0, (exp_d - date.today()).days)
    td = max(1, int(np.busday_count(date.today(), exp_d)))
    r = np.diff(np.log(np.array(c[-21:])))
    rv = float(r.std(ddof=1))
    M = S / spot
    rich = M / (rv * math.sqrt(td)) if rv > 0 else None
    cuts = hs.get("rich_cuts")
    price = None
    if rich is not None and cuts:
        price = "cheap" if rich <= cuts[0] else "expensive" if rich >= cuts[1] else "fair"
    b = bucket(max(dte, 1))
    hist = (hs.get("by_dte") or {}).get(b) or None
    out["priced"] = {"points": round(S, 2), "pct": round(M * 100, 2), "lo": round(spot - S, 2), "hi": round(spot + S, 2),
                     "expiry": exp_d.strftime("%d %b"), "dte": dte, "iv": chain.get("atm_iv"),
                     "actual_pct": round(rv * math.sqrt(td) * 100, 2), "ratio": round(rich, 2) if rich else None,
                     "price": price, "price_label": PRICE.get(price), "bucket": b, "hist": hist,
                     "hist_mood": (hs.get("by_mood") or {}).get(mood) if mood else None,
                     "hist_price": (hs.get("by_rich") or {}).get(price) if price else None, "since": hs.get("from", "")[:4]}
    return out


def build(nse, yahoo, nifty_chain, bank_chain, live_vix=None):
    st = stats()
    m = None
    try:
        m = vix_mood(nse, live_vix)
    except Exception:
        traceback.print_exc()
    lvl = m["level"] if m else None
    if m and st:
        p = st["mood_persistence"]
        m["held"] = p.get(lvl); m["held_all"] = p.get("all"); m["calm_nervous_held"] = p.get("calm_vs_nervous"); m["weeks"] = p.get("n_weeks")
    try:
        sx = sensex_chain()
    except Exception:
        sx = None
    cards = []
    for sym, ch in (("NIFTY", nifty_chain), ("BANKNIFTY", bank_chain), ("SENSEX", sx)):
        try:
            cards.append(index_card(sym, ch, yahoo, st, lvl))
        except Exception:
            traceback.print_exc()
            cards.append({"sym": sym, "name": NAMES[sym], "error": "Not available right now."})
    head = (f"The market is {m['label'].lower()}: India VIX {m['vix']} is higher than {m['pct']}% of the past year."
            if m else "Market mood is loading.")
    return {"mood": m, "cards": cards, "headline": head, "stats_built": (st or {}).get("built"), "ts": time.time()}
