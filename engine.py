"""Calculations. Takes raw data from data_nse and turns it into what each tab shows.
Nothing in here fetches anything."""
import math
from datetime import datetime

LB, SB, SC, LU = "long_buildup", "short_buildup", "short_covering", "long_unwinding"
LABEL = {LB: "Long buildup", SB: "Short buildup", SC: "Short covering", LU: "Long unwinding", None: "No change"}


def buildup(price_chg, oi_chg):
    if not oi_chg:
        return None
    if oi_chg > 0:
        return LB if price_chg >= 0 else SB
    return SC if price_chg >= 0 else LU


def fnum(x, d=0):
    try:
        return round(float(x), d) if d else int(round(float(x)))
    except (TypeError, ValueError):
        return 0


def days_to(expiry):
    try:
        e = datetime.strptime(expiry, "%d-%b-%Y").replace(hour=15, minute=30)
    except ValueError:
        return 1.0
    return max((e - datetime.now()).total_seconds() / 86400, 0.25)


# ---------------------------------------------------------------- option chain
def chain_rows(raw):
    rec = raw.get("records", {})
    spot = float(rec.get("underlyingValue") or 0)
    rows = []
    for r in rec.get("data", []):
        k = float(r.get("strikePrice") or (r.get("CE") or r.get("PE") or {}).get("strikePrice") or 0)
        row = {"k": k}
        for side in ("CE", "PE"):
            o = r.get(side) or {}
            row[side] = {"oi": fnum(o.get("openInterest")), "chg": fnum(o.get("changeinOpenInterest")),
                         "ltp": fnum(o.get("lastPrice"), 2), "pchg": fnum(o.get("change"), 2),
                         "vol": fnum(o.get("totalTradedVolume")), "iv": fnum(o.get("impliedVolatility"), 2)}
            row[side]["b"] = buildup(row[side]["pchg"], row[side]["chg"])
        rows.append(row)
    rows.sort(key=lambda x: x["k"])
    return spot, rec.get("timestamp", ""), rows


def max_pain(rows):
    best, best_k = None, None
    for cand in rows:
        p = cand["k"]
        loss = sum(r["CE"]["oi"] * max(0, p - r["k"]) + r["PE"]["oi"] * max(0, r["k"] - p) for r in rows)
        if best is None or loss < best:
            best, best_k = loss, p
    return best_k


def near(rows, spot, n):
    if not rows:
        return []
    idx = min(range(len(rows)), key=lambda i: abs(rows[i]["k"] - spot))
    return rows[max(0, idx - n): idx + n + 1]


def option_summary(raw, expiry, prev=None, minutes=None):
    """prev: the previous snapshot's rows (for speed). minutes: gap between them."""
    spot, ts, rows = chain_rows(raw)
    rows = [r for r in rows if r["CE"]["oi"] or r["PE"]["oi"]]
    if not rows:
        return {"error": "No option data for this expiry"}
    ce_oi = sum(r["CE"]["oi"] for r in rows); pe_oi = sum(r["PE"]["oi"] for r in rows)
    ce_chg = sum(r["CE"]["chg"] for r in rows); pe_chg = sum(r["PE"]["chg"] for r in rows)
    atm = min(rows, key=lambda r: abs(r["k"] - spot))
    straddle = atm["CE"]["ltp"] + atm["PE"]["ltp"]
    atm_iv = round(((atm["CE"]["iv"] or atm["PE"]["iv"]) + (atm["PE"]["iv"] or atm["CE"]["iv"])) / 2, 2)
    dte = days_to(expiry)
    iv_move = spot * atm_iv / 100 * math.sqrt(dte / 365) if atm_iv else 0

    band = near(rows, spot, 10)
    above = [r for r in band if r["k"] >= spot]; below = [r for r in band if r["k"] <= spot]
    ceiling = max(above or band, key=lambda r: r["CE"]["oi"])["k"]
    floor = max(below or band, key=lambda r: r["PE"]["oi"])["k"]
    call_wall = max(rows, key=lambda r: r["CE"]["oi"])["k"]
    put_wall = max(rows, key=lambda r: r["PE"]["oi"])["k"]
    up_ = [r for r in rows if r["k"] > ceiling and r["CE"]["oi"]]; dn_ = [r for r in rows if r["k"] < floor and r["PE"]["oi"]]
    next_ceiling = max(up_, key=lambda r: r["CE"]["oi"])["k"] if up_ else None
    next_floor = max(dn_, key=lambda r: r["PE"]["oi"])["k"] if dn_ else None

    # speed: OI change per minute, from live snapshots when we have them
    live_speed = prev is not None and minutes
    if live_speed:
        pk = {r["k"]: r for r in prev}
        for r in rows:
            p = pk.get(r["k"])
            for s in ("CE", "PE"):
                d = r[s]["oi"] - (p[s]["oi"] if p else r[s]["oi"])
                r[s]["spd"] = round(d / minutes, 1)
    else:
        session_min = session_minutes()
        for r in rows:
            for s in ("CE", "PE"):
                r[s]["spd"] = round(r[s]["chg"] / session_min, 1)

    # flow momentum, −100 bearish to +100 bullish, weighted to strikes near spot
    bull = bear = 0.0
    for r in near(rows, spot, 8):
        w = 1 / (1 + abs(r["k"] - spot) / max(spot * 0.01, 1))
        c, p = r["CE"], r["PE"]
        amt_c, amt_p = abs(c["chg"]) * w, abs(p["chg"]) * w
        bull += amt_p if p["b"] == SB else 0          # puts written: floor building
        bear += amt_c if c["b"] == SB else 0          # calls written: ceiling building
        bull += amt_c if c["b"] in (SC, LB) else 0    # calls covered or bought
        bear += amt_p if p["b"] in (SC, LB) else 0    # puts covered or bought
        bear += amt_c if c["b"] == LU else 0          # call buyers exiting
        bull += amt_p if p["b"] == LU else 0          # put buyers exiting
    momentum = round((bull - bear) / (bull + bear) * 100) if bull + bear else 0

    hot = []
    for r in near(rows, spot, 12):
        for s in ("CE", "PE"):
            if r[s]["spd"]:
                hot.append({"k": r["k"], "side": s, "spd": r[s]["spd"], "b": LABEL[r[s]["b"]]})
    hot.sort(key=lambda h: -abs(h["spd"]))
    near_speed = sum(abs(r[s]["spd"]) for r in near(rows, spot, 3) for s in ("CE", "PE"))

    up = [r for r in near(rows, spot, 10) if r["k"] >= spot] or near(rows, spot, 10)
    dn = [r for r in near(rows, spot, 10) if r["k"] <= spot] or near(rows, spot, 10)
    fastest_call = max(up, key=lambda r: r["CE"]["chg"] if r["CE"]["b"] == SB else -1e18)
    fastest_put = max(dn, key=lambda r: r["PE"]["chg"] if r["PE"]["b"] == SB else -1e18)
    notes = []
    if fastest_call["CE"]["b"] == SB:
        notes.append(f"Most call writing today is at {fmt_k(fastest_call['k'])} (+{fastest_call['CE']['chg']:,} contracts). Sellers are treating it as a ceiling.")
    if fastest_put["PE"]["b"] == SB:
        notes.append(f"Most put writing today is at {fmt_k(fastest_put['k'])} (+{fastest_put['PE']['chg']:,} contracts). Sellers are treating it as a floor.")
    covering = [r for r in near(rows, spot, 5) if r["CE"]["b"] == SC]
    if covering:
        top = max(covering, key=lambda r: -r["CE"]["chg"])
        notes.append(f"Call writers are covering at {fmt_k(top['k'])} ({top['CE']['chg']:,} contracts). That removes overhead supply.")
    pcov = [r for r in near(rows, spot, 5) if r["PE"]["b"] == SC]
    if pcov:
        top = max(pcov, key=lambda r: -r["PE"]["chg"])
        notes.append(f"Put writers are covering at {fmt_k(top['k'])} ({top['PE']['chg']:,} contracts). The floor under the price is thinning.")
    pcr = round(pe_oi / ce_oi, 2) if ce_oi else 0
    notes.append(f"Put call ratio {pcr}. " + ("Puts outnumber calls, so more writers are betting the price holds up." if pcr > 1.1 else
                                            "Calls outnumber puts, so more writers are betting the price stays capped." if pcr < 0.8 else
                                            "Puts and calls are close to balanced."))

    headline = (f"{fmt_k(spot)} sits between put sellers at {fmt_k(floor)} and call sellers at {fmt_k(ceiling)}. "
                f"Options are pricing a move of about ±{fmt_k(straddle)} by {expiry[:6]}.")
    for r in rows:
        r["CE"]["b"] = r["CE"]["b"] or ""; r["PE"]["b"] = r["PE"]["b"] or ""
    return {"spot": spot, "ts": ts, "expiry": expiry, "dte": round(dte, 1), "rows": rows,
            "pcr": pcr, "pcr_chg": round(pe_chg / ce_chg, 2) if ce_chg > 0 and pe_chg > 0 else None,
            "ce_oi": ce_oi, "pe_oi": pe_oi, "ce_chg": ce_chg, "pe_chg": pe_chg,
            "max_pain": max_pain(rows), "atm": atm["k"], "atm_iv": atm_iv, "straddle": round(straddle, 2),
            "iv_move": round(iv_move, 2), "floor": floor, "ceiling": ceiling,
            "call_wall": call_wall, "put_wall": put_wall, "next_ceiling": next_ceiling, "next_floor": next_floor, "momentum": momentum,
            "near_speed": round(near_speed), "speed_live": bool(live_speed), "hot": hot[:6],
            "notes": notes, "headline": headline,
            "iv_smile": [{"k": r["k"], "ce": r["CE"]["iv"], "pe": r["PE"]["iv"]} for r in near(rows, spot, 12)]}


def fmt_k(x):
    x = float(x)
    return f"{x:,.0f}" if x >= 100 or x == int(x) else f"{x:,.1f}" if x >= 10 else f"{x:,.2f}"


def session_minutes():
    now = datetime.now()
    start = now.replace(hour=9, minute=15, second=0, microsecond=0)
    end = now.replace(hour=15, minute=30, second=0, microsecond=0)
    if now.weekday() >= 5 or now >= end or now < start:
        return 375
    return max((now - start).total_seconds() / 60, 1)


# ---------------------------------------------------------------- technicals
def ema(vals, n):
    if not vals:
        return []
    k = 2 / (n + 1); out = [vals[0]]
    for v in vals[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes, n=14):
    if len(closes) <= n:
        return 50.0
    gains = [max(0, closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    losses = [max(0, closes[i - 1] - closes[i]) for i in range(1, len(closes))]
    ag = sum(gains[:n]) / n; al = sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):
        ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n
    return 100.0 if al == 0 else round(100 - 100 / (1 + ag / al), 1)


def atr(c, n=14):
    tr = [max(c[i]["h"] - c[i]["l"], abs(c[i]["h"] - c[i - 1]["c"]), abs(c[i]["l"] - c[i - 1]["c"])) for i in range(1, len(c))]
    return sum(tr[-n:]) / min(n, len(tr)) if tr else 0


def realised_vol(closes, n=20):
    r = [math.log(closes[i] / closes[i - 1]) for i in range(max(1, len(closes) - n), len(closes)) if closes[i - 1] > 0]
    if len(r) < 5:
        return 0
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252) * 100


def clamp(x, lo=-10, hi=10):
    return max(lo, min(hi, x))


def radar(candles, opt=None):
    """Eight readings, each −10 (weak) to +10 (strong). A description of the
    setup right now. Not a forecast: we have not measured that it predicts."""
    c = [x["c"] for x in candles]
    if len(c) < 60:
        return {"error": "Not enough price history"}
    last = c[-1]
    e20, e50, e200 = ema(c, 20)[-1], ema(c, 50)[-1], ema(c, 200)[-1] if len(c) >= 200 else ema(c, len(c))[-1]
    trend = clamp(((last > e20) + (last > e50) + (last > e200) + (e20 > e50) + (e50 > e200)) * 4 - 10)
    r = rsi(c)
    f_rsi = clamp((r - 50) / 2.5)
    win = candles[-20:]
    vwap = sum(x["c"] * x["v"] for x in win) / max(sum(x["v"] for x in win), 1)
    f_vwap = clamp((last / vwap - 1) * 100 * 2) if vwap else 0     # no trades in 20 days
    vol_now = sum(x["v"] for x in candles[-5:]) / 5; vol_avg = sum(x["v"] for x in candles[-50:]) / 50
    up_day = c[-1] >= c[-6]
    f_vol = clamp((vol_now / max(vol_avg, 1) - 1) * 10 * (1 if up_day else -1))
    a = atr(candles); atr_pct = a / last * 100
    atrs = [atr(candles[: i + 1]) / candles[i]["c"] * 100 for i in range(len(candles) - 120, len(candles)) if i > 15]
    pct_rank = sum(1 for x in atrs if x < atr_pct) / max(len(atrs), 1)
    f_calm = clamp((0.5 - pct_rank) * 20)
    hi20, lo20 = max(x["h"] for x in win), min(x["l"] for x in win)
    pos = (last - lo20) / (hi20 - lo20) if hi20 > lo20 else 0.5
    f_sr = clamp((pos - 0.5) * 20)
    pa = clamp(sum(1 if c[i] > c[i - 1] else -1 for i in range(len(c) - 10, len(c))) * 1.0)
    f = {"Trend": trend, "RSI": f_rsi, "VWAP": f_vwap, "Volume": f_vol, "ATR calm": f_calm,
         "Range position": f_sr, "Price action": pa}
    if opt and not opt.get("error"):
        f["Options OI"] = clamp((opt["pcr"] - 1) * 12 + opt["momentum"] / 20)
    directional = [v for k, v in f.items() if k != "ATR calm"]
    score = round(sum(directional) / len(directional), 1)
    label = "Strong" if score >= 5 else "Positive" if score >= 2 else "Weak" if score <= -5 else "Negative" if score <= -2 else "Neutral"
    rv = realised_vol(c)
    out = {"factors": {k: round(v, 1) for k, v in f.items()}, "score": score, "label": label,
           "last": round(last, 2), "rsi": r, "atr": round(a, 2), "atr_pct": round(atr_pct, 2),
           "ema20": round(e20, 2), "ema50": round(e50, 2), "ema200": round(e200, 2),
           "vwap20": round(vwap, 2), "hi20": round(hi20, 2), "lo20": round(lo20, 2), "rv20": round(rv, 1)}
    if opt and not opt.get("error"):
        mv = opt["iv_move"] or opt["straddle"]
        out["range"] = {"lo": round(last - mv, 2), "hi": round(last + mv, 2), "by": opt["expiry"], "iv": opt["atm_iv"]}
        out["iv_vs_rv"] = round(opt["atm_iv"] - rv, 1)
    else:
        mv = last * rv / 100 * math.sqrt(5 / 252)
        out["range"] = {"lo": round(last - mv, 2), "hi": round(last + mv, 2), "by": "one week", "iv": None}
    strongest = max(f.items(), key=lambda kv: abs(kv[1]))
    out["summary"] = (f"{label} ({score:+.1f} on a −10 to +10 scale). The strongest reading is {strongest[0].lower()} "
                      f"at {strongest[1]:+.1f}. RSI {r:.0f}, price {'above' if last > e50 else 'below'} its 50 day average.")
    return out
