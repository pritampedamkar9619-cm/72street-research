"""
Screener.in company page -> structured annual financials, cached to JSON.

Why Screener and not yfinance: yfinance returns 5 annual periods. Screener returns 12
(Mar 2015 -> Mar 2026). A fundamental backtest needs the depth, because each scoring
date consumes 3-4 prior years just to compute growth and trend.

Two P&L layouts exist and the layout itself is the sector signal:
    non-lender  Sales / Operating Profit / OPM %
    lender      Revenue / Financing Profit / Financing Margin %
A lender is detected by the presence of 'Financing Profit'. That one split matters more
than any other, because D/E and EBITDA margin are meaningless for a bank.
"""
import json, os, re, time, random
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
SECTIONS = ("profit-loss", "balance-sheet", "cash-flow", "ratios", "shareholding", "quarters")


def _num(s):
    """Screener cells: '1,234', '-1,234', '12.3%', '', '-'. Returns float or None."""
    if s is None:
        return None
    s = s.replace(",", "").replace("%", "").replace("₹", "").strip()
    if s in ("", "-", "NA", "N/A"):
        return None
    neg = (s.startswith("(") and s.endswith(")")) or s.startswith("-")
    m = re.search(r"\d+(?:\.\d+)?", s)      # tiles append units: "1090480 Cr."
    if not m:
        return None
    v = float(m.group(0))
    return -v if neg else v


def _table(sec):
    """One Screener section table -> (period_labels, {row_label: [values]})."""
    tb = sec.find("table")
    if tb is None:
        return [], {}
    head = [th.get_text(strip=True) for th in tb.find_all("th")]
    periods = head[1:] if head else []
    rows = {}
    for tr in tb.find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        label = tds[0].get_text(" ", strip=True).rstrip(" +")
        vals = [_num(td.get_text(" ", strip=True)) for td in tds[1:]]
        if label:
            rows[label] = vals
    return periods, rows


def _tiles(soup):
    """The header ratio tiles: Market Cap, Current Price, Stock P/E, Book Value, Face Value..."""
    out = {}
    ul = soup.find("ul", id="top-ratios")
    if ul is None:
        return out
    for li in ul.find_all("li"):
        name = li.find("span", class_="name")
        val = li.find("span", class_="nowrap value") or li.find("span", class_="value")
        if not name or not val:
            continue
        out[name.get_text(" ", strip=True)] = _num(val.get_text(" ", strip=True).split("/")[0])
    return out


def parse(html):
    soup = BeautifulSoup(html, "lxml")
    doc = {"tiles": _tiles(soup)}
    for sid in SECTIONS:
        sec = soup.find("section", id=sid)
        if sec is None:
            doc[sid] = {"periods": [], "rows": {}}
            continue
        periods, rows = _table(sec)
        doc[sid] = {"periods": periods, "rows": rows}

    pl = doc["profit-loss"]["rows"]
    doc["is_lender"] = "Financing Profit" in pl
    nm = soup.find("h1")
    doc["name"] = nm.get_text(" ", strip=True) if nm else None
    return doc


def fetch(symbol, session=None, consolidated=True, force=False):
    """Cached fetch. Tries consolidated, falls back to standalone when the
    consolidated page carries no P&L (many single-entity companies)."""
    path = os.path.join(CACHE, f"{symbol}.json")
    if os.path.exists(path) and not force:
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    s = session or requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    urls = [f"https://www.screener.in/company/{symbol}/consolidated/",
            f"https://www.screener.in/company/{symbol}/"]
    if not consolidated:
        urls.reverse()

    doc = None
    for u in urls:
        try:
            r = s.get(u, timeout=30)
        except Exception as e:
            doc = {"error": f"{type(e).__name__}: {e}"}
            continue
        if r.status_code != 200:
            doc = {"error": f"http {r.status_code}"}
            continue
        d = parse(r.text)
        if d["profit-loss"]["rows"]:
            d["source_url"] = u
            d["basis"] = "consolidated" if "consolidated" in u else "standalone"
            doc = d
            break
        doc = {"error": "no profit-loss table"}

    doc["symbol"] = symbol
    doc["fetched"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    return doc


def polite_sleep(lo=1.1, hi=2.0):
    time.sleep(random.uniform(lo, hi))


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for sym in (sys.argv[1:] or ["INFY"]):
        d = fetch(sym, force=True)
        if "error" in d and "profit-loss" not in d:
            print(sym, "ERROR", d["error"]); continue
        pl = d["profit-loss"]
        print(f"{sym}  {d.get('name')}  basis={d.get('basis')}  lender={d['is_lender']}")
        print(f"  periods {pl['periods'][0]} .. {pl['periods'][-1]}  ({len(pl['periods'])})")
        for k in ("Sales", "Revenue", "Net Profit", "EPS in Rs"):
            if k in pl["rows"]:
                print(f"  {k:14s} {pl['rows'][k]}")
        print(f"  tiles  {d['tiles']}")
