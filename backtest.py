"""Strategy builder backtests on index options (Nifty, Bank Nifty, Sensex), end of day, 2019 onwards.

The user builds the strategy; we only report how it would have done. Every result is SIMULATED.

A strategy:
  sym        NIFTY | BANKNIFTY | SENSEX
  expiry     "weekly" (every expiry) or "monthly" (last expiry of each month)
  entry_dte  enter on the last trading day that is at least this many calendar days before expiry, at the close
  exit_dte   0 = hold to expiry (settle at intrinsic value on the final index price); else exit at the close of the
             last trading day at least this many days before expiry
  legs       [{"side": "buy"|"sell", "type": "CE"|"PE", "strike_pct": % from the futures price (+ above), "lots": n}]
  stop_x     optional: exit at the close once the loss reaches stop_x times the premium at entry
  target_x   optional: exit at the close once the profit reaches target_x times the premium at entry
  mood       "any" | "calm" (skip weeks when India VIX is in the top third of its past year) | "nervous" (only those)
  start, end optional years

Strikes: the listed strike nearest to futures x (1 + strike_pct/100), preferring strikes that traded that day.
Prices: closing price when the contract traded, else the exchange settle price. Stops and targets are checked on
daily closes only, so real exits could be worse.
Costs per leg and side: brokerage Rs 20 per order, exchange transaction charge, STT (sold premium; exercised long
legs at expiry), stamp duty on buys, GST 18% on brokerage + exchange charge, slippage max(0.5 point, 1% of premium).
Capital: the worst loss at expiry when every short leg is covered; otherwise about 12% of the contract value of the
short side (an approximation of exchange margin).
"""
import json, math, os, threading
from collections import defaultdict
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
PACKS, LOCK = {}, threading.Lock()
MIN_TRADES = 30
MAX_LEGS = 6
PRESETS = {
    "short_strangle": [{"side": "sell", "type": "CE", "strike_pct": 1.5}, {"side": "sell", "type": "PE", "strike_pct": -1.5}],
    "short_straddle": [{"side": "sell", "type": "CE", "strike_pct": 0}, {"side": "sell", "type": "PE", "strike_pct": 0}],
    "long_straddle": [{"side": "buy", "type": "CE", "strike_pct": 0}, {"side": "buy", "type": "PE", "strike_pct": 0}],
    "iron_condor": [{"side": "sell", "type": "CE", "strike_pct": 1.5}, {"side": "buy", "type": "CE", "strike_pct": 3},
                    {"side": "sell", "type": "PE", "strike_pct": -1.5}, {"side": "buy", "type": "PE", "strike_pct": -3}],
    "bull_put_spread": [{"side": "sell", "type": "PE", "strike_pct": -1}, {"side": "buy", "type": "PE", "strike_pct": -3}],
    "bear_call_spread": [{"side": "sell", "type": "CE", "strike_pct": 1}, {"side": "buy", "type": "CE", "strike_pct": 3}],
    "bull_call_spread": [{"side": "buy", "type": "CE", "strike_pct": 0}, {"side": "sell", "type": "CE", "strike_pct": 2}],
    "bear_put_spread": [{"side": "buy", "type": "PE", "strike_pct": 0}, {"side": "sell", "type": "PE", "strike_pct": -2}],
}


# ---------------------------------------------------------------- data
def pack(sym):
    with LOCK:
        if sym in PACKS:
            return PACKS[sym]
        z = np.load(os.path.join(ROOT, "data", f"optpack_{sym}.npz"))
        P = {k: z[k] for k in z.files}
        o = np.lexsort((P["r_k"], P["r_exp"], P["r_day"]))
        rd, re_ = P["r_day"][o], P["r_exp"][o]
        key = rd.astype(np.int64) * 10000 + re_
        cut = np.flatnonzero(np.diff(key)) + 1
        idx = {}
        for a, b in zip(np.r_[0, cut], np.r_[cut, len(key)]):
            idx[(int(rd[a]), int(re_[a]))] = (a, b)
        P.update(k=P["r_k"][o], ce=P["r_ce"][o], px=P["r_px"][o], n=P["r_n"][o], idx=idx,
                 dts=np.array(P["days"], dtype="datetime64[D]"), edts=np.array(P["exps"], dtype="datetime64[D]"))
        P["mood"] = mood_labels(P["days"])
        PACKS[sym] = P
        return P


def mood_labels(days):
    """India VIX in the bottom / middle / top third of its past 252 sessions, as of each day (no look-ahead)."""
    try:
        book = json.load(open(os.path.join(ROOT, "data", "vix_hist.json"), encoding="utf8"))
    except Exception:
        return {}
    ks = sorted(book); v = np.array([book[k] for k in ks], dtype=float)
    lab = {}
    for i in range(120, len(ks)):
        past = v[max(0, i - 252):i]
        lo, hi = np.quantile(past, [1 / 3, 2 / 3])
        lab[ks[i]] = "nervous" if v[i] > hi else "calm" if v[i] < lo else "normal"
    out, last = {}, None
    for d in days:
        last = lab.get(d, last); out[d] = last
    return out


def quote(P, di, ei, k, ce, traded=None):
    """Price of one option on one day. If `traded` (a list) is given, appends whether it actually traded that day."""
    r = P["idx"].get((di, ei))
    if not r:
        return None
    a, b = r
    ks = P["k"][a:b]; m = (ks == k) & (P["ce"][a:b] == ce)
    j = np.flatnonzero(m)
    if not len(j):
        return None
    if traded is not None:
        traded.append(bool(P["n"][a:b][j[0]] > 0))
    return float(P["px"][a:b][j[0]])


def pick_strike(P, di, ei, target, ce):
    r = P["idx"].get((di, ei))
    if not r:
        return None
    a, b = r
    m = P["ce"][a:b] == ce
    ks, n = P["k"][a:b][m], P["n"][a:b][m]
    if not len(ks):
        return None
    traded = ks[n > 0]
    pool = traded if len(traded) else ks
    return float(pool[np.abs(pool - target).argmin()])


# ---------------------------------------------------------------- charges
def rates(day, sym):
    d = str(day)
    stt_sell = 0.000625 if d < "2024-10-01" else 0.001 if d < "2026-04-01" else 0.0015
    stt_ex = 0.00125 if d < "2026-04-01" else 0.0015
    exch = 0.000495 if d < "2024-10-01" else (0.000325 if sym == "SENSEX" else 0.0003503)
    return stt_sell, stt_ex, exch


def leg_cost(prem, side, day, lot, sym):
    """Cost per unit for one traded side of one leg. side: +1 buy, -1 sell."""
    stt_sell, _, exch = rates(day, sym)
    brok = 20 / lot
    c = brok + exch * prem + 0.18 * (brok + exch * prem)
    c += stt_sell * prem if side < 0 else 0.00003 * prem
    return c + max(0.5, 0.01 * prem)


# ---------------------------------------------------------------- the backtest
def clean(spec):
    sym = str(spec.get("sym", "NIFTY")).upper()
    if sym not in ("NIFTY", "BANKNIFTY", "SENSEX"):
        raise ValueError("Pick Nifty, Bank Nifty or Sensex.")
    legs = spec.get("legs") or PRESETS.get(spec.get("preset", ""), [])
    if not legs or len(legs) > MAX_LEGS:
        raise ValueError(f"Add between 1 and {MAX_LEGS} legs.")
    L = []
    for g in legs:
        side = 1 if str(g.get("side")).lower() == "buy" else -1
        typ = str(g.get("type", "CE")).upper()
        if typ not in ("CE", "PE"):
            raise ValueError("Each leg is a call (CE) or a put (PE).")
        pct = float(g.get("strike_pct", 0))
        if abs(pct) > 15:
            raise ValueError("Keep strikes within 15% of the price.")
        L.append({"side": side, "ce": typ == "CE", "type": typ, "pct": pct, "lots": max(1, min(10, int(g.get("lots", 1))))})
    entry = int(spec.get("entry_dte", 3)); exit_ = int(spec.get("exit_dte", 0))
    if not (0 <= exit_ < entry <= 45):
        raise ValueError("Enter between 1 and 45 days before expiry, and exit after you enter.")
    num = lambda k: float(spec[k]) if spec.get(k) not in (None, "", 0, "0") else None
    return {"sym": sym, "legs": L, "entry": entry, "exit": exit_, "monthly": spec.get("expiry") == "monthly",
            "stop": num("stop_x"), "target": num("target_x"), "mood": spec.get("mood", "any"),
            "start": str(spec.get("start") or "2019"), "end": str(spec.get("end") or "2099")}


def day_on_or_before(P, e, dte):
    """Index of the last trading day at least `dte` calendar days before expiry e (a datetime64[D])."""
    j = np.searchsorted(P["dts"], e - np.timedelta64(dte, "D"), side="right") - 1
    return int(j) if j >= 0 else None


# ---------------------------------------------------------------- exchange margin (SPAN), as a broker would block it
SPAN = {"book": None}
_N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
MOVES = [0, 0, 1 / 3, 1 / 3, -1 / 3, -1 / 3, 2 / 3, 2 / 3, -2 / 3, -2 / 3, 1, 1, -1, -1, 2, -2]   # SPAN's 16 scenarios, in its order
VOLS = [1, -1] * 7 + [0, 0]


def _b76(F, K, T, s, ce):
    if T <= 0 or s <= 0:
        return max(F - K, 0.0) if ce else max(K - F, 0.0)
    v = s * math.sqrt(T); d1 = (math.log(F / K) + v * v / 2) / v; d2 = d1 - v
    return F * _N(d1) - K * _N(d2) if ce else K * _N(-d2) - F * _N(-d1)


def _iv(p, F, K, T, ce):
    lo, hi = 0.005, 3.0
    if p <= max(F - K if ce else K - F, 0) + 0.01:
        return 0.05
    for _ in range(60):
        m = (lo + hi) / 2
        if _b76(F, K, T, m, ce) > p: hi = m
        else: lo = m
    return m


def span_params(day, sym):
    """NSE's price scan range (% of the futures price) and volatility scan in force that month (tools/span_params.py).
    Sensex (cleared on BSE) uses Nifty's settings, which track it closely."""
    if SPAN["book"] is None:
        try:
            SPAN["book"] = json.load(open(os.path.join(ROOT, "data", "span_params.json"), encoding="utf8"))
        except Exception:
            SPAN["book"] = {}
    b = SPAN["book"]
    if not b:
        return None
    keys = [k for k in sorted(b) if k <= str(day)] or [min(b)]
    x = b[keys[-1]].get("NIFTY" if sym == "SENSEX" else sym) or b[keys[-1]].get("NIFTY")
    return (x["scan_pct"] / 100, x["vscan"]) if x else None


def span_margin(L, strikes, prem, F, lot, T, day, sym):
    """Margin a broker would block at entry: SPAN (the position re-priced under the exchange's 16 scenarios, the worst loss
    counted, so spreads get their offset) plus exposure margin (2% of the contract value of each short leg).
    Checked against NSE's own risk numbers for 19 Nov 2026: within 0 to 2.5%, slightly on the cautious side.
    None when the exchange settings are not available."""
    sp = span_params(day, sym)
    if not sp:
        return None
    scan, vscan = sp[0] * F, sp[1]
    ivs = [_iv(p, F, k, T, l["ce"]) for l, k, p in zip(L, strikes, prem)]
    worst = 0.0
    for m, vv, i in zip(MOVES, VOLS, range(16)):
        w = 0.35 if i >= 14 else 1.0
        loss = sum(l["side"] * l["lots"] * (p - _b76(F + m * scan, k, T, max(s + vv * vscan, 0.005), l["ce"])) * w
                   for l, k, p, s in zip(L, strikes, prem, ivs))
        worst = max(worst, loss)
    exposure = 0.02 * F * sum(l["lots"] for l in L if l["side"] < 0)
    return (worst + exposure) * lot


def capital_for(L, strikes, F, lot):
    shorts = sum(l["lots"] for l in L if l["side"] < 0)
    covered = {True: 0, False: 0}
    for l in L:
        covered[l["ce"]] += l["side"] * l["lots"]
    grid = np.linspace(F * 0.6, F * 1.4, 801)
    pay = np.zeros_like(grid)
    for l, k in zip(L, strikes):
        intr = np.maximum(grid - k, 0) if l["ce"] else np.maximum(k - grid, 0)
        pay += l["side"] * l["lots"] * intr
    unlimited = covered[True] < 0 or covered[False] < 0
    return (0.12 * F * lot * max(shorts, 1)) if unlimited else None, pay * lot


def run(spec):
    S = clean(spec)
    P = pack(S["sym"])
    L, out, skipped = S["legs"], [], 0
    for ei, e in enumerate(P["edts"]):
        if S["monthly"] and not P["monthly"][ei]:
            continue
        es = str(e)
        if es < S["start"] or es[:4] > S["end"] or not np.isfinite(P["final"][ei]):
            continue
        t0 = day_on_or_before(P, e, S["entry"])
        if t0 is None or (e - P["dts"][t0]).astype(int) > 45 or (e - P["dts"][t0]).astype(int) < S["entry"]:
            continue
        mood = P["mood"].get(P["days"][t0])
        if S["mood"] == "calm" and mood == "nervous": continue
        if S["mood"] == "nervous" and mood != "nervous": continue
        F = float(P["fut"][t0]); lot = int(P["lot"][ei])
        ks, p0, tr0 = [], [], []
        for l in L:
            k = pick_strike(P, t0, ei, F * (1 + l["pct"] / 100), l["ce"])
            q = quote(P, t0, ei, k, l["ce"], tr0) if k is not None else None
            if q is None:
                break
            ks.append(k); p0.append(q)
        if len(ks) < len(L) or len(set(zip(ks, [l["ce"] for l in L], [l["side"] for l in L]))) < len(L):
            skipped += 1; continue
        net0 = sum(-l["side"] * l["lots"] * p for l, p in zip(L, p0))          # + credit received, - debit paid
        base = abs(net0) or 1.0
        t_end = ei_day = None
        if S["exit"] > 0:
            t_end = day_on_or_before(P, e, S["exit"])
        else:
            ei_day = int(np.searchsorted(P["dts"], e))
            t_end = ei_day if ei_day < len(P["dts"]) and P["dts"][ei_day] == e else None
        if t_end is None or t_end <= t0:
            skipped += 1; continue
        why, t_exit, p1 = "expiry" if S["exit"] == 0 else "planned exit", t_end, None
        last = list(p0)
        for t in range(t0 + 1, t_end + (0 if S["exit"] == 0 else 1)):
            cur = [quote(P, t, ei, k, l["ce"]) for l, k in zip(L, ks)]
            last = [c if c is not None else o for c, o in zip(cur, last)]
            mtm = sum(l["side"] * l["lots"] * (c - o) for l, c, o in zip(L, last, p0))
            if S["stop"] and mtm <= -S["stop"] * base:
                why, t_exit, p1 = "stop", t, list(last); break
            if S["target"] and mtm >= S["target"] * base:
                why, t_exit, p1 = "target", t, list(last); break
        day0, day1 = P["days"][t0], P["days"][t_exit]
        cost = sum(leg_cost(p, l["side"], day0, lot, S["sym"]) * l["lots"] for l, p in zip(L, p0))
        if p1 is None and S["exit"] == 0:                                      # held to expiry: settle at intrinsic
            Fin = float(P["final"][ei]); _, stt_ex, _ = rates(es, S["sym"])
            p1 = [max(Fin - k, 0) if l["ce"] else max(k - Fin, 0) for l, k in zip(L, ks)]
            cost += sum(stt_ex * x * l["lots"] for l, x in zip(L, p1) if l["side"] > 0 and x > 0)
        else:
            if p1 is None:
                p1 = [quote(P, t_exit, ei, k, l["ce"], tr0) for l, k in zip(L, ks)]
                p1 = [c if c is not None else o for c, o in zip(p1, last)]
            cost += sum(leg_cost(p, -l["side"], day1, lot, S["sym"]) * l["lots"] for l, p in zip(L, p1))
        pts = sum(l["side"] * l["lots"] * (b - a) for l, a, b in zip(L, p0, p1)) - cost
        cap_naked, pay = capital_for(L, ks, F, lot)
        cap = cap_naked if cap_naked else max(1.0, -(pay.min() + net0 * lot))
        if any(l["side"] < 0 for l in L):                  # anything sold: the exchange margin, where its settings are known
            T = max((e - P["dts"][t0]).astype(int), 1) / 365
            m_ = span_margin(L, ks, p0, F, lot, T, day0, S["sym"])
            if m_:
                cap = max(m_, 1.0)
        out.append({"entry": day0, "exit": day1, "expiry": es, "F": round(F, 2), "strikes": ks, "prem": [round(x, 2) for x in p0],
                    "net": round(net0, 2), "lot": lot, "pnl": round(pts * lot, 0), "pts": round(pts, 2), "cap": round(cap, 0),
                    "why": why, "mood": mood, "untraded": not all(tr0),
                    "off": any(abs(k / (F * (1 + l["pct"] / 100)) - 1) > 0.01 for l, k in zip(L, ks))})
    return S, out, skipped


def summary(spec):
    S, tr, skipped = run(spec)
    res = {"trades": len(tr), "skipped": skipped, "simulated": True, "min_trades": MIN_TRADES,
           "naked": any(l["side"] < 0 for l in S["legs"]) and capital_for(S["legs"], [0] * len(S["legs"]), 1, 1)[0] is not None,
           "cap_kind": "span" if any(l["side"] < 0 for l in S["legs"]) and span_params("2099-01-01", S["sym"]) else "naked" if any(l["side"] < 0 for l in S["legs"]) else "debit"}
    if len(tr) < MIN_TRADES:
        res["too_few"] = True
        return res
    pnl = np.array([t["pnl"] for t in tr]); cap = float(np.median([t["cap"] for t in tr]))
    eq = np.cumsum(pnl); dd = eq - np.maximum.accumulate(np.r_[0, eq])[1:]
    month = defaultdict(float); year = defaultdict(lambda: [0.0, 0, 0]); mood = defaultdict(lambda: [0.0, 0, 0])
    for t in tr:
        month[t["expiry"][:7]] += t["pnl"]
        y = year[t["expiry"][:4]]; y[0] += t["pnl"]; y[1] += 1; y[2] += t["pnl"] > 0
        m = mood[t["mood"] or "unknown"]; m[0] += t["pnl"]; m[1] += 1; m[2] += t["pnl"] > 0
    mv = np.array(list(month.values()))
    half = tr[len(tr) // 2]["expiry"]
    h1 = pnl[: len(tr) // 2].mean(); h2 = pnl[len(tr) // 2:].mean()
    res.update({
        "total": round(float(pnl.sum())), "avg": round(float(pnl.mean())), "win_rate": round(float((pnl > 0).mean()) * 100, 1),
        "avg_win": round(float(pnl[pnl > 0].mean())) if (pnl > 0).any() else 0, "avg_loss": round(float(pnl[pnl <= 0].mean())) if (pnl <= 0).any() else 0,
        "best": round(float(pnl.max())), "worst": round(float(pnl.min())), "max_dd": round(float(dd.min())),
        "median": round(float(np.median(pnl))), "without_best5": round(float(np.sort(pnl)[:-5].sum())),
        "months": len(mv), "months_up": round(float((mv > 0).mean()) * 100, 1), "worst_month": round(float(mv.min())),
        "capital": round(cap), "per_month_pct": round(float(mv.mean()) / cap * 100, 2) if cap else None,
        "halves": {"split": half, "first_avg": round(float(h1)), "second_avg": round(float(h2))},
        "by_year": [{"year": k, "pnl": round(v[0]), "trades": v[1], "win_rate": round(v[2] / v[1] * 100)} for k, v in sorted(year.items())],
        "by_mood": [{"mood": k, "pnl": round(v[0]), "trades": v[1], "avg": round(v[0] / v[1]), "win_rate": round(v[2] / v[1] * 100)} for k, v in mood.items()],
        "curve": [[t["expiry"], round(float(x))] for t, x in zip(tr, eq)],
        "exits": {k: sum(1 for t in tr if t["why"] == k) for k in ("expiry", "planned exit", "stop", "target")},
        "untraded": sum(1 for t in tr if t["untraded"]), "off": sum(1 for t in tr if t["off"]),
        "recent": tr[-12:][::-1], "from": tr[0]["expiry"], "to": tr[-1]["expiry"],
    })
    return res
