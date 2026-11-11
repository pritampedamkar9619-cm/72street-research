"""Backtest of the price structure events, using the same engine that draws the chart (structure.py).

    python structure_test.py            # 5 years, every stock, if data/structure_bt_prices.pkl exists
    python structure_test.py cache      # the 2 year, 500 stock patterns cache (read only)
    python structure_test.py full 2 0   # other swing size and break buffer, to check the result is not one lucky setting

Each event's return 5, 20 and 60 sessions later is compared with the median stock of the same size
(Large, Mid, Small, Micro) over the same days, so a rising or falling market cancels out.
Events that fall on the same day are averaged first, and the t value is worked out across days:
a hundred stocks sweeping a low on one bad day is one observation, not a hundred.

Writes data/structure_stats.json (default settings only), which the website quotes as "we tested this".
"""
import json, os, pickle, sys
from datetime import datetime
import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import structure as ST

H = (5, 20, 60)
src = sys.argv[1] if len(sys.argv) > 1 else "full"
k = int(sys.argv[2]) if len(sys.argv) > 2 else ST.K
buf = float(sys.argv[3]) if len(sys.argv) > 3 else ST.BUF
default = (k == ST.K and buf == ST.BUF)

full = os.path.join(ROOT, "data", "structure_bt_prices.pkl")
if src == "full" and os.path.exists(full):
    raw = pickle.load(open(full, "rb"))
    prices, caps = raw["prices"], raw["caps"]
else:
    src = "cache"
    prices = pickle.load(open(r"D:/Scanners/patterns logic/ohlcv_cache.pkl", "rb"))
    caps = {}
caps = {s: caps.get(s, "All") for s in prices}

close = pd.DataFrame({s: v["Close"] for s, v in prices.items()}).sort_index()
jump = close.pct_change().abs() > 0.3                     # unadjusted splits or demergers: drop windows that cross them
fwd = {}
for h in H:
    f = close.shift(-h) / close - 1
    f[jump.rolling(h).max().shift(-h).fillna(1).astype(bool)] = np.nan
    ex = f.copy()
    for band in set(caps.values()):                        # against stocks of the same size
        cols = [s for s in f.columns if caps[s] == band]
        ex[cols] = f[cols].sub(f[cols].median(axis=1), axis=0)     # the median stock: a few small-cap rockets drag an average up
    fwd[h] = ex * 100
sma50 = close.rolling(50).mean()
trend_up = (close > sma50) & (sma50 > sma50.shift(10))
trend_dn = (close < sma50) & (sma50 < sma50.shift(10))

rows = []
for s, v in prices.items():
    v = v.dropna()
    cs = [{"t": int(ix.timestamp()), "o": float(r.Open), "h": float(r.High), "l": float(r.Low), "c": float(r.Close), "v": float(r.Volume or 0)}
          for ix, r in v.iterrows()]
    a = ST.analyse(cs, k=k, buf=buf)
    if not a:
        continue
    idx = v.index
    for e in a["events"]:
        day = idx[e["bar"]]
        rows.append({"sym": s, "date": day, "kind": e["kind"], "dir": e["dir"], "cap": caps[s],
                     "strong": e.get("strong"), "heavy": e.get("heavy"), "after_sweep": e.get("after_sweep"),
                     "after": e.get("after"), "chain": e.get("chain"),
                     "aligned": bool(trend_up.at[day, s]) if e["dir"] == "up" else bool(trend_dn.at[day, s])})
ev = pd.DataFrame(rows)
for h in H:
    ev[f"x{h}"] = [fwd[h].at[r.date, r.sym] for r in ev.itertuples()]
ev["sign"] = np.where(ev["dir"] == "up", 1, -1)
mid = close.index[len(close.index) // 2]


def summarise(g):
    out = {"n": int(len(g))}
    for h in H:
        x = g.dropna(subset=[f"x{h}"])
        if len(x) < 30:
            continue
        daily = x.groupby("date")[f"x{h}"].mean()             # one number per day
        m = float(x[f"x{h}"].mean())
        t = float(daily.mean() / (daily.std() / len(daily) ** 0.5)) if len(daily) > 2 and daily.std() > 0 else 0.0
        hit = float(((x[f"x{h}"] * x["sign"]) > 0).mean() * 100)
        out[f"x{h}"], out[f"t{h}"], out[f"hit{h}"], out[f"days{h}"] = round(m, 2), round(t, 1), round(hit), int(len(daily))
    x = g.dropna(subset=["x20"])
    if len(x) >= 60:
        out["x20_first"], out["x20_second"] = round(float(x[x.date < mid]["x20"].mean()), 2), round(float(x[x.date >= mid]["x20"].mean()), 2)
    return out


def line(st, d):
    """The plain sentence the site shows. Neutral words only."""
    if "x20" not in st or st.get("days20", 0) < 60:
        return "Too few cases so far to say what usually followed."
    x, t = st["x20"], st["t20"]
    halves = st.get("x20_first"), st.get("x20_second")
    steady = None not in halves and (halves[0] > 0) == (halves[1] > 0)
    if abs(t) < 2 or abs(x) < 0.3:
        return f"Over the next 20 sessions, stocks did about the same as other stocks their size ({x:+.1f} pts on average)."
    way = "better" if x > 0 else "worse"
    note = "" if steady else " The result was not steady across the period, so treat it as weak."
    return f"Over the next 20 sessions, stocks did on average {abs(x):.1f} pts {way} than other stocks their size.{note}"


tests = {}
for (kind, d), g in ev.groupby(["kind", "dir"]):
    tests[f"{kind}_{d}"] = summarise(g)
variants = {
    "strong move away": lambda e: e.strong == True,
    "heavy volume": lambda e: e.heavy == True,
    "strong and heavy": lambda e: (e.strong == True) & (e.heavy == True),
    "with the 50-day trend": lambda e: e.aligned == True,
    "right after a sweep": lambda e: e.after_sweep == True,
}
filt = {}
for kind in ("BoS", "CHoCH", "Break"):
    for d in ("up", "dn"):
        base = ev[(ev.kind == kind) & (ev.dir == d)]
        for name, fn in variants.items():
            filt[f"{kind}_{d} | {name}"] = summarise(base[fn(base)])
for d in ("up", "dn"):
    ob = ev[(ev.kind == "OB") & (ev.dir == d)]
    for after in ("BoS", "CHoCH", "Break"):
        filt[f"OB_{d} | block from {after}"] = summarise(ob[ob.after == after])
    filt[f"OB_{d} | full chain: sweep, break, retest"] = summarise(ob[ob.chain == True])
    filt[f"OB_{d} | from a strong move"] = summarise(ob[ob.strong == True])
by_cap = {}
for band in sorted(set(caps.values())):
    for (kind, d), g in ev[ev.cap == band].groupby(["kind", "dir"]):
        by_cap[f"{band} | {kind}_{d}"] = summarise(g)

span = f"{close.index[0]:%b %Y} to {close.index[-1]:%b %Y}"
print(f"source={src} stocks={len(prices)} {span} K={k} buffer={buf} events={len(ev)}")
print(f"{'':44}{'n':>7}{'5d':>8}{'20d':>8}{'t20':>6}{'hit20':>7}{'60d':>8}   20d halves")
for title, block in (("BASE", tests), ("FILTERS AND CHAINS", filt), ("BY SIZE", by_cap)):
    print("--", title)
    for key, st in block.items():
        if "x20" not in st:
            print(f"{key:<44}{st['n']:>7}   too few"); continue
        print(f"{key:<44}{st['n']:>7}{st.get('x5', float('nan')):>+8.2f}{st['x20']:>+8.2f}{st['t20']:>6.1f}{st['hit20']:>6}%{st.get('x60', float('nan')):>+8.2f}"
              f"   {st.get('x20_first', float('nan')):+.2f} / {st.get('x20_second', float('nan')):+.2f}")

if default:
    out = {"built": datetime.now().strftime("%d %b %Y"), "source": "every listed stock" if src == "full" else "500 larger stocks",
           "stocks": len(prices), "span": span, "rules": {"k": k, "buf": buf},
           "kinds": {key: {**st, "line": line(st, key.split("_")[1])} for key, st in tests.items()},
           "filters": filt, "by_size": by_cap}
    json.dump(out, open(os.path.join(ROOT, "data", "structure_stats.json"), "w", encoding="utf8"), indent=1)
    print("wrote data/structure_stats.json")
