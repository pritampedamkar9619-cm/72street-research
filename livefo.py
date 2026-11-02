"""Live F&O: every F&O stock's day so far, refreshed every two minutes in market hours.

Per stock: the path since 9:15, the move against its usual day, whether the move was
one-sided, VWAP, and the futures OI change (all expiries added, from server.futures_buildup).

Clean-move score = (last price - open) / usual daily range, and it counts only when the day
has gone one way: the distance travelled on one side of the open is more than twice the
other side. Choppy days score zero. Usual range = average high-low of the last ~34 sessions.

Describes what happened. No entries, stops, targets or picks."""
import json, os, time, threading
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data", "livefo.json")
STATE = {"ts": 0, "rows": {}, "paths": {}, "c5": {}, "session": None, "last_bar": None, "source": None, "busy": False}
LOCK = threading.Lock()
SLOTS = 75                                   # 5 minute slots from 9:15 to 15:30
BUCKETS = [(-99, -4), (-4, -2), (-2, -1), (-1, 0), (0, 1), (1, 2), (2, 4), (4, 99)]
OI_WORDS = {"long_buildup": "Long buildup", "short_buildup": "Short buildup",
            "short_covering": "Short covering", "long_unwinding": "Long unwinding"}


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


def build(fno_syms, uni, sectors, futrows, log=print):
    """One refresh. fno_syms: F&O stock symbols. uni: universe rows (prev close, usual range).
    sectors: sym -> sector. futrows: sym -> {oi_pchg, oi_chg} live futures OI, all expiries."""
    import pandas as pd
    import yfinance as yf
    if STATE["busy"]:
        return
    STATE["busy"] = True
    try:
        t0 = time.time()
        tick = [s + ".NS" for s in fno_syms]
        df = yf.download(tick, period="2d", interval="1m", group_by="ticker", auto_adjust=False,
                         progress=False, threads=True)
        if df is None or df.empty:
            return
        rows, paths, c5 = {}, {}, {}
        last_bar = None
        for t in tick:
            sym = t[:-3]
            try:
                d = df[t].dropna(subset=["Close"])
            except KeyError:
                continue
            if d.empty:
                continue
            day = d.index[-1].date()
            before = d[[i.date() < day for i in d.index]]
            prev_own = float(before["Close"].iloc[-1]) if len(before) else None     # yesterday's last price, from this same download
            d = d[[i.date() == day for i in d.index]]
            d = d[[(i.hour * 60 + i.minute) >= 555 for i in d.index]]          # 9:15 onward
            if d.empty:
                continue
            u = uni.get(sym) or {}
            prev = prev_own or (u.get("prev") if u.get("asof") == day.isoformat() else u.get("last"))
            usual = u.get("adr")
            if not prev:
                continue
            o, h, l, last = float(d["Open"].iloc[0]), float(d["High"].max()), float(d["Low"].min()), float(d["Close"].iloc[-1])
            v = d["Volume"].fillna(0)
            tp = (d["High"] + d["Low"] + d["Close"]) / 3
            vwap = float((tp * v).sum() / v.sum()) if v.sum() > 0 else None
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
            # path: % from previous close at the end of each 5 minute slot
            p = [None] * SLOTS
            bars = []
            g = d.groupby([_slot(i) for i in d.index])
            cum_pv = cum_v = 0.0
            for sl, b in g:
                if not 0 <= sl < SLOTS:
                    continue
                p[sl] = round((float(b["Close"].iloc[-1]) / prev - 1) * 100, 2)
                bv = b["Volume"].fillna(0)
                cum_pv += float(((b["High"] + b["Low"] + b["Close"]) / 3 * bv).sum()); cum_v += float(bv.sum())
                bars.append([sl, round(float(b["Open"].iloc[0]), 2), round(float(b["High"].max()), 2),
                             round(float(b["Low"].min()), 2), round(float(b["Close"].iloc[-1]), 2),
                             round(cum_pv / cum_v, 2) if cum_v else None])
            paths[sym] = p
            c5[sym] = bars
            lb = d.index[-1]
            if last_bar is None or lb > last_bar:
                last_bar = lb
        if not rows:
            return
        with LOCK:
            STATE.update(ts=time.time(), rows=rows, paths=paths, c5=c5, source="yahoo 1 minute",
                         session=str(last_bar.date()), last_bar=last_bar.strftime("%H:%M"))
        try:
            json.dump({k: STATE[k] for k in ("ts", "rows", "paths", "c5", "session", "last_bar", "source")},
                      open(OUT + ".tmp", "w", encoding="utf8"))
            os.replace(OUT + ".tmp", OUT)
        except Exception:
            pass
        log(f"  live F&O: {len(rows)} stocks, last bar {STATE['last_bar']}, {time.time() - t0:.0f}s")
    finally:
        STATE["busy"] = False


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
            STATE.update({k: d[k] for k in ("ts", "rows", "paths", "c5", "session", "last_bar", "source")})
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
    return {**r, "bars": STATE["c5"].get(sym, []), "session": STATE["session"], "last_bar": STATE["last_bar"]}
