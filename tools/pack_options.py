"""Packs daily index option prices into one compact file per index for the strategy builder's backtests.

Source: NSE/BSE end of day F&O files (one CSV per day, as downloaded by fo_platform/fetch_bhav.py).
Output: data/optpack_<SYM>.npz (not in the repo; data/ is ignored). Kept per index:
  days        trading days (YYYY-MM-DD)
  fut         near month futures price each day (the contract that has not expired yet)
  exps        every option expiry, with: final (index settlement price), lot (per contract), monthly flag
  rows        one row per option per day: day index, expiry index, strike, CE/PE, price, contracts traded
              price = close when the contract traded that day, else the exchange's settle price
Strikes kept: within 20% of the futures price; expiries kept: up to 50 days ahead.

Run:  python tools/pack_options.py [path to the folder of daily CSVs]
"""
import glob, os, sys
import numpy as np, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:\Scanners\fo_platform\data\bhav"
SYMS = ("NIFTY", "BANKNIFTY", "SENSEX")


def lot_rule(sym, e):
    """Lot size by expiry where the files carry none (before Jul 2024). From CONTRACT_RULES.md, verified on the data."""
    if sym == "NIFTY":
        return 75 if e < pd.Timestamp("2021-07-01") else 50 if e < pd.Timestamp("2024-07-01") else 25
    if sym == "BANKNIFTY":
        return 20 if e < pd.Timestamp("2020-07-01") else 25 if e < pd.Timestamp("2023-07-01") else 15
    return 10


def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.csv")))
    parts = {s: [] for s in SYMS}
    for i, f in enumerate(files):
        d = pd.read_csv(f)
        d = d[d.sym.isin(SYMS)]
        if "lot" not in d: d["lot"] = np.nan
        parts_cols = ["date", "sym", "kind", "expiry", "strike", "close", "settle", "contracts", "lot"]
        for s, g in d.groupby("sym"):
            parts[s].append(g[parts_cols])
        if i % 250 == 0: print(f"  read {i}/{len(files)}", flush=True)
    for s in SYMS:
        if not parts[s]: continue
        d = pd.concat(parts[s], ignore_index=True)
        d["date"] = pd.to_datetime(d.date); d["expiry"] = pd.to_datetime(d.expiry)
        days = np.array(sorted(d.date.unique()))
        fut_rows = d[d.kind == "FUT"]
        near = fut_rows[fut_rows.expiry > fut_rows.date].sort_values(["date", "expiry"]).groupby("date").first()
        fut = pd.Series(np.where(near.close > 0, near.close, near.settle), index=near.index).reindex(days).ffill()
        o = d[d.kind.isin(["CE", "PE"])].copy()
        o["px"] = np.where((o.contracts > 0) & (o.close > 0), o.close, o.settle)
        exps = np.array(sorted(o.expiry.unique()))
        final, lots = {}, {}
        for e in exps:
            x = o[(o.date == e) & (o.expiry == e)].settle
            F = fut.get(e, np.nan)
            ok = x[(x > 0.5 * F) & (x < 1.5 * F)] if np.isfinite(F) else x[x > 0]
            if len(ok):
                final[e] = float(ok.median())
            else:                                            # 2019 files carry 0: use the expiring future's settle
                ef = fut_rows[(fut_rows.date == e) & (fut_rows.expiry == e)].settle
                if len(ef) and ef.iloc[0] > 0: final[e] = float(ef.iloc[0])
                elif np.isfinite(F): final[e] = float(F)     # weekly expiry with no future of its own: near future close
            l = o[o.expiry == e].lot.dropna()
            lots[e] = int(l.mode().iloc[0]) if len(l) else lot_rule(s, pd.Timestamp(e))
        o = o.merge(pd.DataFrame({"date": fut.index, "F": fut.values}), on="date")
        o = o[(o.expiry > o.date) | (o.expiry == o.date)]
        o = o[((o.expiry - o.date).dt.days <= 50) & ((o.strike / o.F - 1).abs() <= 0.20) & (o.px > 0)]
        di = {t: i for i, t in enumerate(days)}; ei = {e: i for i, e in enumerate(exps)}
        ex = pd.Series(exps)
        monthly = (ex.groupby(ex.dt.to_period("M")).transform("max") == ex).values
        np.savez_compressed(os.path.join(ROOT, "data", f"optpack_{s}.npz"),
                            days=np.array([str(t)[:10] for t in days]), fut=fut.values.astype("float64"),
                            exps=np.array([str(e)[:10] for e in exps]), final=np.array([final.get(e, np.nan) for e in exps]),
                            lot=np.array([lots[e] for e in exps], dtype="int32"), monthly=monthly,
                            r_day=o.date.map(di).values.astype("int32"), r_exp=o.expiry.map(ei).values.astype("int32"),
                            r_k=o.strike.values.astype("float64"), r_ce=(o.kind == "CE").values,
                            r_px=o.px.values.astype("float32"), r_n=o.contracts.fillna(0).values.astype("int32"))
        print(s, len(days), "days", len(exps), "expiries", len(o), "option rows", f"{np.isfinite(list(final.values())).sum()} finals", flush=True)


if __name__ == "__main__":
    main()
