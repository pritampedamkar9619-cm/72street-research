"""Fresh chart-pattern scan for the dashboard.

Uses the pattern engine in ../patterns logic unchanged, but feeds it today's
prices instead of its July cache, and writes to data/patterns_today.csv here.
Nothing in the patterns project is modified."""
import os, sys, time
import pandas as pd
import yfinance as yf

ROOT = os.path.dirname(os.path.abspath(__file__))
PAT = os.path.join(os.path.dirname(ROOT), "patterns logic")
UNIVERSE = next((p for p in (os.path.join(ROOT, "vendor", "ind_nifty500list.csv"), os.path.join(os.path.dirname(ROOT), "fundamental sectors", "ind_nifty500list.csv")) if os.path.exists(p)), "")
OUT = os.path.join(ROOT, "data", "patterns_today.csv")


def fresh_prices(syms):
    cache, t0 = {}, time.time()
    tickers = [s + ".NS" for s in syms]
    for i in range(0, len(tickers), 60):
        batch = tickers[i:i + 60]
        data = yf.download(batch, period="2y", interval="1d", auto_adjust=True, group_by="ticker", progress=False, threads=True)
        for tk in batch:
            try:
                d = data[tk] if isinstance(data.columns, pd.MultiIndex) else data
                d = d.dropna(subset=["Open", "High", "Low", "Close"])
                d.columns = [c.strip().title() for c in d.columns]
                gap = (d["Open"] / d["Close"].shift(1) - 1).abs()
                if (gap > 0.30).any():                 # unadjusted demerger, split or bonus: keep only after it
                    d = d.loc[gap[gap > 0.30].index[-1]:]
                    cache[tk[:-3]] = d                  # even if short: the engine then skips it instead of refetching raw prices
                    continue
                if len(d) >= 40:
                    cache[tk[:-3]] = d
            except Exception:
                pass
        print(f"  prices {min(i + 60, len(tickers))}/{len(tickers)} ({time.time() - t0:.0f}s)", flush=True)
    return cache


def run():
    sys.path.insert(0, PAT)
    import engine as E
    from scan_perstock import best_for
    syms = pd.read_csv(UNIVERSE)["Symbol"].dropna().astype(str).str.strip().tolist()
    E._OHLCV_CACHE = fresh_prices(syms)
    rows = []
    for sym in syms:
        df = E.load(sym)
        if df is None:
            continue
        try:
            r = best_for(df)
        except Exception:
            r = None
        if r:
            r["symbol"] = sym
            rows.append(r)
    rows.sort(key=lambda r: -r.get("score", 0))
    pd.DataFrame([{
        "symbol": r["symbol"], "pattern": r["pattern"], "direction": r["direction"], "tier": r.get("tier"),
        "reliability": r.get("reliability"), "strength": r["strength"], "score": r.get("score"),
        "entry": r["entry"], "target": r["target"], "stop": r["stop"], "rr": r["rr"], "bars_ago": r.get("bars_ago"),
        "trigger": r.get("trigger", ""), "volume": r.get("volume", ""), "stop_note": r.get("stop_note", ""),
        "reliability_note": r.get("reliability_note", "")} for r in rows]).to_csv(OUT, index=False, encoding="utf-8")
    print(f"saved {len(rows)} patterns to {OUT}")
    return len(rows)


if __name__ == "__main__":
    run()
