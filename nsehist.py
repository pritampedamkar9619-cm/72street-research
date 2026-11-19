"""Our own daily price history for every NSE stock, from NSE's public end of day file, as a backup for Yahoo.

Yahoo throttles and often blocks cloud servers; if it blocks ours, stock charts would go blank. This keeps about two
years of daily open, high, low, close and volume per stock in data/nsehist/<SYM>.json, filled once (about 500 small
files) and then one day at a time each evening. data_nse.Yahoo.history() falls back to it when Yahoo answers with
nothing and there is no saved copy.

Prices here are as traded (not adjusted for splits or bonuses), like the exchange file. The pages that compute
returns already cut a history at any overnight gap over 30%, which is how splits and demergers show up.

    python nsehist.py            # fill or top up (resumable)
"""
import csv, io, json, os, sys, time, urllib.error, urllib.request, zipfile
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(ROOT, "data", "nsehist")
DONE = os.path.join(DIR, "_days.json")
UA = "Mozilla/5.0 (72street-desk/1.0)"
IST = timezone(timedelta(hours=5, minutes=30))
UDIFF_FROM = date(2024, 7, 8)                       # NSE's current file format starts here
SERIES = {"EQ", "BE", "BZ", "SM", "ST"}


def _get(url):
    for k in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
        except Exception:
            pass
        time.sleep(3 * (k + 1))
    return None


def fetch_day(d):
    """{SYM: [t, o, h, l, c, v]} for one trading day, or None (holiday / not published yet)."""
    b = _get(f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip")
    if not b:
        return None
    z = zipfile.ZipFile(io.BytesIO(b))
    t = int(datetime(d.year, d.month, d.day, tzinfo=IST).timestamp())
    out = {}
    for r in csv.DictReader(io.StringIO(z.read(z.namelist()[0]).decode("utf8", "ignore"))):
        if (r.get("FinInstrmTp") or "").strip() != "STK" or (r.get("SctySrs") or "").strip() not in SERIES:
            continue
        try:
            out[r["TckrSymb"].strip()] = [t, float(r["OpnPric"]), float(r["HghPric"]), float(r["LwPric"]), float(r["ClsPric"]), float(r["TtlTradgVol"] or 0)]
        except (ValueError, KeyError):
            continue
    return out


def update(days_back=730, log=print, max_days=None):
    """Adds every missing trading day from about two years ago (or the last stored day) to today."""
    os.makedirs(DIR, exist_ok=True)
    done = set(json.load(open(DONE, encoding="utf8"))) if os.path.exists(DONE) else set()
    d = max(date.today() - timedelta(days=days_back), UDIFF_FROM)
    batch, fetched = {}, 0
    while d <= date.today():
        k = d.isoformat()
        if d.weekday() < 5 and k not in done:
            if d == date.today() and datetime.now().hour < 19:
                break                                       # today's file comes out in the evening
            rows = fetch_day(d)
            if rows:
                for s, c in rows.items():
                    batch.setdefault(s, []).append(c)
                fetched += 1
            done.add(k)
            time.sleep(0.3)
            if max_days and fetched >= max_days:
                break
        d += timedelta(days=1)
    for s, cs in batch.items():                              # merge into each stock's file
        p = os.path.join(DIR, s.replace("/", "_") + ".json")
        old = json.load(open(p, encoding="utf8")) if os.path.exists(p) else []
        have = {c[0] for c in old}
        merged = sorted(old + [c for c in cs if c[0] not in have])[-520:]
        json.dump(merged, open(p + ".tmp", "w", encoding="utf8")); os.replace(p + ".tmp", p)
    json.dump(sorted(done), open(DONE, "w", encoding="utf8"))
    if fetched:
        log(f"  NSE price history: {fetched} new days, {len(batch)} stocks")
    return fetched


def candles(sym, days=260):
    """Yahoo-shaped daily candles for one NSE symbol, oldest first; [] when we have none."""
    p = os.path.join(DIR, sym.replace("/", "_") + ".json")
    try:
        rows = json.load(open(p, encoding="utf8"))
    except Exception:
        return []
    return [{"t": c[0], "o": c[1], "h": c[2], "l": c[3], "c": c[4], "v": c[5]} for c in rows[-days:]]


if __name__ == "__main__":
    update()
