"""Everything about one stock, from the data we already hold.

Sources: sector master (2,396 NSE stocks with sector and cap tier), the
Fundamental Engine cache (P&L, quarters, ratios, 12 quarters of shareholding
per stock), the chart pattern scan, and the desk's published calls."""
import csv, json, os, statistics, threading, time
from collections import defaultdict

ROOT = os.path.dirname(os.path.abspath(__file__))
SCANNERS = os.path.dirname(ROOT)
MASTER = os.path.join(SCANNERS, "fundamental sectors", "sector_master_clean.csv")
FUND = os.path.join(SCANNERS, "Fundamental Engine", "cache")
PATTERNS = os.path.join(ROOT, "data", "patterns_today.csv")      # written nightly by patterns_run.py
CALLS = os.path.join(ROOT, "data", "desk_calls.json")
FRESH = os.path.join(ROOT, "data", "fund_fresh")      # our refreshed copies; the Fundamental Engine cache is never written

STATE = {"master": {}, "peers": {}, "ready": False}
LOCK = threading.Lock()

SECTOR_NAME = {"financial-services": "Financial Services", "software-services": "Software & IT", "engineering-capital-goods": "Capital Goods",
               "fmcg": "FMCG", "healthcare": "Healthcare", "automobile": "Automobiles", "auto-ancillary": "Auto Components",
               "building-materials": "Building Materials", "real-estate": "Real Estate", "tourism-hospitality": "Hotels & Tourism",
               "consumer-durables": "Consumer Durables", "media-entertainment": "Media", "it": "IT", "nbfc": "NBFC",
               "education-training": "Education", "plastic-pipes": "Plastic Pipes", "solar-panel": "Solar", "dairy-products": "Dairy"}


def tier_group(cap):
    return "Large & Mid" if cap in ("Large", "Mid") else cap or "Micro"


def nice_sector(s):
    return SECTOR_NAME.get(s, (s or "").replace("-", " ").title())


ALIAS = {"ICICILIFE": "ICICIPRULI", "HEG": "HEGAM"}            # new NSE symbol: saved company data is under the old one


WAS = {"ETERNAL": ["Zomato"], "TMPV": ["Tata Motors", "TATAMOTORS"], "LTM": ["LTIMindtree", "LTIM"]}   # names people still search for


def pretty_name(n):
    """NSE sends some names in capitals. Short first words are usually initials, so they stay."""
    n = str(n or "").strip()
    if not n or n != n.upper():
        return n
    w = n.split()
    return " ".join(x if i == 0 and len(x) <= 4 else x.capitalize() for i, x in enumerate(w))


def load_fund(sym):
    p = os.path.join(FRESH, f"{sym}.json")
    if not os.path.exists(p):
        sym = ALIAS.get(sym, sym)
        p = os.path.join(FRESH, f"{sym}.json")
    if not os.path.exists(p):
        p = os.path.join(FUND, f"{sym}.json")
    if not os.path.exists(p):
        return None
    try:
        return json.load(open(p, encoding="utf8"))
    except Exception:
        return None


RATIOS = {}


def ratios(sym):
    """Price to book and ROE, checked. Some balance sheets arrive 100 times too small (filed in billions,
    read as crores): equity capital should equal shares x face value, so that gap is detectable and is corrected.
    Whatever is still absurd is dropped, because a wrong number is worse than none."""
    if sym in RATIOS:
        return RATIOS[sym]
    out = {"pb": None, "roe": None, "nm": []}
    f = load_fund(sym)
    if f:
        t = f.get("tiles", {})
        px, bv, roe, mc, fv = (num(t.get(k)) for k in ("Current Price", "Book Value", "ROE", "Market Cap", "Face Value"))
        pb = px / bv if px and bv and bv > 0 else None
        rows = (f.get("balance-sheet") or {}).get("rows", {})
        last = lambda k: next((v for v in reversed(rows.get(k) or []) if v is not None), None)
        eq, rs = last("Equity Capital"), last("Reserves")
        if px and mc and fv and eq and eq > 0 and rs is not None and 50 < (mc / px * fv) / eq < 200:
            worth = (eq + rs) * 100
            pb = mc / worth if worth > 0 else None
            qp = [v for v in ((f.get("quarters") or {}).get("rows", {}).get("Net Profit") or [])[-4:] if v is not None]
            roe = round(sum(qp) / worth * 100, 1) if len(qp) == 4 and worth > 0 else None
        if pb is not None and pb > 200:
            out["nm"].append("Price to book")
            pb = None
        if roe is not None and abs(roe) > 150:
            out["nm"].append("ROE")
            roe = None
        out.update(pb=round(pb, 2) if pb else None, roe=roe)
    RATIOS[sym] = out
    return out


def add_ratios(d):
    """Own P/B and ROE, and the peer medians the industry table does not carry, from our saved company data."""
    sym = d.get("sym")
    if not d.get("has_fund") or not sym:
        return d
    me = ratios(sym)
    mine = d.setdefault("mine", {})
    mine.update(pb=me["pb"], roe=me["roe"], nm=list(me["nm"]))
    if (mine.get("dy") or 0) > 25:              # a one-off payout or bad data, not a yield anyone earns
        mine["dy"] = None
        mine["nm"].append("Dividend yield")
    peer, rows = d.get("peer") or {}, d.get("peers") or []
    vals = {"pb": [], "roe": []}
    for r in rows:
        x = ratios(r["sym"])
        if r.get("roe") is None:
            r["roe"] = x["roe"]
        for k in vals:
            if x[k] is not None:
                vals[k].append(x[k])
    if peer:
        for k, v in vals.items():
            if len(v) >= 3:
                peer[k] = round(statistics.median(v), 2)
    return d


def num(x):
    try:
        return float(x) if x is not None else None
    except (TypeError, ValueError):
        return None


def init():
    """Load the master and work out peer medians per sector and size group."""
    with LOCK:
        if STATE["ready"]:
            return
        master = {}
        for r in csv.DictReader(open(MASTER, encoding="utf8")):
            master[r["symbol"]] = {"sym": r["symbol"], "name": pretty_name(r["company_name"]), "sector": r["sector"],
                                   "cap": r["cap"], "mcap": num(r["market_cap_cr"])}
        groups = defaultdict(lambda: defaultdict(list))
        for sym, m in master.items():
            f = load_fund(sym)
            if not f:
                continue
            t = f.get("tiles", {})
            pe, roe, roce, bv, px, dy = (num(t.get(k)) for k in ("Stock P/E", "ROE", "ROCE", "Book Value", "Current Price", "Dividend Yield"))
            key = (m["sector"], tier_group(m["cap"]))
            if pe and 0 < pe < 300: groups[key]["pe"].append(pe)
            if roe is not None: groups[key]["roe"].append(roe)
            if roce is not None: groups[key]["roce"].append(roce)
            if bv and px: groups[key]["pb"].append(px / bv)
            if dy is not None: groups[key]["dy"].append(dy)
            groups[key]["members"].append((m["mcap"] or 0, sym))
            allkey = (m["sector"], "all sizes")
            for k2, v2 in (("pe", pe if pe and 0 < pe < 300 else None), ("roe", roe), ("roce", roce), ("pb", px / bv if bv and px else None), ("dy", dy)):
                if v2 is not None: groups[allkey][k2].append(v2)
            groups[allkey]["members"].append((m["mcap"] or 0, sym))
        peers = {}
        for key, g in groups.items():
            peers[key] = {k: round(statistics.median(v), 2) for k, v in g.items() if k != "members" and len(v) >= 3}
            peers[key]["n"] = len(g["members"])
            peers[key]["members"] = [s for _, s in sorted(g["members"], reverse=True)]
        for now, was in ALIAS.items():
            if was in master and now not in master:
                master[now] = {**master[was], "sym": now}
        STATE.update(master=master, peers=peers, ready=True)


def search_list():
    init()
    old = set(ALIAS.values())
    return [{"s": m["sym"], "n": m["name"], **({"was": WAS[m["sym"]]} if m["sym"] in WAS else {})} for m in sorted(STATE["master"].values(), key=lambda m: -(m["mcap"] or 0)) if m["sym"] not in old]


def _pairs(sec, name):
    """{period: value} for one row of a fundamentals section, trailing twelve months left out."""
    s = sec or {}
    return {p: v for p, v in zip(s.get("periods") or [], (s.get("rows") or {}).get(name) or []) if v is not None and "TTM" not in p}


def _last(sec, name):
    v = [x for x in ((sec or {}).get("rows") or {}).get(name) or [] if x is not None]
    return v[-1] if v else None


def health(sym):
    """Debt, interest cover, cash and promoter holding from filings already on file."""
    f = load_fund(sym)
    if not f:
        return None
    pl, bs, cf, sh = f.get("profit-loss"), f.get("balance-sheet"), f.get("cash-flow"), f.get("shareholding")
    out = {"lender": bool(f.get("is_lender")), "asof": ((bs or {}).get("periods") or [None])[-1]}
    if not out["lender"]:
        eq, res, debt = _last(bs, "Equity Capital"), _last(bs, "Reserves"), _last(bs, "Borrowings")
        if eq is not None and res is not None and debt is not None:
            worth = eq + res
            if worth <= 0:
                out["neg_worth"] = True
            else:
                out["de"] = round(debt / worth, 2)
        op, oth, intr = _last(pl, "Operating Profit"), _last(pl, "Other Income"), _last(pl, "Interest")
        if op is not None and intr and intr > 0:
            out["cover"] = round((op + (oth or 0)) / intr, 1)
        cfo, np_ = _pairs(cf, "Cash from Operating Activity"), _pairs(pl, "Net Profit")
        both = [p for p in cfo if p in np_][-3:]
        tot = sum(np_[p] for p in both)
        if len(both) == 3 and tot > 0 and all(np_[p] > 0 for p in both):   # a loss year makes the ratio meaningless
            out["cash"] = round(sum(cfo[p] for p in both) / tot * 100)
    pr = [x for x in ((sh or {}).get("rows") or {}).get("Promoters") or [] if x is not None]
    if pr:
        out["promoter"] = pr[-1]
        if len(pr) >= 5:
            out["promoter_chg"] = round(pr[-1] - pr[-5], 2)
    return out


def eps_years(sym):
    f = load_fund(sym)
    return _pairs((f or {}).get("profit-loss"), "EPS in Rs")


def _neutral_trigger(t):
    """The engine writes 'buy trigger' and 'sell trigger'. Describe the pattern instead."""
    import re
    t = re.sub(r"(?i)(?<![a-z])(buy|sell) trigger( is)?:? *", "the pattern completes on ", t or "")
    t = re.sub(r"(?i)close (above|below)", lambda m: "close " + m.group(1).lower(), t)
    t = t.replace(" — ", ". ").replace("CLOSE", "close").replace("ABOVE", "above").replace("BELOW", "below")
    t = t.replace(". the pattern", ". The pattern").replace(" (pattern not complete)", "").replace("  ", " ")
    return t[:1].upper() + t[1:]


def pattern_for(sym):
    r = _pattern_row(sym)
    if r and r.get("target") and r.get("entry") and abs(r["target"] / r["entry"] - 1) > 0.6:
        r.update(target=None, rr=None)           # a projection this far from the price is not worth showing
    return r


def _pattern_row(sym):
    if not os.path.exists(PATTERNS):
        return None
    age_days = (time.time() - os.path.getmtime(PATTERNS)) / 86400
    if age_days > 7:
        return None                      # a stale scan is worse than none
    for r in csv.DictReader(open(PATTERNS, encoding="utf8")):
        if r["symbol"] == sym:
            return {"pattern": r["pattern"], "direction": r["direction"], "status": r["tier"], "reliability": r["reliability"],
                    "trigger": _neutral_trigger(r["trigger"]), "entry": num(r["entry"]), "stop": num(r["stop"]), "target": num(r["target"]),
                    "note": r.get("reliability_note", ""), "age_days": round(age_days),
                    "scanned": time.strftime("%d %b", time.localtime(os.path.getmtime(PATTERNS)))}
    return None


def desk_call(sym):
    if not os.path.exists(CALLS):
        return None
    try:
        calls = json.load(open(CALLS, encoding="utf8"))
    except Exception:
        return None
    live = [c for c in calls if c.get("symbol") == sym and c.get("status", "open") == "open"]
    return live[-1] if live else None


def series(block, row):
    if not block or row not in block.get("rows", {}):
        return []
    return [{"p": p, "v": v} for p, v in zip(block["periods"], block["rows"][row])]


def cagr(vals, years):
    vals = [v for v in vals if v is not None]
    if len(vals) < years + 1 or vals[-years - 1] <= 0 or vals[-1] <= 0:
        return None
    return round(((vals[-1] / vals[-years - 1]) ** (1 / years) - 1) * 100, 1)


def fundamentals(sym):
    init()
    m = STATE["master"].get(sym)
    f = load_fund(sym)
    if not f:
        return {"profile": m, "has_fund": False}
    t = f.get("tiles", {})
    px, bv = num(t.get("Current Price")), num(t.get("Book Value"))
    mine = {"pe": num(t.get("Stock P/E")), "pb": round(px / bv, 2) if px and bv else None, "roe": num(t.get("ROE")),
            "roce": num(t.get("ROCE")), "dy": num(t.get("Dividend Yield"))}
    key = (m["sector"], tier_group(m["cap"])) if m else None
    group = STATE["peers"].get(key, {}) if key else {}
    peer, peer_scope, peer_rows = {}, "", []
    try:
        sp = smart_peers(sym)
    except Exception:
        sp = None
    ind = industry_peers(sym) if sp else None
    peer_note = (sp or {}).get("note")
    no_compare = bool(sp and sp.get("compare") is False)
    if no_compare:
        peer_scope = sp["scope"]
        peer_rows = [{"sym": x["sym"], "name": x["name"], "mcap": x.get("mcap"), "pe": x.get("pe"), "roce": x.get("roce"),
                      "roe": None, "pvar": x.get("pvar")} for x in sp["peers"] if x["sym"] != sym][:8]
    elif sp and sp.get("median") and (sp["median"].get("n") or 0) >= 3:
        md = sp["median"]
        peer = {"pe": md.get("pe"), "roce": md.get("roce"), "dy": md.get("dy"), "pvar": md.get("pvar"), "svar": md.get("svar"), "n": md.get("n")}
        if f.get("is_lender") and group.get("n", 0) >= 5 and tier_group(m["cap"]) == "Large & Mid":
            peer["roe"] = group.get("roe")              # banks are judged on ROE, which the industry table lacks
        peer_scope = sp["scope"]
        peer_rows = [{"sym": x["sym"], "name": x["name"], "mcap": x.get("mcap"), "pe": x.get("pe"), "roce": x.get("roce"),
                      "roe": None, "pvar": x.get("pvar")} for x in sp["peers"] if x["sym"] != sym][:8]
    elif group.get("n", 0) >= 5:
        peer, peer_scope = group, f"{nice_sector(m['sector'])}, {tier_group(m['cap'])}"
    elif sp and sp.get("peers"):
        peer_scope = sp["scope"]
        peer_rows = [{"sym": x["sym"], "name": x["name"], "mcap": x.get("mcap"), "pe": x.get("pe"), "roce": x.get("roce"),
                      "roe": None, "pvar": x.get("pvar")} for x in sp["peers"] if x["sym"] != sym][:8]
    lender = bool(f.get("is_lender"))
    q = f.get("quarters", {})
    sales_row = "Revenue" if lender else "Sales"
    qs = series(q, sales_row)[-8:]; qp = series(q, "Net Profit")[-8:]
    allq_s = series(q, sales_row); allq_p = series(q, "Net Profit")
    yoy = lambda s: round((s[-1]["v"] / s[-5]["v"] - 1) * 100, 1) if len(s) >= 5 and s[-5]["v"] and s[-5]["v"] > 0 and s[-1]["v"] is not None else None
    qoq = lambda s: round((s[-1]["v"] / s[-2]["v"] - 1) * 100, 1) if len(s) >= 2 and s[-2]["v"] and s[-2]["v"] > 0 and s[-1]["v"] is not None else None
    pl = f.get("profit-loss", {})
    annual_s = [v for p, v in zip(pl.get("periods", []), pl.get("rows", {}).get(sales_row, pl.get("rows", {}).get("Sales", []))) if p != "TTM"]
    annual_p = [v for p, v in zip(pl.get("periods", []), pl.get("rows", {}).get("Net Profit", [])) if p != "TTM"]
    sh = f.get("shareholding", {})
    own = {k: v for k, v in sh.get("rows", {}).items() if k in ("Promoters", "FIIs", "DIIs", "Public", "Government")}
    peers_list = [x for x in group.get("members", []) if x != sym][:6] if not peer_rows and group.get("n", 0) >= 5 else []
    for ps in peers_list:
        pf = load_fund(ps)
        if not pf:
            continue
        pt = pf.get("tiles", {})
        peer_rows.append({"sym": ps, "name": STATE["master"][ps]["name"], "mcap": STATE["master"][ps]["mcap"],
                          "pe": num(pt.get("Stock P/E")), "roe": num(pt.get("ROE")), "roce": num(pt.get("ROCE"))})
    return {"profile": {**(m or {"sym": sym, "name": f.get("name")}), "sector_name": nice_sector(m["sector"]) if m else "",
                        "tier": tier_group(m["cap"]) if m else "", "peer_scope": peer_scope, "peer_note": peer_note, "peer_compare": not no_compare},
            "has_fund": True, "lender": lender, "mine": mine, "peer": {k: v for k, v in peer.items() if k != "members"},
            "peers": peer_rows, "industry": (ind or {}).get("path") if ind else None, "quarters": {"periods": [x["p"] for x in qs], "sales": [x["v"] for x in qs], "profit": [x["v"] for x in qp]},
            "sales_yoy": yoy(allq_s), "profit_yoy": yoy(allq_p), "sales_qoq": qoq(allq_s), "profit_qoq": qoq(allq_p),
            "latest_q": allq_s[-1]["p"] if allq_s else None,
            "latest_sales": allq_s[-1]["v"] if allq_s else None, "latest_profit": allq_p[-1]["v"] if allq_p else None,
            "sales_cagr5": cagr(annual_s, 5), "profit_cagr5": cagr(annual_p, 5),
            "own": {"periods": sh.get("periods", []), "rows": own}, "fetched": f.get("fetched", "")[:10]}


# ---------------------------------------------------------------- results status
import sys, time
from datetime import date, datetime, timedelta

_FE = os.path.join(SCANNERS, "Fundamental Engine")
_STATUS = {}            # sym -> (time, status)


def current_quarter(today=None):
    """The most recent quarter that has ended, as Screener labels it ('Sep 2026')."""
    t = today or date.today()
    for m in (12, 9, 6, 3):
        y = t.year
        end = date(y, m, 31 if m in (3, 12) else 30)
        if end < t:
            return end.strftime("%b %Y"), end
    end = date(t.year - 1, 12, 31)
    return end.strftime("%b %Y"), end


def refresh_fund(sym):
    """Pull a fresh copy from Screener for one stock. Returns True if it worked."""
    try:
        if _FE not in sys.path:
            sys.path.insert(0, _FE)
        import screener
        os.makedirs(FRESH, exist_ok=True)
        screener.CACHE = FRESH

        def last_q(doc):
            p = (doc.get("quarters") or {}).get("periods") or []
            try:
                return datetime.strptime(p[-1], "%b %Y") if p and not doc.get("error") else None
            except ValueError:
                return None

        cons = screener.fetch(sym, force=True)
        a = last_q(cons)
        # some companies stop updating the consolidated page, so an old one is checked against standalone
        if a is None or (datetime.now() - a).days > 200:
            alone = screener.fetch(sym, consolidated=False, force=True)
            b = last_q(alone)
            if a is not None and (b is None or a >= b):
                screener.fetch(sym, force=True)      # consolidated was the newer one: put it back
            elif b is None:
                try: os.remove(os.path.join(FRESH, f"{sym}.json"))
                except OSError: pass
                return False
        return True
    except Exception:
        return False


def results_status(sym, nse):
    """Has this stock reported the latest quarter? Refreshes our copy when the
    exchange shows a filing that our cache does not have yet."""
    hit = _STATUS.get(sym)
    if hit and time.time() - hit[0] < 3 * 3600:
        return hit[1]
    q, q_end = current_quarter()
    deadline = (q_end + timedelta(days=45 if q_end.month != 3 else 60)).strftime("%d %b")
    f = load_fund(sym) or {}
    periods = (f.get("quarters") or {}).get("periods") or []
    have = periods[-1] if periods else None
    filed, filed_dt = None, None
    try:
        for a in nse.get("/api/corporate-announcements", {"index": "equities", "symbol": sym}, ttl=1800):
            if a.get("desc") != "Outcome of Board Meeting":
                continue
            d = datetime.strptime(a["an_dt"][:11], "%d-%b-%Y").date()
            if d <= q_end:
                break
            txt = (a.get("attchmntText") or "").lower()
            if "result" in txt or "outcome of board meeting dated" in txt or "financial" in txt:
                filed = d
                filed_dt = a["an_dt"]
    except Exception:
        pass
    refreshed = False
    if (filed and have != q) or not periods:
        refreshed = refresh_fund(sym)
        f = load_fund(sym) or {}
        periods = (f.get("quarters") or {}).get("periods") or []
        have = periods[-1] if periods else None
    status = {"quarter": q, "latest": have, "deadline": deadline, "refreshed": refreshed,
              "filed": filed.strftime("%d %b") if filed else None, "filed_dt": filed_dt}
    if have == q:
        status["state"] = "out"
    elif filed:
        status["state"] = "filed_pending"     # filed at the exchange, numbers not in our source yet
    else:
        status["state"] = "due"
    _STATUS[sym] = (time.time(), status)
    return status


# ---------------------------------------------------------------- industry peers
PEERS_DIR = os.path.join(ROOT, "data", "peers")
_LAST = [0.0]


def _get(s, url, **kw):
    """Polite Screener request: at most one a second, one retry when told to slow down."""
    for attempt in range(2):
        wait = 1.2 - (time.time() - _LAST[0])
        if wait > 0:
            time.sleep(wait)
        r = s.get(url, **kw); _LAST[0] = time.time()
        if r.status_code != 429:
            return r
        time.sleep(6)
    return r


_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def _f(x):
    try:
        return float(str(x).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def industry_peers(sym, max_age_days=7):
    """Screener's industry classification and its peer table, including the
    industry median row. Cached a week per stock."""
    import re, requests
    from bs4 import BeautifulSoup
    os.makedirs(PEERS_DIR, exist_ok=True)
    path = os.path.join(PEERS_DIR, f"{sym}.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age_days * 86400:
        try:
            return _clean(json.load(open(path, encoding="utf8")))
        except Exception:
            pass
    s = requests.Session(); s.headers.update({"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"})
    out = None
    for u in (f"https://www.screener.in/company/{sym}/consolidated/", f"https://www.screener.in/company/{sym}/"):
        try:
            h = _get(s, u, timeout=25).text
        except Exception:
            continue
        wid = re.search(r'data-warehouse-id="(\d+)"', h)
        if not wid:
            continue
        path_ = [v.strip() for _, v in re.findall(r'title="(Broad Sector|Sector|Broad Industry|Industry)"[^>]*>\s*([^<]+)<', h)]
        try:
            r = _get(s, f"https://www.screener.in/api/company/{wid.group(1)}/peers/", timeout=25)
        except Exception:
            continue
        t = BeautifulSoup(r.text, "html.parser").find("table")
        if not t:
            continue
        heads = [th.get_text(" ", strip=True) for th in t.find_all("th")]
        col = lambda name: next((i for i, x in enumerate(heads) if x.startswith(name)), None)
        ix = {k: col(v) for k, v in {"pe": "P/E", "mcap": "Mar Cap", "dy": "Div Yld", "pvar": "Qtr Profit Var", "svar": "Qtr Sales Var", "roce": "ROCE"}.items()}
        peers, median = [], None
        for tr in t.find_all("tr")[1:]:
            tds = tr.find_all("td")
            txt = tr.get_text(" ", strip=True)
            if txt.startswith("Median"):
                m = re.match(r"Median:\s*(\d+)", txt)
                vals = [td.get_text(" ", strip=True) for td in tds]
                # the median row has no S.No. cell; its first cell is the label
                off = len(heads) - len(vals)
                median = {k: _f(vals[i - off]) if i is not None and 0 <= i - off < len(vals) else None for k, i in ix.items()}
                median["n"] = int(m.group(1)) if m else None
                continue
            a = tr.find("a", href=True)
            if not a or len(tds) < len(heads):
                continue
            ps = re.search(r"/company/([^/]+)/", a["href"])
            row = {"sym": ps.group(1) if ps else a.get_text(strip=True), "name": a.get_text(" ", strip=True)}
            for k, i in ix.items():
                row[k] = _f(tds[i].get_text(" ", strip=True)) if i is not None else None
            peers.append(row)
        if peers:
            out = {"industry": path_[-1] if path_ else None, "path": path_, "peers": peers, "median": median}
            break
    if out:
        out = _clean(out)
        json.dump(out, open(path, "w", encoding="utf8"))
    return out


def _clean(d):
    import html
    d["industry"] = html.unescape(d.get("industry") or "") or None
    d["path"] = [html.unescape(x) for x in d.get("path") or []]
    for p in d.get("peers", []):
        p["name"] = html.unescape(p.get("name") or "")
    return d


# ---------------------------------------------------------------- smarter peers
OVERRIDES = os.path.join(ROOT, "data", "peer_overrides.json")
_LEVELS = ("Broad Sector", "Sector", "Broad Industry", "Industry")


def _table_rows(html_text):
    import re
    from bs4 import BeautifulSoup
    t = BeautifulSoup(html_text, "html.parser").find("table")
    if not t:
        return []
    heads = []
    for th in t.find_all("th"):
        x = th.get_text(" ", strip=True)
        if x == "S.No." and heads:
            break                      # the table repeats its header row
        heads.append(x)
    col = lambda name: next((i for i, x in enumerate(heads) if x.startswith(name)), None)
    ix = {k: col(v) for k, v in {"pe": "P/E", "mcap": "Mar Cap", "dy": "Div Yld", "pvar": "Qtr Profit Var", "svar": "Qtr Sales Var", "roce": "ROCE"}.items()}
    rows = []
    for tr in t.find_all("tr"):
        a = tr.find("a", href=True); tds = tr.find_all("td")
        if not a or len(tds) < len(heads) or "/company/" not in a["href"]:
            continue
        m = re.search(r"/company/([^/]+)/", a["href"])
        row = {"sym": m.group(1), "name": a.get_text(" ", strip=True)}
        for k, i in ix.items():
            row[k] = _f(tds[i].get_text(" ", strip=True)) if i is not None else None
        rows.append(row)
    return rows


def market_rows(path, max_age_days=7):
    """Companies in one Screener market level, biggest first."""
    import hashlib, requests
    os.makedirs(PEERS_DIR, exist_ok=True)
    cache = os.path.join(PEERS_DIR, "_mkt_" + hashlib.md5(path.encode()).hexdigest()[:12] + ".json")
    if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < max_age_days * 86400:
        return json.load(open(cache, encoding="utf8"))
    s = requests.Session(); s.headers.update({"User-Agent": _UA})
    rows = []
    try:
        r = _get(s, "https://www.screener.in" + path, params={"sort": "market capitalization", "order": "desc", "limit": 100}, timeout=30)
        rows = _table_rows(r.text)
    except Exception:
        pass
    if rows:
        import html
        for x in rows:
            x["name"] = html.unescape(x["name"])
        json.dump(rows, open(cache, "w", encoding="utf8"))
    return rows


def _levels(sym):
    """Screener's classification links for a stock: [(level, name, path)]."""
    import re, requests, html
    os.makedirs(PEERS_DIR, exist_ok=True)
    cache = os.path.join(PEERS_DIR, f"_lv_{sym}.json")
    if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < 30 * 86400:
        return json.load(open(cache, encoding="utf8"))
    s = requests.Session(); s.headers.update({"User-Agent": _UA})
    out = []
    for u in (f"https://www.screener.in/company/{sym}/consolidated/", f"https://www.screener.in/company/{sym}/"):
        try:
            h = _get(s, u, timeout=25).text
        except Exception:
            continue
        found = re.findall(r'<a href="(/market/[^"]+)"[^>]*title="(Broad Sector|Sector|Broad Industry|Industry)"[^>]*>\s*([^<]+)<', h)
        if found:
            out = [(lv, html.unescape(nm.strip()), p) for p, lv, nm in found]
            break
    if out:
        json.dump(out, open(cache, "w", encoding="utf8"))
    return out


def _median_of(rows):
    md = {}
    for k in ("pe", "roce", "dy", "pvar", "svar"):
        vals = [r[k] for r in rows if r.get(k) is not None and (k != "pe" or r[k] > 0)]
        md[k] = round(statistics.median(vals), 2) if len(vals) >= 3 else None
    md["n"] = len(rows)
    return md


def _own_row(sym):
    ind = industry_peers(sym)
    if ind:
        return next((p for p in ind["peers"] if p["sym"] == sym), None)
    return None


def smart_peers(sym):
    """Peers that a sensible analyst would accept.

    1. A hand-picked list for the few conglomerates no classification handles.
    2. Screener's own industry when it is a fair comparison.
    3. Otherwise climb one classification level at a time and keep companies
       within a tenth to ten times the stock's size."""
    base = industry_peers(sym) or {}
    others = [p for p in base.get("peers", []) if p["sym"] != sym]
    me = next((p for p in base.get("peers", []) if p["sym"] == sym), None)
    my_cap = (me or {}).get("mcap") or (STATE["master"].get(sym) or {}).get("mcap")
    try:
        ov = json.load(open(OVERRIDES, encoding="utf8")).get(sym)
    except Exception:
        ov = None
    if ov:
        rows = [r for r in (_own_row(p) for p in ov["peers"]) if r]
        if len(rows) >= 3:
            return {"peers": rows, "median": _median_of(rows), "scope": ov.get("label", "peers chosen by our desk"),
                    "path": base.get("path"), "how": "override", "note": ov.get("note"), "compare": ov.get("compare", True)}
    caps = [p["mcap"] for p in others if p.get("mcap")]
    med_cap = statistics.median(caps) if caps else None
    thin = len(others) < 5 or (my_cap and med_cap and my_cap > 5 * med_cap)
    if not thin and base.get("median"):
        return {"peers": others, "median": base["median"], "scope": base.get("industry") or "its industry",
                "path": base.get("path"), "how": "industry"}
    if my_cap:
        lv = {lv: (nm, p) for lv, nm, p in _levels(sym)}
        for level in ("Broad Industry", "Sector"):
            if level not in lv:
                continue
            nm, p = lv[level]
            cand = [r for r in market_rows(p) if r["sym"] != sym and r.get("mcap") and my_cap / 10 <= r["mcap"] <= my_cap * 10]
            if len(cand) >= 4:
                cand = cand[:8]
                return {"peers": cand, "median": _median_of(cand), "scope": f"{nm}, similar size", "path": base.get("path"),
                        "how": "climbed", "note": f"{base.get('industry') or 'Its own industry'} has too few comparable companies, so peers come from the wider {nm} group, limited to companies of similar size."}
    if others:
        return {"peers": others, "median": base.get("median"), "scope": base.get("industry") or "its industry", "path": base.get("path"), "how": "industry"}
    return None
