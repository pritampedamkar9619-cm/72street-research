"""1-minute candle history from Upstox for every F&O stock, the main indices, and the live futures contracts.

Upstox serves 1-minute candles back to January 2022, about a month per request. This walks back month by month
and saves day by day, skipping days already saved, so it can be stopped and rerun at any time.

    python upstox_history.py              # 2 years back (default)
    python upstox_history.py 2022-01-01   # from a given date

data/upstox/1m/SYM.json      cash stock or index: {"YYYY-MM-DD": [[t, o, h, l, c, v, oi], ...]}
data/upstox/1m_fut/SYM.json  near futures contracts now trading (with OI)
data/ is not in git. Kept under Upstox's rate limits, sharing the budget with the tick recorder."""
import json, os, sys, time, traceback
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import upstox_api as U

U.LIMIT = U.Limiter(per_min=45, per_30=1050)      # leaves room for the tick recorder's chain snapshots
if os.environ.get("UPSTOX_FAST") == "1":           # after hours, recorder off: use most of the 2000 / 30 min allowance
    U.LIMIT = U.Limiter(per_min=200, per_30=1850)
OUT = os.path.join(ROOT, "data", "upstox")


def save(folder, sym, bars):
    p = os.path.join(OUT, folder, f"{sym}.json"); os.makedirs(os.path.dirname(p), exist_ok=True)
    book = json.load(open(p)) if os.path.exists(p) else {}
    book = {d: {r[0]: r for r in v} for d, v in book.items()}      # saved days are lists; merge by candle time so a rerun never duplicates
    for b in bars:
        book.setdefault(datetime.fromtimestamp(b[0]).strftime("%Y-%m-%d"), {})[b[0]] = b
    book = {d: (sorted(v.values()) if isinstance(v, dict) else v) for d, v in book.items()}
    json.dump(book, open(p + ".tmp", "w"), separators=(",", ":")); os.replace(p + ".tmp", p)
    return book


def have(folder, sym):
    p = os.path.join(OUT, folder, f"{sym}.json")
    return set(json.load(open(p))) if os.path.exists(p) else set()


def months(start, end):
    """28-day spans, newest first: (from, to)."""
    b = end
    while b >= start:
        a = max(start, b - timedelta(days=27))
        yield a, b
        b = a - timedelta(days=1)


def pull(sym, key, folder, start, end, log):
    got = have(folder, sym)
    n = 0
    pend = []                                       # fetched candles, written once per stock (rewriting a 2-year file per month is slow)
    for a, b in months(start, end):
        span = {(a + timedelta(days=i)).isoformat() for i in range((b - a).days + 1) if (a + timedelta(days=i)).weekday() < 5}
        if span and span <= got:
            continue
        if got and a.isoformat() >= min(got) and b.isoformat() <= max(got):
            continue                                # inside what is already saved: the gaps are market holidays, not missing data
        try:
            bars = U.candles_1m(key, b.isoformat(), a.isoformat())
        except Exception as e:
            log(f"  {sym} {a}..{b}: {e}"); continue
        if not bars and a < date(2022, 1, 1):
            break
        if bars:
            pend += bars; n += len(bars)
            got |= {datetime.fromtimestamp(x[0]).strftime("%Y-%m-%d") for x in bars}
    if pend:
        save(folder, sym, pend)
    return n


def main():
    start = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date.today() - timedelta(days=730)
    end = date.today() - timedelta(days=1)
    log = lambda m: print(m, flush=True)
    uni = U.universe()
    jobs = [(s, k, "1m") for s, k in U.INDICES.items()]
    jobs += [(s, x["eq"], "1m") for s, x in sorted(uni.items()) if x["type"] == "EQUITY" and x["eq"]]
    log(f"{len(jobs)} cash/index symbols, {start} to {end}")
    t0 = time.time()
    for i, (s, k, f) in enumerate(jobs):
        try:
            n = pull(s, k, f, start, end, log)
            log(f"[{i + 1}/{len(jobs)}] {s}: {n} candles ({(time.time() - t0) / 60:.0f} min)")
        except Exception:
            traceback.print_exc()
    # live futures: Upstox keeps their candles since listing (up to 3 months)
    for i, (s, x) in enumerate(sorted(uni.items())):
        for e, k in x["futs"][:1]:
            try:
                n = pull(s, k, "1m_fut", end - timedelta(days=95), end, log)
                log(f"[fut {i + 1}/{len(uni)}] {s}: {n} candles")
            except Exception:
                traceback.print_exc()
    log("history done")


if __name__ == "__main__":
    main()
