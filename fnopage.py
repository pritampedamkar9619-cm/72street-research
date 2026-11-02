"""One stock's full F&O page: what the options market is saying, then the detail behind it.

IV and Greeks are worked out here from option prices and the futures price of the same expiry,
because NSE's own IV is measured against spot and so reads high on calls and low on puts.
The verdict describes prices and positions. It never says what to do."""
import csv, glob, json, math, os, threading, time
from datetime import date, datetime
from data_nse import yf_symbol

ROOT = os.path.dirname(os.path.abspath(__file__))
FO = os.path.join(ROOT, "data", "fo")
HIST = os.path.join(ROOT, "data", "iv_hist.json")
LOG = os.path.join(ROOT, "data", "fno_verdicts.json")
RATE = 0.065                                # assumed rate; no dividends
CACHE = {}
LOCK = threading.Lock()
BOOK = {"days": None}                       # {date: {sym: atm iv}}
N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
pdf = lambda x: math.exp(-x * x / 2) / math.sqrt(2 * math.pi)

# Named for what happened, not what it may lead to. "Stands out" means against the other F&O stocks that day.
POS_HEAD = {"up": "put writing stands out", "dn": "call writing stands out", "flat": "positions are balanced"}
POS_CHIP = {"up": "Put heavy", "dn": "Call heavy", "flat": "Balanced"}
CUTS = os.path.join(ROOT, "data", "fno_cuts.json")
INDICES = ("NIFTY", "BANKNIFTY")
PRICE_HEAD = {"rich": "Options are expensive", "high": "Option prices are high, matching the moves",
              "fair": "Options are fairly priced", "low": "Option prices are low, matching the moves", "cheap": "Options are cheap"}
PRICE_CHIP = {"rich": "Expensive", "high": "High, matches moves", "fair": "Fair", "low": "Low, matches moves", "cheap": "Cheap"}
FUT_WORD = {"long_buildup": "Long buildup", "short_buildup": "Short buildup", "short_covering": "Short covering", "long_unwinding": "Long unwinding"}


def b76(F, K, T, iv, cp):
    """Option on the futures price -> price, delta, gamma, theta a day, vega an IV point."""
    s = iv * math.sqrt(T)
    d1 = (math.log(F / K) + iv * iv * T / 2) / s
    d2 = d1 - s
    disc = math.exp(-RATE * T)
    if cp == "CE":
        p, dl = disc * (F * N(d1) - K * N(d2)), disc * N(d1)
    else:
        p, dl = disc * (K * N(-d2) - F * N(-d1)), -disc * N(-d1)
    theta = (-disc * F * pdf(d1) * iv / (2 * math.sqrt(T)) + RATE * p) / 365
    return p, dl, disc * pdf(d1) / (F * s), theta, disc * F * pdf(d1) * math.sqrt(T) / 100


def solve(price, F, K, T, cp):
    if price <= 0 or T <= 0 or F <= 0 or K <= 0 or price <= max((F - K) if cp == "CE" else (K - F), 0) * 0.98:
        return None
    lo, hi = 0.01, 3.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if b76(F, K, T, mid, cp)[0] > price:
            hi = mid
        else:
            lo = mid
    return mid if 0.02 < mid < 2.9 else None


# ---------------------------------------------------------------- at-the-money IV history, from NSE's end of day files
def _day_iv(path):
    bysym = {}
    for r in csv.DictReader(open(path, encoding="utf8")):
        if r["FinInstrmTp"] in ("STO", "STF") or (r["TckrSymb"] in INDICES and r["FinInstrmTp"] in ("IDO", "IDF")):
            bysym.setdefault(r["TckrSymb"], []).append(r)
    out = {}
    for sym, rows in bysym.items():
        opts = [r for r in rows if r["FinInstrmTp"] in ("STO", "IDO")]
        if not opts:
            continue
        day = date.fromisoformat(opts[0]["TradDt"])
        exps = sorted({r["XpryDt"] for r in opts if (date.fromisoformat(r["XpryDt"]) - day).days >= 5})
        if not exps:
            continue
        ex = [r for r in opts if r["XpryDt"] == exps[0]]
        fut = [r for r in rows if r["FinInstrmTp"] in ("STF", "IDF") and r["XpryDt"] == exps[0]]
        F = float(fut[0]["SttlmPric"] or 0) if fut else 0
        F = F or float(ex[0]["UndrlygPric"] or 0)
        if not F:
            continue
        K = min({float(r["StrkPric"]) for r in ex}, key=lambda k: abs(k - F))
        T = (date.fromisoformat(exps[0]) - day).days / 365
        v = [solve(float(r["SttlmPric"] or 0), F, K, T, r["OptnTp"]) for r in ex if float(r["StrkPric"]) == K]
        v = [x for x in v if x]
        if v:
            out[sym] = round(sum(v) / len(v) * 100, 1)
    return out


def load_hist():
    if BOOK["days"] is None:
        try:
            BOOK["days"] = json.load(open(HIST, encoding="utf8"))
        except Exception:
            BOOK["days"] = {}
    return BOOK["days"]


def build_hist():
    """Adds any day not yet worked out. The first run takes a couple of minutes, later ones seconds."""
    book = dict(load_hist())
    new = 0
    for f in sorted(glob.glob(os.path.join(FO, "*.csv"))):
        n = os.path.basename(f)[:8]
        key = f"{n[:4]}-{n[4:6]}-{n[6:8]}"
        if key in book or os.path.getsize(f) < 100:
            continue
        try:
            book[key] = _day_iv(f)
            new += 1
        except Exception:
            pass
    if new:
        json.dump(book, open(HIST + ".tmp", "w", encoding="utf8"))
        os.replace(HIST + ".tmp", HIST)
        BOOK["days"] = book
    return new


def hist_of(sym):
    book = load_hist()
    return [[d, book[d][sym]] for d in sorted(book) if sym in book[d]]


# ---------------------------------------------------------------- the verdict
def price_read(iv, rank, rv):
    """Two tests: against its own recent IV, and against how much the stock has actually been moving."""
    gap = iv - rv
    if rank >= 70:
        return "rich" if gap >= 3 else "high"
    if rank <= 30:
        return "cheap" if gap <= -3 else "low"
    return "fair"


def load_cuts():
    try:
        return json.load(open(CUTS, encoding="utf8"))
    except Exception:
        return None


def position_read(x, call_add, put_add):
    """x: fresh call OI minus fresh put OI, as a share of OI near the price. Fixed thresholds fire on most
    stocks because call OI usually runs ahead of put OI, so each stock is compared with the rest of F&O."""
    c = load_cuts()
    if not c:
        return "flat"
    if x >= c["hi"] and call_add > put_add:
        return "dn"
    if x <= c["lo"] and put_add > call_add:
        return "up"
    return "flat"


def save_cuts(xs):
    xs = sorted(xs)
    if len(xs) >= 100:
        at = lambda p: xs[int(p * (len(xs) - 1))]
        json.dump({"lo": at(0.15), "hi": at(0.85), "n": len(xs), "day": date.today().isoformat()}, open(CUTS, "w", encoding="utf8"))


def build(sym, nse, yahoo, E, row=None, exp=None, term=True):
    """row: this stock's Live F&O row, for the futures read and today's chart."""
    key = (sym, exp, term)
    hit = CACHE.get(key)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    exps = nse.contract_info(sym).get("expiryDates") or []
    if not exps:
        return {"error": f"{sym} has no options listed."}
    exp = exp if exp in exps else exps[0]
    raw = nse.option_chain(sym, exp)
    S = float(raw["records"]["underlyingValue"])
    quote = nse.get("/api/NextApi/apiClient/GetQuoteApi", {"functionName": "getSymbolDerivativesData", "symbol": sym}, ttl=60)
    fq = [x for x in quote.get("data", []) if x.get("instrumentType") in ("FUTSTK", "FUTIDX")]
    futs = {x["expiryDate"]: float(x.get("lastPrice") or 0) for x in fq}
    T = max((datetime.strptime(exp, "%d-%b-%Y").date() - date.today()).days, 1) / 365
    F = futs.get(exp) or S * math.exp(RATE * T)     # weekly index expiries have no future of their own
    sm = E.option_summary(raw, exp, None, None)
    data = {float((r.get("CE") or r.get("PE"))["strikePrice"]): r for r in raw["records"]["data"] if r.get("CE") or r.get("PE")}
    ks = sorted(k for k in data if k > 0)                 # NSE sometimes sends an empty row with strike 0
    if not ks or S <= 0:
        return {"error": f"No option prices for {sym} yet."}
    # the forward the options themselves imply: without it calls and puts at one strike show different IVs
    def mid(k, cp):
        x = data[k].get(cp) or {}
        b, a = float(x.get("buyPrice1") or 0), float(x.get("sellPrice1") or 0)
        return (a + b) / 2 if a > 0 and b > 0 and a - b < 0.1 * a else float(x.get("lastPrice") or 0)
    syn = [k + (mid(k, "CE") - mid(k, "PE")) * math.exp(RATE * T) for k in sorted(ks, key=lambda k: abs(k - S))[:3] if mid(k, "CE") > 0 and mid(k, "PE") > 0]
    if len(syn) == 3 and abs(sorted(syn)[1] / S - 1) < 0.03:
        F = sorted(syn)[1]
    atm = min(ks, key=lambda k: abs(k - F))
    step = min((b - a for a, b in zip(ks, ks[1:])), default=1) or 1

    def side(k, cp):
        x = data[k].get(cp) or {}
        b, a = float(x.get("buyPrice1") or 0), float(x.get("sellPrice1") or 0)
        px = (a + b) / 2 if a > 0 and b > 0 and a - b < 0.1 * a else float(x.get("lastPrice") or 0)
        iv = solve(px, F, k, T, cp)
        g = b76(F, k, T, iv, cp) if iv else None
        return {"ltp": float(x.get("lastPrice") or 0), "oi": int(x.get("openInterest") or 0), "doi": int(x.get("changeinOpenInterest") or 0),
                "vol": int(x.get("totalTradedVolume") or 0), "iv": round(iv * 100, 1) if iv else None,
                "d": round(g[1], 2) if g else None, "g": round(g[2], 4) if g else None, "t": round(g[3], 2) if g else None, "v": round(g[4], 2) if g else None}

    chain = [{"k": k, "c": side(k, "CE"), "p": side(k, "PE")} for k in ks]
    at = next(x for x in chain if x["k"] == atm)
    v = [x for x in (at["c"]["iv"], at["p"]["iv"]) if x]
    iv_now = round(sum(v) / len(v), 1) if v else None
    smile = []
    for x in chain:
        o = x["c"] if x["k"] >= F else x["p"]
        if o["iv"] and o["vol"] >= 50:
            smile.append([x["k"], o["iv"]])
    hist = hist_of(sym)
    ivs = [h[1] for h in hist]
    rank = round(sum(1 for h in ivs if iv_now is not None and h < iv_now) / len(ivs) * 100) if ivs and iv_now is not None else None
    rv = None
    try:
        c = [x["c"] for x in yahoo.history(yf_symbol(sym), period="3mo", interval="1d", ttl=3600)]
        r_ = [math.log(c[i] / c[i - 1]) for i in range(max(1, len(c) - 20), len(c))]
        m = sum(r_) / len(r_)
        rv = round(math.sqrt(sum((x - m) ** 2 for x in r_) / (len(r_) - 1)) * math.sqrt(252) * 100, 1)
        rv = rv if rv == rv else None
    except Exception:
        pass

    floor, ceil, move, pcr = sm.get("floor"), sm.get("ceiling"), sm.get("straddle") or 0, sm.get("pcr") or 0
    near = [x for x in chain if abs(x["k"] - F) <= 10 * step]
    call_add, put_add = sum(x["c"]["doi"] for x in near), sum(x["p"]["doi"] for x in near)
    near_oi = sum(x["c"]["oi"] + x["p"]["oi"] for x in near) or 1
    xval = (call_add - put_add) / near_oi
    pos = position_read(xval, call_add, put_add)
    price = price_read(iv_now, rank, rv) if None not in (iv_now, rank, rv) else None
    head = f"{PRICE_HEAD.get(price, 'Option prices are still loading')}, and {POS_HEAD[pos]}" if price else POS_HEAD[pos].capitalize()
    verb = lambda n: "added" if n >= 0 else "closed"
    lines = [f"Option prices imply a move of about ±{move:,.0f} ({move / S * 100:.1f}%) by {exp}: {S - move:,.0f} to {S + move:,.0f}.",
             f"Today near the price: {abs(call_add):,} call contracts {verb(call_add)} and {abs(put_add):,} put contracts {verb(put_add)}."]
    row = row or {}
    fk, fo = row.get("oi_kind"), row.get("oi_pchg")
    if fo is None and fq:                           # indices are not on the Live F&O board
        oi, ch = sum(int(x.get("openInterest") or 0) for x in fq), sum(int(x.get("changeinOpenInterest") or 0) for x in fq)
        if oi - ch > 0:
            fo = round(ch / (oi - ch) * 100, 1)
            up = float(fq[0].get("pchange") or 0) >= 0
            fk = None if abs(fo) < 2 else ("long_buildup" if up else "short_buildup") if fo > 0 else ("short_covering" if up else "long_unwinding")
    chips = [{"k": "Option prices", "v": PRICE_CHIP.get(price, "–"), "s": f"IV {iv_now}%, higher than {rank}% of the last {len(ivs)} sessions" if rank is not None else ""},
             {"k": "Positioning", "v": POS_CHIP[pos], "s": f"Put call ratio {pcr:.2f}"},
             {"k": "Futures today", "v": FUT_WORD.get(fk, "Little change"), "s": f"OI {fo:+.1f}%" if fo is not None else ""},
             {"k": "Floor to ceiling", "v": f"{floor:,.0f} to {ceil:,.0f}" if floor and ceil else "–", "s": "most put OI, most call OI"}]
    change = []
    if ceil and ceil >= S:
        change.append(f"A close above {ceil:,.0f} would mean call writers have lost that level.")
    if floor and floor <= S:
        change.append(f"A close below {floor:,.0f} would mean put writers have lost that level.")
    term_rows = []
    if term:
        for e in exps[:3]:
            try:
                rr = raw if e == exp else nse.option_chain(sym, e, ttl=300)
                best = min((r for r in rr["records"]["data"] if r.get("CE") and r.get("PE")), key=lambda r: abs(float(r["CE"]["strikePrice"]) - S))
                Fe = futs.get(e) or S
                Te = max((datetime.strptime(e, "%d-%b-%Y").date() - date.today()).days, 1) / 365
                vs = []
                for cp in ("CE", "PE"):
                    x = best[cp]
                    w = solve(float(x.get("lastPrice") or 0), Fe, float(x["strikePrice"]), Te, cp)
                    if w:
                        vs.append(w * 100)
                term_rows.append({"exp": e, "iv": round(sum(vs) / len(vs), 1) if vs else None})
            except Exception:
                term_rows.append({"exp": e, "iv": None})
    out = {"sym": sym, "sector": row.get("sector"), "spot": S, "fut": F, "fut_px": futs.get(exp), "chg": row.get("chg"), "exp": exp, "expiries": exps[:3],
           "days": max((datetime.strptime(exp, "%d-%b-%Y").date() - date.today()).days, 0), "atm": atm, "move": move, "floor": floor, "ceiling": ceil,
           "pcr": pcr, "max_pain": sm.get("max_pain"), "step": step, "chain": chain, "smile": smile, "term": term_rows, "hist": hist,
           "meter": {"iv": iv_now, "rank": rank, "rv": rv, "n": len(ivs), "lo": min(ivs) if ivs else None, "hi": max(ivs) if ivs else None},
           "x": round(xval, 4), "verdict": {"head": head, "tone": pos, "price": price, "pos": pos, "lines": lines, "chips": chips, "change": change},
           "ts": datetime.now().strftime("%d %b %H:%M")}
    CACHE[key] = (time.time(), out)
    return out


# ---------------------------------------------------------------- written down each evening, so it can be scored later
def log_day(day, syms, build_one):
    try:
        book = json.load(open(LOG, encoding="utf8")) if os.path.exists(LOG) else {}
    except Exception:
        book = {}
    if day in book:
        return 0
    built = {}
    for s in syms:
        try:
            d = build_one(s)
            if isinstance(d, dict) and d.get("verdict"):
                built[s] = d
        except Exception:
            pass
    save_cuts([d["x"] for d in built.values()])     # the spread of one day is the yardstick for the next
    rows = {}
    for s, d in built.items():
        v = d["verdict"]
        if v.get("price"):
            rows[s] = [v["price"], v["pos"], d["spot"]]
    if rows:
        book[day] = rows
        for k in sorted(book)[:-150]:
            book.pop(k)
        json.dump(book, open(LOG + ".tmp", "w", encoding="utf8"))
        os.replace(LOG + ".tmp", LOG)
    return len(rows)


def verdict_test(nifty, closes_by_day):
    """How stocks in each positioning read did 5 and 20 sessions later, against Nifty.
    closes_by_day: {date: {sym: close}} from the evening log of every stock."""
    try:
        book = json.load(open(LOG, encoding="utf8")) if os.path.exists(LOG) else {}
    except Exception:
        book = {}
    nd = sorted(nifty)
    out = {"started": min(book) if book else None, "sessions": len(book), "stocks": max((len(v) for v in book.values()), default=0), "h": {}}
    for h in (5, 20):
        acc = {"up": [], "flat": [], "dn": []}
        for day, rows in book.items():
            if day not in nd:
                continue
            i = nd.index(day)
            if i + h >= len(nd):
                continue
            later = closes_by_day.get(nd[i + h])
            if not later:
                continue
            nr = nifty[nd[i + h]] / nifty[day] - 1
            for sym, (price, pos, px) in rows.items():
                if sym in later and px:
                    acc[pos].append((later[sym] / px - 1 - nr) * 100)
        out["h"][h] = {k: {"n": len(v), "avg": round(sum(v) / len(v), 2), "beat": round(sum(1 for x in v if x > 0) / len(v) * 100)} for k, v in acc.items() if v}
    return out
