"""One quick daily scan of every stock we know (about 2,400), so the dashboard can find
where something is happening across the whole market without loading every stock page.

Per stock: last price, day change, 52 week range, 1 and 3 month returns, today's volume
against its usual, average daily traded value, and a simple trend. Saved to data/universe.json."""
import json, os, time
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data", "universe.json")
STATE = {"data": None, "ts": 0, "busy": False}


def _row(d, vix=None):
    import pandas as pd
    import chartscore as CS
    d = d.dropna(subset=["Open", "High", "Low", "Close"])
    if len(d) < 30:
        return None
    gap = (d["Open"] / d["Close"].shift(1) - 1).abs()
    if (gap > 0.30).any():                       # unadjusted demerger, split or bonus: keep only after it
        d = d.loc[gap[gap > 0.30].index[-1]:]
        if len(d) < 30:
            return None
    c, v = d["Close"], d["Volume"].fillna(0)
    last, prev = float(c.iloc[-1]), float(c.iloc[-2])
    ret = lambda n: round((last / float(c.iloc[-n - 1]) - 1) * 100, 1) if len(c) > n else None
    usual = float(v.iloc[-21:-1].median()) if len(v) > 21 else 0
    tv20 = float((c.iloc[-20:] * v.iloc[-20:]).mean()) / 1e7          # rupees crore a day
    e50 = float(c.ewm(span=50, adjust=False).mean().iloc[-1])
    e200 = float(c.ewm(span=200, adjust=False).mean().iloc[-1]) if len(c) >= 120 else None
    trend = None
    if e200:
        trend = "up" if last > e50 > e200 else "dn" if last < e50 < e200 else "flat"
    cs = CS.score_df(d, vix) if len(d) >= 210 else None
    return {"v3": cs["score"] if cs else None, "v3b": cs["band"] if cs else None,
            "last": round(last, 2), "chg": round((last / prev - 1) * 100, 2),
            "hi52": round(float(d["High"].iloc[-250:].max()), 2), "lo52": round(float(d["Low"].iloc[-250:].min()), 2),
            "r1m": ret(21), "r3m": ret(63), "vr": round(float(v.iloc[-1]) / usual, 2) if usual else None,
            "tv20": round(tv20, 2), "trend": trend, "asof": d.index[-1].strftime("%Y-%m-%d"),
            "prev": round(prev, 2), "adr": round(float((d["High"] - d["Low"]).iloc[-34:].mean()), 2)}   # usual day: ~50 calendar days


WEEKS = os.path.join(ROOT, "data", "weeks.json")


def weekly(sub_df):
    """Last 14 weeks for one stock: [week ending, % move, traded value in crore]. A week over 40% is a data break."""
    import pandas as pd
    d = sub_df.dropna(subset=["Close"])
    if len(d) < 30:
        return None
    tv = (d["Close"] * d["Volume"].fillna(0)) / 1e7
    wk = pd.DataFrame({"c": d["Close"].resample("W-FRI").last(), "v": tv.resample("W-FRI").sum()}).dropna()
    r = wk["c"].pct_change() * 100
    return [[i.strftime("%Y-%m-%d"), None if x != x or abs(x) > 40 else round(float(x), 2), round(float(v), 1)] for i, x, v in zip(wk.index[-14:], r.iloc[-14:], wk["v"].iloc[-14:])]


def scan(symbols, log=print, record=True):
    import pandas as pd
    import yfinance as yf
    STATE["busy"] = True
    try:
        out, t0 = {}, time.time()
        wk = {}
        vix = None
        try:
            v = yf.download("^INDIAVIX", period="1mo", interval="1d", progress=False)
            vix = float(v["Close"].dropna().iloc[-1].squeeze())
        except Exception:
            pass
        tick = [s + ".NS" for s in symbols]
        for i in range(0, len(tick), 100):
            batch = tick[i:i + 100]
            try:
                df = yf.download(batch, period="2y", interval="1d", auto_adjust=True, group_by="ticker",
                                 progress=False, threads=True)
            except Exception:
                continue
            for t in batch:
                try:
                    sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                    r = _row(sub, vix)
                    if r:
                        out[t[:-3]] = r
                        w = weekly(sub)
                        if w:
                            wk[t[:-3]] = w
                except Exception:
                    pass
            log(f"  universe {min(i + 100, len(tick))}/{len(tick)} ({time.time() - t0:.0f}s)")
        book = {"ts": time.time(), "built": datetime.now().strftime("%Y-%m-%d %H:%M"), "rows": out}
        json.dump(book, open(OUT + ".tmp", "w", encoding="utf8"))
        os.replace(OUT + ".tmp", OUT)
        STATE.update(data=out, ts=book["ts"])
        json.dump(wk, open(WEEKS + ".tmp", "w", encoding="utf8"))
        os.replace(WEEKS + ".tmp", WEEKS)
        if record:                               # a mid-session scan is never written into the track record
            log_v3(out)
        return out
    finally:
        STATE["busy"] = False


def load():
    if STATE["data"] is None and os.path.exists(OUT):
        try:
            book = json.load(open(OUT, encoding="utf8"))
            STATE.update(data=book["rows"], ts=book["ts"])
        except Exception:
            pass
    return STATE["data"] or {}


def get(sym):
    return load().get(sym)


def candidates(reported=(), limit=60, min_tv=1.0):
    """Stocks across the market where something is happening today, liquid enough to matter.
    A quick pre-score; the full reading happens once each stock is loaded."""
    rows = load()
    rep = set(reported)
    scored = []
    for sym, u in rows.items():
        if (u.get("tv20") or 0) < min_tv:
            continue
        s = 0.0
        chg, vr = abs(u.get("chg") or 0), u.get("vr") or 0
        if chg >= 4:
            s += chg / 2
        if vr >= 3 and chg >= 2:
            s += 2 + min(vr, 10) / 3
        if u.get("hi52") and u["last"] >= u["hi52"] * 0.98 and u.get("trend") == "up":
            s += 1.5
        if u.get("lo52") and u["last"] <= u["lo52"] * 1.02 and u.get("trend") == "dn":
            s += 1.5
        if sym in rep:
            s += 3
        if s >= 2:
            scored.append((s, sym))
    scored.sort(reverse=True)
    return [s for _, s in scored[:limit]]


# ---------------- chart strength log: every stock's v3 score and close, once per session
V3LOG = os.path.join(ROOT, "data", "v3_log.json")


def log_v3(rows):
    days = {}
    for sym, r in rows.items():
        if r.get("v3") is not None:
            days.setdefault(r["asof"], {})[sym] = [r["v3"], r["last"]]
    if not days:
        return
    day = max(days, key=lambda k: len(days[k]))             # the session most stocks closed on
    try:
        book = json.load(open(V3LOG, encoding="utf8")) if os.path.exists(V3LOG) else {}
    except Exception:
        book = {}
    if book and max(book) > day:
        return                                             # never write into the past
    book[day] = days[day]
    for k in sorted(book)[:-150]:                          # about seven months is plenty
        book.pop(k)
    json.dump(book, open(V3LOG + ".tmp", "w", encoding="utf8"))
    os.replace(V3LOG + ".tmp", V3LOG)


def band_of(t):
    return ("Strong" if t >= 75 else "Constructive" if t >= 60 else "Neutral" if t >= 45 else "Weak" if t >= 30 else "Broken")


def v3_test(nifty):
    """How each chart-strength band did 5, 20 and 60 sessions later, against Nifty.
    nifty: {date: close}. Uses only scores written down on the day."""
    try:
        book = json.load(open(V3LOG, encoding="utf8")) if os.path.exists(V3LOG) else {}
    except Exception:
        book = {}
    nd = sorted(nifty)
    bands = ["Strong", "Constructive", "Neutral", "Weak", "Broken"]
    out = {"started": min(book) if book else None, "sessions": len(book),
           "stocks": max((len(v) for v in book.values()), default=0), "h": {}}
    for h in (5, 20, 60):
        acc = {b: [] for b in bands}
        for day, rows in book.items():
            if day not in nd:
                continue
            i = nd.index(day)
            if i + h >= len(nd):
                continue
            d2 = nd[i + h]
            later = book.get(d2)
            if not later:
                continue
            nr = nifty[d2] / nifty[day] - 1
            for sym, (sc, px) in rows.items():
                if sym in later and px:
                    acc[band_of(sc)].append((later[sym][1] / px - 1 - nr) * 100)
        res = {}
        for b in bands:
            xs = acc[b]
            if xs:
                res[b] = {"n": len(xs), "avg": round(sum(xs) / len(xs), 2), "beat": round(sum(1 for x in xs if x > 0) / len(xs) * 100)}
        out["h"][h] = res
    return out
