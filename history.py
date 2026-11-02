"""PCR and max pain history, rebuilt from NSE's daily F&O bhavcopy.

Each daily file holds closing open interest for every strike of every expiry,
so for any symbol and expiry we can replay how PCR and max pain moved through
the cycle, and check where price actually settled against max pain."""
import csv, io, json, os, threading, time, zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta

from data_nse import nse

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "fo")
OUT = os.path.join(ROOT, "data", "oi_history.json")
os.makedirs(CACHE, exist_ok=True)
URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d}_F_0000.csv.zip"
LOCK = threading.Lock()


def fetch_day(d):
    """Return the day's CSV text, from cache if we have it. None on holidays."""
    path = os.path.join(CACHE, d.strftime("%Y%m%d") + ".csv")
    if os.path.exists(path):
        return open(path, encoding="utf8").read() or None
    if d.weekday() >= 5:
        return None
    s = nse._session()
    try:
        r = s.get(URL.format(d=d.strftime("%Y%m%d")), timeout=30)
    except Exception:
        return None
    time.sleep(0.5)
    if r.status_code != 200 or r.content[:2] != b"PK":
        if r.status_code == 404 and d < date.today():
            open(path, "w").close()          # remember holidays, don't refetch
        return None
    z = zipfile.ZipFile(io.BytesIO(r.content))
    txt = z.read(z.namelist()[0]).decode("utf8", "replace")
    open(path, "w", encoding="utf8").write(txt)
    return txt


def max_pain(strikes):
    best = None
    for p in strikes:
        loss = sum(v["CE"] * max(0, p - k) + v["PE"] * max(0, k - p) for k, v in strikes.items())
        if best is None or loss < best[0]:
            best = (loss, p)
    return best[1] if best else None


def summarise(txt):
    """-> {symbol: {expiry: {pcr, mp, ce, pe, spot, straddle}}}"""
    chains = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: {"CE": 0, "PE": 0, "cp": 0.0, "pp": 0.0})))
    spot = {}
    for r in csv.DictReader(io.StringIO(txt)):
        if r["FinInstrmTp"] not in ("IDO", "STO"):
            continue
        sym, exp, k, side = r["TckrSymb"], r["XpryDt"], float(r["StrkPric"]), r["OptnTp"]
        cell = chains[sym][exp][k]
        cell[side] += int(float(r["OpnIntrst"] or 0))
        cell["cp" if side == "CE" else "pp"] = float(r["ClsPric"] or 0)
        spot[sym] = float(r["UndrlygPric"] or 0)
    out = {}
    for sym, exps in chains.items():
        s = spot.get(sym, 0)
        for exp, strikes in exps.items():
            ce = sum(v["CE"] for v in strikes.values()); pe = sum(v["PE"] for v in strikes.values())
            if ce + pe < 1:
                continue
            live = {k: v for k, v in strikes.items() if v["CE"] or v["PE"]}
            atm = min(live, key=lambda k: abs(k - s)) if live else None
            out.setdefault(sym, {})[exp] = {"pcr": round(pe / ce, 3) if ce else None, "mp": max_pain(live), "ce": ce, "pe": pe,
                                            "spot": s, "straddle": round(live[atm]["cp"] + live[atm]["pp"], 2) if atm else None}
    return out


def load():
    if os.path.exists(OUT):
        return json.load(open(OUT, encoding="utf8"))
    return {"days": {}}


def build(days_back=120):
    """Fill in any missing days. Daily summaries are stored per date."""
    with LOCK:
        h = load()
        d = date.today()
        for i in range(days_back):
            day = d - timedelta(days=i)
            key = day.isoformat()
            if key in h["days"] or day.weekday() >= 5:
                continue
            txt = fetch_day(day)
            if txt:
                h["days"][key] = summarise(txt)
        json.dump(h, open(OUT, "w", encoding="utf8"))
        return h


def series(sym, h=None):
    """Everything the Expiry Tracker needs for one symbol."""
    h = h or load()
    days = sorted(h["days"])
    by_exp = defaultdict(list)
    for d in days:
        for exp, v in h["days"][d].get(sym, {}).items():
            by_exp[exp].append({"date": d, **v})
    today = date.today().isoformat()
    upcoming = sorted(e for e in by_exp if e >= today)
    current = upcoming[0] if upcoming else (sorted(by_exp)[-1] if by_exp else None)
    # how did past expiries settle against max pain a few sessions before?
    record = []
    for exp in sorted(by_exp):
        if exp >= today:
            continue
        pts = by_exp[exp]
        settle_day = next((p for p in pts if p["date"] == exp), None)
        if not settle_day or len(pts) < 4:
            continue
        before = pts[-4] if pts[-1]["date"] == exp else pts[-3]
        record.append({"expiry": exp, "mp_before": before["mp"], "spot_before": before["spot"], "before_date": before["date"],
                       "settle": settle_day["spot"], "gap_pct": round((settle_day["spot"] / before["mp"] - 1) * 100, 2) if before["mp"] else None})
    # monthly-style expiries only for stocks; indices have weeklies, keep the last 12
    record = record[-12:]
    return {"sym": sym, "current": current, "cycle": by_exp.get(current, []),
            "expiries": upcoming[:4], "record": record, "days": len(days),
            "pcr_daily": nearest_pcr(sym, h, days[-60:])}


def nearest_pcr(sym, h, days):
    """PCR of whichever expiry was nearest on each day, the series traders quote."""
    out = []
    for d in days:
        exps = sorted(e for e in h["days"][d].get(sym, {}) if e >= d)
        if exps:
            v = h["days"][d][sym][exps[0]]
            out.append({"date": d, "pcr": v["pcr"], "spot": v["spot"], "exp": exps[0]})
    return out


if __name__ == "__main__":
    t = time.time()
    hh = build()
    print("days:", len(hh["days"]), f"{time.time() - t:.0f}s")
    s = series("NIFTY", hh)
    print(s["current"], len(s["cycle"]), s["record"][-3:])


# ---------------------------------------------------------------- futures OI, all expiries added up
# In expiry week positions roll from one month to the next, so a single contract's OI
# can jump 100% while the total barely moves. Adding every expiry removes the roll.
FUT_OUT = os.path.join(ROOT, "data", "fut_oi.json")
FUT = {"days": None, "mtime": 0}


def fut_day(txt):
    """-> {symbol: [total futures OI, underlying close, {expiry: OI}]}"""
    out = {}
    for r in csv.DictReader(io.StringIO(txt)):
        if r["FinInstrmTp"] not in ("STF", "IDF"):
            continue
        cell = out.setdefault(r["TckrSymb"], [0, 0.0, {}])
        oi = int(float(r["OpnIntrst"] or 0))
        cell[0] += oi
        cell[1] = float(r["UndrlygPric"] or 0)
        cell[2][r["XpryDt"]] = cell[2].get(r["XpryDt"], 0) + oi
    return out


def build_fut(days=8):
    book = {}
    if os.path.exists(FUT_OUT):
        try:
            book = json.load(open(FUT_OUT, encoding="utf8"))
        except Exception:
            book = {}
    d, got, tries = date.today(), 0, 0
    while got < days and tries < 20:
        key = d.strftime("%Y-%m-%d")
        if key not in book or len(next(iter(book[key].values()), [])) < 3:     # older entries lack per-contract OI
            txt = fetch_day(d)
            if txt:
                book[key] = fut_day(txt)
        if key in book:
            got += 1
        d -= timedelta(days=1); tries += 1
    keep = sorted(book)[-days:]
    book = {k: book[k] for k in keep}
    json.dump(book, open(FUT_OUT, "w", encoding="utf8"))
    FUT["days"] = book
    return book


def fut_net(sym):
    """Total futures OI change over 1 and 5 sessions with price change, or None."""
    book = FUT["days"]
    if book is None:
        if not os.path.exists(FUT_OUT):
            return None
        book = FUT["days"] = json.load(open(FUT_OUT, encoding="utf8"))
    ks = [k for k in sorted(book) if sym in book[k]]
    if len(ks) < 2:
        return None
    def chg(n):
        if len(ks) <= n:
            return None, None
        a, b = book[ks[-1 - n]][sym], book[ks[-1]][sym]
        if not a[0] or not a[1]:
            return None, None
        oa, ob = a[0], b[0]
        if len(a) > 2 and len(b) > 2:
            # only contracts alive on both days: an expired series vanishing is settlement, not unwinding,
            # and a newly listed one appearing is not fresh buildup
            common = [e for e in a[2] if e in b[2]]
            if n > 1 and len(common) < len(a[2]):
                return None, None        # a span across expiry: rollover into the next month would read as new positions
            oa, ob = sum(a[2][e] for e in common), sum(b[2][e] for e in common)
            if not oa:
                return None, None
        return round((ob / oa - 1) * 100, 1), round((b[1] / a[1] - 1) * 100, 2)
    oi1, p1 = chg(1); oi5, p5 = chg(5)
    def kind(oi, p):
        if oi is None or p is None:
            return None
        if oi >= 0:
            return "long_buildup" if p >= 0 else "short_buildup"
        return "short_covering" if p >= 0 else "long_unwinding"
    return {"date": ks[-1], "oi1": oi1, "p1": p1, "kind1": kind(oi1, p1), "oi5": oi5, "p5": p5, "kind5": kind(oi5, p5)}
