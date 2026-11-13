"""Intraday price store for the F&O stocks and the two main indices.

Yahoo keeps 1-minute candles for about 7 days and 5-minute candles for about 60. This saves both to disk
so the history keeps growing instead of rolling off, for the replay feed and for intraday backtests.

    python intraday_store.py          # fetch now (also run each evening by the server)

data/intraday/1m/SYM.json and data/intraday/5m/SYM.json: {"YYYY-MM-DD": [[t, o, h, l, c, v], ...]}, merged day by day.
data/ is not in git."""
import json, os, sys, time
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(ROOT, "data", "intraday")
INDEX = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK"}


def symbols():
    sys.path.insert(0, ROOT)
    from data_nse import nse
    try:
        return sorted(set(nse.fno_list())) + list(INDEX)
    except Exception:
        return list(INDEX)


def fetch(interval, period, syms, log=print):
    import yfinance as yf
    out_dir = os.path.join(BASE, interval); os.makedirs(out_dir, exist_ok=True)
    tick = {s: INDEX.get(s, s + ".NS") for s in syms}
    names = list(tick)
    added = 0
    for i in range(0, len(names), 60):
        chunk = names[i:i + 60]
        try:
            df = yf.download([tick[s] for s in chunk], period=period, interval=interval, group_by="ticker", auto_adjust=False, progress=False, threads=True)
        except Exception as e:
            log(f"  batch {i} failed: {e}"); time.sleep(10); continue
        for s in chunk:
            try:
                d = df[tick[s]].dropna(subset=["Close"])
            except KeyError:
                continue
            if d.empty:
                continue
            if getattr(d.index, "tz", None) is not None:
                d = d.tz_convert("Asia/Kolkata")
            path = os.path.join(out_dir, f"{s}.json")
            book = json.load(open(path, encoding="utf8")) if os.path.exists(path) else {}
            for day, g in d.groupby(d.index.date):
                key = day.isoformat()
                if key in book and len(book[key]) >= len(g):
                    continue                                     # already have this day in full
                book[key] = [[int(ix.timestamp()), round(float(r.Open), 2), round(float(r.High), 2), round(float(r.Low), 2), round(float(r.Close), 2), float(r.Volume or 0)]
                             for ix, r in g.iterrows()]
                added += 1
            json.dump(book, open(path + ".tmp", "w", encoding="utf8"), separators=(",", ":"))
            os.replace(path + ".tmp", path)
        log(f"  {interval}: {min(i + 60, len(names))}/{len(names)} symbols")
        time.sleep(1)
    return added


def update(log=print):
    syms = symbols()
    a = fetch("1m", "7d", syms, log)
    b = fetch("5m", "60d", syms, log)
    log(f"intraday store: {len(syms)} symbols, {a} new 1-minute days, {b} new 5-minute days")


if __name__ == "__main__":
    update()
