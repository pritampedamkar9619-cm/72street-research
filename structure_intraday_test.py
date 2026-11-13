"""Intraday backtest of the 5-minute structure events (the same structure.py the site draws with),
on the 5-minute candles saved by intraday_store.py (about 60 sessions of every F&O stock).

Each event's move 30 minutes, 60 minutes and to the day's close is compared with the median F&O stock over
the same minutes, so a market-wide swing cancels out. A horizon that would run past the close is not counted.
Up and down events are also compared with each other (the spread), which is the fair test; averages and hit
rates alone are skewed by a few big movers.

    python structure_intraday_test.py
"""
import json, os, sys, glob
from datetime import datetime
import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import structure as ST

files = [f for f in glob.glob(os.path.join(ROOT, "data", "intraday", "5m", "*.json")) if not os.path.basename(f).startswith(("NIFTY", "BANKNIFTY"))]
closes, events = {}, []
for f in files:
    sym = os.path.basename(f)[:-5]
    book = json.load(open(f, encoding="utf8"))
    cs = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for day in sorted(book) for r in book[day]]
    if len(cs) < 200:
        continue
    closes[sym] = pd.Series([c["c"] for c in cs], index=pd.to_datetime([c["t"] for c in cs], unit="s"))
    a = ST.analyse(cs)
    if not a:
        continue
    for e in a["events"]:
        if e["kind"] in ("BoS", "CHoCH", "Break", "OB"):
            events.append({"sym": sym, "t": pd.to_datetime(e["t"], unit="s"), "kind": e["kind"], "dir": e["dir"], "bar": e["bar"]})

px = pd.DataFrame(closes).sort_index()
day = px.index.normalize()
ret = {}
for name, k in (("30m", 6), ("60m", 12)):
    f = px.shift(-k) / px - 1
    f[(pd.Series(day, index=px.index).shift(-k) != pd.Series(day, index=px.index)).values] = np.nan     # no carrying over the close
    ret[name] = f
last_of_day = px.groupby(day).transform("last")
ret["close"] = last_of_day / px - 1
ex = {h: (r.sub(r.median(axis=1), axis=0) * 100) for h, r in ret.items()}

ev = pd.DataFrame(events)
for h in ex:
    ev[h] = [ex[h].at[r.t, r.sym] if r.t in ex[h].index else np.nan for r in ev.itertuples()]
ev["sign"] = np.where(ev["dir"] == "up", 1, -1)
ev["hour"] = ev["t"].dt.tz_localize("UTC").dt.tz_convert("Asia/Kolkata").dt.hour
mid = px.index[len(px.index) // 2]

print(f"5-minute candles: {len(closes)} F&O stocks, {px.index[0]:%d %b} to {px.index[-1]:%d %b} ({day.nunique()} sessions), {len(ev)} events")
print(f"{'event':<12}{'n':>7}{'30m':>8}{'hit':>6}{'60m':>8}{'hit':>6}{'close':>8}{'hit':>6}   60m halves")
for (k, d), g in ev.groupby(["kind", "dir"]):
    line = f"{k + ' ' + d:<12}{len(g):>7}"
    for h in ("30m", "60m", "close"):
        x = g.dropna(subset=[h])
        line += f"{x[h].mean():>+8.3f}{((x[h] * x['sign']) > 0).mean() * 100:>5.0f}%" if len(x) > 30 else f"{'-':>8}{'':>6}"
    x = g.dropna(subset=["60m"])
    line += f"   {x[x.t < mid]['60m'].mean():+.3f} / {x[x.t >= mid]['60m'].mean():+.3f}"
    print(line)
print("\nspread, up events minus down events (the fair test), percentage points:")
for k in ("BoS", "CHoCH", "Break", "OB"):
    g = ev[ev.kind == k]
    s = "  ".join(f"{h} {g[g.dir == 'up'][h].mean() - g[g.dir == 'dn'][h].mean():+.3f}" for h in ("30m", "60m", "close"))
    print(f"  {k:<6} {s}")
print("\n60m spread by hour of the event (India time):")
for hr, g in ev[ev.kind.isin(["BoS", "CHoCH", "Break"])].groupby("hour"):
    print(f"  {hr:02d}:00  n={len(g):>5}  spread {g[g.dir == 'up']['60m'].mean() - g[g.dir == 'dn']['60m'].mean():+.3f}")
