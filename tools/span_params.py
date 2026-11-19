"""NSE's margin settings for index options, one sample a month since 2019, from the exchange's own SPAN files.

SPAN (the method the clearing house uses to block margin) re-prices a position under 16 scenarios: the index up and
down by 1/3, 2/3 and all of its 'price scan range', volatility up and down by its 'volatility scan', plus two extreme
moves (twice the scan range, a third of the loss counted). The scan range is the number that matters; it changes
with market volatility. This script stores it (as a share of the futures price) for Nifty and Bank Nifty on the first
trading day of every month, so the Strategy Builder can work out the margin a broker would actually block.

Source: https://nsearchives.nseindia.com/archives/nsccl/span/nsccl.YYYYMMDD.s.zip (public). Output: data/span_params.json
    python tools/span_params.py            # fills in missing months; the server adds new months itself
"""
import io, json, os, re, sys, time, urllib.error, urllib.request, zipfile
import socket
socket.setdefaulttimeout(90)          # a stalled download must not hang the run
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "span_params.json")
UA = "Mozilla/5.0 (72street-desk/1.0)"
SYMS = ("NIFTY", "BANKNIFTY")


def fetch(d):
    url = f"https://nsearchives.nseindia.com/archives/nsccl/span/nsccl.{d:%Y%m%d}.s.zip"
    for k in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}), timeout=90)
            return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
        except Exception:
            pass
        time.sleep(3 * (k + 1))
    return None


def parse(blob):
    """-> {SYM: {"scan": price scan range in points, "vscan": volatility scan, "fut": near futures price}} from the futures portfolios."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    out, cur, in_fut = {}, None, False
    with z.open(z.namelist()[0]) as f:
        for raw in io.TextIOWrapper(f, encoding="utf8", errors="ignore"):
            line = raw.strip()
            if line == "<futPf>":
                in_fut, cur = True, None
            elif line == "</futPf>":
                in_fut, cur = False, None
            elif in_fut and cur is None:
                m = re.match(r"<pfCode>([^<]+)</pfCode>", line)
                if m and m.group(1) in SYMS and m.group(1) not in out:
                    cur = m.group(1); out[cur] = {}
            elif in_fut and cur:
                x = out[cur]
                for tag, key in (("p", "fut"), ("priceScan", "scan"), ("volScan", "vscan")):
                    m = re.match(rf"<{tag}>([0-9.]+)</{tag}>", line)
                    if m and key not in x:
                        x[key] = float(m.group(1))
                if all(k in x for k in ("fut", "scan", "vscan")):
                    cur = None
            if len(out) == len(SYMS) and all(len(v) == 3 for v in out.values()):
                break
    return out


def update(months=None, log=print):
    book = json.load(open(OUT, encoding="utf8")) if os.path.exists(OUT) else {}
    m = date(2019, 1, 1)
    want = []
    while m <= date.today():
        if f"{m:%Y-%m}" not in {k[:7] for k in book}:
            want.append(m)
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    for m in want[:months] if months else want:
        for k in range(7):                                   # first trading day of the month
            d = m + timedelta(days=k)
            if d > date.today() or d.weekday() >= 5:
                continue
            blob = fetch(d)
            if blob:
                p = parse(blob)
                if p:
                    book[d.isoformat()] = {s: {"scan_pct": round(v["scan"] / v["fut"] * 100, 3), "vscan": v["vscan"], "fut": v["fut"]}
                                           for s, v in p.items() if v.get("fut")}
                    log(f"  {d} {book[d.isoformat()]}")
                break
            time.sleep(0.5)
        json.dump(dict(sorted(book.items())), open(OUT + ".tmp", "w", encoding="utf8"), indent=0)
        os.replace(OUT + ".tmp", OUT)
    return book


if __name__ == "__main__":
    update()
