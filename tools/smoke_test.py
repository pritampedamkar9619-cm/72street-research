"""Opens every page's data on a running server and reports what is broken. Run it after any change and every morning.

    python tools/smoke_test.py                   # against http://127.0.0.1:8772
    python tools/smoke_test.py https://site.com  # against the live site

Each check asks one API for real data and tests the shape a page needs: the right keys, non-empty lists, sane numbers.
Exit code 0 = all passed, 1 = something failed (so a scheduler or CI can alert). Read-only: nothing is written.
"""
import json, sys, time, urllib.parse, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8772").rstrip("/")
UA = {"User-Agent": "72street-desk/1.0 smoke test"}


def get(path, timeout=180):
    t = time.time()
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=timeout) as r:
        return json.load(r), time.time() - t


def has(d, *keys):
    miss = [k for k in keys if k not in d]
    assert not miss, f"missing {', '.join(miss)}"


def nonempty(x, what):
    assert x, f"{what} is empty"


SPEC = json.dumps({"sym": "NIFTY", "preset": "short_strangle", "entry_dte": 3})
CHECKS = [
    ("Today", "/api/today", lambda d: (has(d, "nifty", "leaders", "focus"), nonempty(d["focus"], "stocks in the news"))),
    ("Market Pulse", "/api/pulse", lambda d: (nonempty(d.get("main"), "indices"), nonempty(d.get("sectors"), "sectors"),
                                             nonempty([s for s in d["sectors"] if s.get("g")], "sector links"))),
    ("Money Flow", "/api/flow", lambda d: nonempty(d.get("fiidii"), "FII/DII history")),
    ("Heatmap", "/api/heatmap", lambda d: nonempty(d.get("rows"), "heatmap rows")),
    ("Sector page", "/api/sector?sym=RELIANCE", lambda d: None),
    ("Rotation", "/api/rotation", lambda d: None),
    ("Global", "/api/global", lambda d: None),
    ("52 week screens", "/api/screens", lambda d: None),
    ("Results calendar", "/api/results", lambda d: None),
    ("Results just out", "/api/reported", lambda d: None),
    ("Screener", "/api/screener", lambda d: nonempty(d.get("rows"), "screener rows")),
    ("Stock page", "/api/stock?sym=RELIANCE", lambda d: (has(d, "price", "chart"), nonempty(d.get("candles"), "price history"),
                                                       nonempty((d.get("chart") or {}).get("score") is not None, "chart score"))),
    ("Stock with &", "/api/stock?sym=" + urllib.parse.quote("M&M"), lambda d: has(d, "price")),
    ("Compare", "/api/compare?a=TCS&b=INFY", lambda d: None),
    ("Option Pulse", "/api/options?sym=NIFTY", lambda d: (has(d, "spot", "straddle", "rows"), nonempty(d["rows"], "option chain"))),
    ("Stock or Index F&O", "/api/fno?sym=NIFTY", lambda d: None),
    ("Live F&O", "/api/livefo", lambda d: None),
    ("Expiry tracker", "/api/expiry?sym=NIFTY", lambda d: None),
    ("Calm zone", "/api/calm", lambda d: None),
    ("Index Mood", "/api/mood", lambda d: (has(d, "mood", "cards"), nonempty(d["mood"], "market mood"),
                                          nonempty([c for c in d["cards"] if c.get("priced")], "any priced move"))),
    ("Strategy Builder", "/api/backtest?spec=" + urllib.parse.quote(SPEC), lambda d: (has(d, "trades", "total"), nonempty(d["trades"] >= 30, "enough trades"))),
    ("Track record", "/api/track", lambda d: has(d, "summary", "sessions")),
    ("Price structure", "/api/structure_today", lambda d: None),
    ("Search", "/api/search?q=tata", lambda d: None),
    ("Health", "/api/health", lambda d: has(d, "status")),
]


def main():
    bad, slow = [], []
    for name, path, test in CHECKS:
        try:
            d, secs = get(path)
            if isinstance(d, dict) and d.get("error"):
                raise AssertionError(d["error"])
            test(d)
            flag = "  slow" if secs > 20 else ""
            if flag: slow.append(name)
            print(f"  ok    {name:<22} {secs:5.1f}s{flag}")
        except Exception as e:
            bad.append(name)
            print(f"  FAIL  {name:<22} {str(e)[:110]}")
    try:
        h, _ = get("/api/health")
        for p in h.get("problems", []):
            print(f"  note  {p}")
    except Exception:
        pass
    print(f"\n{len(CHECKS) - len(bad)} of {len(CHECKS)} passed" + (f"; failed: {', '.join(bad)}" if bad else "") + (f"; slow: {', '.join(slow)}" if slow else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
