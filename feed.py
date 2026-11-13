"""My Feed: a curated timeline of what happened to the stocks a visitor follows.

Sources, all official or our own data (no media copying):
  results       out or due, from the results tracker (via the watchlist row)
  company news  announcements filed with NSE, routine paperwork left out (api_filings)
  big money     bulk and block deals from NSE's daily large-deal file, kept day by day in data/deals/
  moves, holders, levels   the stock page's own "what changed" lines

Curation: every item gets an importance (3 = worth knowing today, 2 = useful, 1 = routine). Routine items are hidden
unless asked for; at most two items per stock per day are shown, the rest fold under "more"; the top five of the last
seven days lead the page. Each item carries one neutral line on what kind of event it is. Nothing here says what to do.
"""
import json, os, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.abspath(__file__))
DEALS = os.path.join(ROOT, "data", "deals")

IMPORTANCE = {
    3: {"Results", "Order win", "Acquisition", "Merger", "Buyback", "Bonus", "Split", "Fund raising", "Big holder change",
        "Pledge", "Credit rating", "Clarifies news", "Legal", "Tax matter", "Bulk deal", "Block deal", "Results due", "Big move"},
    2: {"Leadership change", "Dividend", "Insider trade", "Shares issued", "Press release", "Institutions", "Level"},
}
WHY = {
    "Results": "Quarterly numbers filed with the exchange.",
    "Results due": "The company reports soon; prices often move most on results day.",
    "Order win": "A new order or contract the company announced.",
    "Acquisition": "The company is buying another business or a stake in one.",
    "Merger": "A merger or amalgamation step.",
    "Buyback": "The company is buying back its own shares.",
    "Bonus": "Free shares to existing holders; the price adjusts, the value does not.",
    "Split": "Shares split into smaller units; the price adjusts, the value does not.",
    "Fund raising": "New money raised by issuing shares or bonds.",
    "Big holder change": "A large holder crossed a reporting limit.",
    "Pledge": "Promoter shares pledged or released.",
    "Credit rating": "A rating agency action on the company's debt.",
    "Clarifies news": "The company responded to a media report or rumour.",
    "Legal": "A legal or regulatory matter the company disclosed.",
    "Tax matter": "A tax demand or order the company disclosed.",
    "Leadership change": "A director or senior manager joined or left.",
    "Dividend": "A dividend was declared or its dates set.",
    "Insider trade": "Insiders reported buying or selling.",
    "Shares issued": "New shares were allotted.",
    "Analyst meet": "Management is meeting analysts or investors.",
    "Investor presentation": "The company published an investor presentation.",
    "Press release": "The company issued a press release.",
    "Bulk deal": "One buyer or seller traded more than 0.5% of the company's shares in a day.",
    "Block deal": "A large trade done in the exchange's block window.",
    "Big move": "The stock moved much more than usual.",
    "Institutions": "Change in what institutions held last quarter.",
    "Level": "Price crossed a level traders watch.",
}


STATE = {"Level", "Institutions", "Big move"}           # true right now, not a dated event: shown in "Right now", not the timeline
GENERIC = ("general updates", "updates", "con. call updates", "analysts/institutional investor meet/con. call updates",
           "bagging/receiving of orders/contracts", "change in management", "press release")


def importance(kind):
    return 3 if kind in IMPORTANCE[3] else 2 if kind in IMPORTANCE[2] else 1


# ---------------------------------------------------------------- bulk and block deals, kept day by day
def save_deals(nse):
    """Pull NSE's latest large-deal snapshot and keep it as data/deals/YYYY-MM-DD.json (the snapshot only covers one day)."""
    try:
        r = nse.get("/api/snapshot-capital-market-largedeal", {}, ttl=1800) or {}
    except Exception:
        return 0
    day = r.get("as_on_date")
    if not day:
        return 0
    iso = datetime.strptime(day, "%d-%b-%Y").strftime("%Y-%m-%d")
    rows = []
    for key, kind in (("BULK_DEALS_DATA", "Bulk deal"), ("BLOCK_DEALS_DATA", "Block deal")):
        for x in r.get(key) or []:
            try:
                q, p = float(str(x.get("qty")).replace(",", "")), float(str(x.get("watp")).replace(",", ""))
            except Exception:
                continue
            rows.append({"sym": x.get("symbol"), "kind": kind, "side": x.get("buySell"), "who": (x.get("clientName") or "").title(),
                         "qty": q, "px": p, "cr": round(q * p / 1e7, 2), "date": iso})
    os.makedirs(DEALS, exist_ok=True)
    json.dump(rows, open(os.path.join(DEALS, iso + ".json"), "w", encoding="utf8"))
    return len(rows)


def recent_deals(days=10):
    out = []
    if not os.path.isdir(DEALS):
        return out
    cut = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    for f in sorted(os.listdir(DEALS)):
        if f[:10] >= cut:
            try:
                out += json.load(open(os.path.join(DEALS, f), encoding="utf8"))
            except Exception:
                pass
    return out


# ---------------------------------------------------------------- the feed
def _when(iso, hm="15:30"):
    try:
        return datetime.strptime(f"{iso} {hm}", "%Y-%m-%d %H:%M").timestamp()
    except Exception:
        return time.time()


def items_for(sym, row, filings, deals, today):
    out = []
    name = row.get("name") or sym
    # results: out (with its numbers from the watchlist line) or coming up
    for c in row.get("changes") or []:
        t = c.get("text", "")
        low = t.lower()
        if "results out" in low or "results on" in low or "reports" in low:
            kind = "Results" if "out" in low else "Results due"
        elif "institutions" in low:
            kind = "Institutions"
        elif low.startswith(("up ", "down ")):
            kind = "Big move"
        elif "desk call" in low:
            continue                                         # calls have their own place on the stock page
        else:
            kind = "Level"
        ts = time.time() if kind != "Results" else None
        if kind == "Results" and row.get("filed"):
            try:
                ts = datetime.strptime(f"{row['filed']} {datetime.now().year}", "%d %b %Y").timestamp() + 15.5 * 3600
                if ts > time.time() + 86400:
                    ts -= 365 * 86400
            except Exception:
                ts = time.time()
        out.append({"sym": sym, "name": name, "kind": kind, "text": t, "tone": c.get("tone", ""), "t": ts or time.time(), "src": "72 Street"})
    # official announcements
    for f in (filings or {}).get("rows", []):
        try:
            ts = datetime.strptime(f"{f['iso']} {f['when'][-5:]}", "%Y-%m-%d %H:%M").timestamp()
        except Exception:
            ts = _when(f.get("iso", today))
        if f["kind"] == "Results" and any(x["kind"] == "Results" for x in out):
            continue                                         # the results line above already says it, with numbers
        text = f["text"]
        if text.strip().lower().rstrip(".") in GENERIC:          # the exchange's category label says nothing: say what kind of filing it is
            text = f"{f['kind']} filed with NSE." + (" Details are in the filing." if f.get("url") else "")
        out.append({"sym": sym, "name": name, "kind": f["kind"], "text": text, "tone": "", "t": ts, "src": "NSE filing", "url": f.get("url")})
    # big money
    for d in deals:
        if d.get("sym") != sym:
            continue
        side = "bought" if str(d.get("side")).upper().startswith("B") else "sold"
        out.append({"sym": sym, "name": name, "kind": d["kind"], "tone": "up" if side == "bought" else "dn", "t": _when(d["date"], "16:00"), "src": "NSE deals",
                    "text": f"{d['who']} {side} {d['qty']:,.0f} shares at ₹{d['px']:,.2f} (about ₹{d['cr']:,.1f} cr)"})
    for x in out:
        x["imp"] = importance(x["kind"])
        x["why"] = WHY.get(x["kind"], "")
    return out


def build(syms, watch_row, api_filings, since=None, everything=False):
    """syms: the visitor's list. watch_row / api_filings: the server's own functions. since: epoch of the last visit."""
    syms = [s for s in syms if s][:30]
    today = datetime.now().strftime("%Y-%m-%d")
    deals = recent_deals()
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(watch_row, syms))
        fil = list(ex.map(lambda s: api_filings({"sym": [s]}), syms))
    items, upcoming = [], []
    for s, r, f in zip(syms, rows, fil):
        if r.get("error"):
            continue
        items += items_for(s, r, f, deals, today)
        if r.get("rstate") == "due" and r.get("res_date"):
            upcoming.append({"sym": s, "name": r.get("name") or s, "date": r["res_date"],
                             "text": next((c["text"] for c in r.get("changes") or [] if "results on" in c.get("text", "").lower()), "")})
    week = time.time() - 7 * 86400
    now = [x for x in items if x["kind"] in STATE]
    items = [x for x in items if x["kind"] not in STATE and x["t"] >= time.time() - 45 * 86400]
    for x in items:
        x["new"] = bool(since) and x["t"] > since
    shown = items if everything else [x for x in items if x["imp"] >= 2]
    top = sorted([x for x in shown if x["imp"] == 3 and x["t"] >= week], key=lambda x: (-x["t"]))[:5]
    top_ids = {id(x) for x in top}
    # timeline: newest first, at most two per stock per day up front
    shown.sort(key=lambda x: (-x["t"], -x["imp"]))
    per, timeline = {}, []
    for x in shown:
        if id(x) in top_ids:
            continue
        k = (x["sym"], datetime.fromtimestamp(x["t"]).strftime("%Y-%m-%d"))
        per[k] = per.get(k, 0) + 1
        x["fold"] = per[k] > 2
        timeline.append(x)
    hidden = len(items) - len(shown)
    def dkey(u):
        try:
            return datetime.strptime(f"{u['date']} {datetime.now().year}", "%d %b %Y")
        except Exception:
            return datetime.max
    return {"top": top, "timeline": timeline[:150], "upcoming": sorted(upcoming, key=dkey),
            "now": sorted(now, key=lambda x: (-x["imp"], x["sym"])),
            "new": sum(1 for x in shown if x.get("new")), "hidden_routine": hidden, "stocks": len(syms),
            "deals_days": len(os.listdir(DEALS)) if os.path.isdir(DEALS) else 0}
