"""'What this means' reads for every tab.

Each function takes the payload a tab already gets and returns a short list of
reads: {"tone": "up" | "dn" | "neutral" | "warn", "title": ..., "text": ...}.

House rules for the wording, because this sits on a SEBI RA's public page:
describe what the data shows and what it usually means. Never say what to do.
No "buy", "sell", "target", "should". Plain sentences, no dashes between clauses."""

DEFENSIVE = {"FMCG", "Pharma", "Healthcare", "IT", "Consumption", "MNC"}
CYCLICAL = {"Metal", "Realty", "Auto", "PSU Bank", "Energy", "Capital Markets", "Defence", "Commodities",
            "Infra", "Oil & Gas", "CPSE", "PSE", "Manufacturing", "Consumer Durables", "Chemicals"}


def r(tone, title, text):
    return {"tone": tone, "title": title, "text": text}


def pct(x, d=2):
    return f"{x:+.{d}f}%"


def _idx(main, name):
    return next((m for m in main if m["name"] == name), None)


# ---------------------------------------------------------------- pulse
def pulse(d):
    out = []
    main = d["main"]; nifty = _idx(main, "NIFTY 50"); small = _idx(main, "NIFTY SMALLCAP 100")
    mid = _idx(main, "NIFTY MIDCAP 100"); vix = _idx(main, "INDIA VIX")
    b = d["breadth"]; tot = (b["adv"] + b["dec"]) or 1; dec_share = b["dec"] / tot
    if nifty:
        n = float(nifty["chg"])
        if dec_share >= 0.7 and n > -1:
            out.append(r("dn", "The index is hiding the damage",
                         f"Nifty moved only {pct(n)}, yet {round(dec_share * 10)} in 10 Nifty 500 stocks fell. "
                         "The selling was much broader than the headline number shows. A few large stocks held the index up."))
        elif dec_share <= 0.3 and n < 1:
            out.append(r("up", "More strength under the surface",
                         f"Nifty moved {pct(n)}, but {round((1 - dec_share) * 10)} in 10 Nifty 500 stocks rose. "
                         "Buying was broader than the index shows."))
        elif dec_share >= 0.6:
            out.append(r("dn", "A broad down day", f"Nifty {pct(n)} and {b['dec']:,} of {tot:,} Nifty 500 stocks fell. The move had wide participation."))
        elif dec_share <= 0.4:
            out.append(r("up", "A broad up day", f"Nifty {pct(n)} and {b['adv']:,} of {tot:,} Nifty 500 stocks rose. The move had wide participation."))
        else:
            out.append(r("neutral", "A split market", f"Rising and falling stocks were close to even ({b['adv']:,} against {b['dec']:,}). No side had control."))
    if nifty and small:
        n, s = float(nifty["chg"]), float(small["chg"])
        if s < 0 and s < n * 2 and s < n - 0.5:
            out.append(r("dn", "Risk is coming off",
                         f"Smallcaps fell {abs(s):.2f}% against Nifty's {pct(n)}. When smaller stocks fall much faster than large ones, "
                         "investors are usually cutting risk rather than switching between sectors."))
        elif s > 0 and s > n + 0.5:
            out.append(r("up", "Appetite for risk",
                         f"Smallcaps rose {abs(s):.2f}% against Nifty's {pct(n)}. Money reaching for smaller stocks usually means confidence is improving."))
    if vix and nifty:
        v, n = float(vix["chg"]), float(nifty["chg"])
        if v > 4 and n < 0:
            out.append(r("warn", "Fear is rising with the fall",
                         f"VIX jumped {pct(v)} to {vix['last']:.2f}. Traders are paying more for protection, which usually means they expect bigger swings ahead."))
        elif v > 4 and n > 0:
            out.append(r("warn", "The rise is not trusted",
                         f"Nifty rose but VIX climbed {pct(v)}. When fear rises on a green day, the move is usually being hedged rather than believed."))
        elif v < -4:
            out.append(r("up", "Fear is easing", f"VIX fell {pct(v)} to {vix['last']:.2f}. Lower demand for protection usually comes with calmer markets."))
    secs = d["sectors"]
    if secs:
        top3 = {s["name"] for s in secs[:5]}; bot3 = {s["name"] for s in secs[-5:]}
        up = sum(1 for s in secs if float(s["chg"]) > 0)
        if len(top3 & DEFENSIVE) >= 2 and len(bot3 & CYCLICAL) >= 3:
            out.append(r("dn", "Defensives held, cyclicals took the hit",
                         f"{', '.join(sorted(top3 & DEFENSIVE))} held up best while {', '.join(sorted(bot3 & CYCLICAL)[:3])} fell most. "
                         "Money hiding in steady businesses is a classic risk-off pattern."))
        elif len(top3 & CYCLICAL) >= 3:
            out.append(r("up", "Cyclicals are leading", f"{', '.join(sorted(top3 & CYCLICAL)[:3])} led. Leadership from economy-sensitive sectors usually comes with risk appetite."))
        out.append(r("neutral", f"{up} of {len(secs)} sectors rose",
                     f"{secs[0]['name']} did best ({pct(float(secs[0]['chg']))}), {secs[-1]['name']} worst ({pct(float(secs[-1]['chg']))})."))
    if b.get("h52") is not None and b.get("l52") is not None and (b["h52"] + b["l52"]) > 20:
        h, l = b["h52"], b["l52"]
        if l > h * 3:
            out.append(r("dn", "More stocks at yearly lows than highs", f"{l} stocks hit a 52 week low against {h} at a high. That is a market where weakness is the trend for most stocks."))
        elif h > l * 3:
            out.append(r("up", "More stocks at yearly highs than lows", f"{h} stocks hit a 52 week high against {l} at a low. Strength is spreading."))
    return out[:5]


# ---------------------------------------------------------------- flow
def flow(d):
    out = []
    hist = d["fiidii"]
    if hist:
        last = hist[-1]; f, di = last.get("fii", 0), last.get("dii", 0)
        rec = hist[-5:]; f5 = sum(h.get("fii", 0) for h in rec); d5 = sum(h.get("dii", 0) for h in rec)
        if f < 0 < di:
            out.append(r("neutral", "Domestic money absorbed foreign selling",
                         f"FIIs sold ₹{abs(f):,.0f} cr and DIIs bought ₹{di:,.0f} cr. Domestic funds, fed by monthly SIPs, have been the steady buyer on days foreign money leaves."))
        elif f > 0 and di > 0:
            out.append(r("up", "Both institutions bought", f"FIIs ₹{f:,.0f} cr and DIIs ₹{di:,.0f} cr, both net buyers. Days when both sides buy are less common and usually supportive."))
        elif f < 0 and di < 0:
            out.append(r("dn", "Both institutions sold", f"FIIs ₹{f:,.0f} cr and DIIs ₹{di:,.0f} cr, both net sellers. Nobody large was absorbing supply."))
        elif f > 0 > di:
            out.append(r("up", "Foreign money came back", f"FIIs bought ₹{f:,.0f} cr while DIIs sold ₹{abs(di):,.0f} cr. Foreign buying tends to move large caps the most."))
        if len(rec) >= 3:
            out.append(r("up" if f5 > 0 else "dn", f"Last {len(rec)} sessions: FII {('+' if f5 >= 0 else '−')}₹{abs(f5):,.0f} cr",
                         f"Over the same days DIIs were {('+' if d5 >= 0 else '−')}₹{abs(d5):,.0f} cr. " + ("Foreign money has been a net seller across the run." if f5 < 0 else "Foreign money has been a net buyer across the run.")))
    c = d.get("fut_counts") or {}
    tot = sum(c.values())
    if tot:
        label = {"long_buildup": "long buildup", "short_buildup": "short buildup", "short_covering": "short covering", "long_unwinding": "long unwinding"}
        top = max(c, key=c.get); share = c[top] / tot
        mean = {"long_buildup": "traders opening fresh long positions", "short_buildup": "traders opening fresh short positions",
                "short_covering": "bears closing positions, which can lift prices without new buyers", "long_unwinding": "bulls closing positions and walking away"}
        tone = {"long_buildup": "up", "short_buildup": "dn", "short_covering": "up", "long_unwinding": "dn"}[top]
        out.append(r(tone, f"Futures: {label[top]} dominates",
                     f"{c[top]} of {tot} stock futures with notable OI change showed {label[top]} ({share:.0%}). That means {mean[top]}. "
                     f"Breakdown: long buildup {c.get('long_buildup', 0)}, short buildup {c.get('short_buildup', 0)}, short covering {c.get('short_covering', 0)}, long unwinding {c.get('long_unwinding', 0)}."))
    secs = d["sectors"]
    if secs:
        up = sum(1 for s in secs if float(s["chg"]) > 0)
        out.append(r("up" if up > len(secs) / 2 else "dn", f"Rotation: {up} of {len(secs)} sectors up",
                     (f"{secs[0]['name']} held up best and {secs[-1]['name']} fell most. With almost nothing green, this was money leaving rather than rotating."
                      if up <= 2 else f"Money moved toward {secs[0]['name']} and away from {secs[-1]['name']}. Gains and losses were spread, which looks like rotation rather than exit.")))
    return out[:5]


# ---------------------------------------------------------------- options / OI / liquidity
def options(d):
    out = []
    spot, fl, ce = d["spot"], d["floor"], d["ceiling"]
    to_f = (spot / fl - 1) * 100 if fl else 0; to_c = (ce / spot - 1) * 100 if ce else 0
    out.append(r("neutral", f"Boxed between {fl:,.0f} and {ce:,.0f}",
                 f"Put writers are most committed at {fl:,.0f} ({to_f:.1f}% below) and call writers at {ce:,.0f} ({to_c:.1f}% above). "
                 + ("Price sits closer to the floor, so the put writers' level is the one in focus." if to_f < to_c * 0.7 else
                    "Price sits closer to the ceiling, so the call writers' level is the one in focus." if to_c < to_f * 0.7 else
                    "Price sits roughly midway, with room on both sides.")))
    lo, hi = spot - d["straddle"], spot + d["straddle"]
    inside = [x for x, nm in ((fl, "floor"), (ce, "ceiling")) if lo <= x <= hi]
    out.append(r("warn" if inside else "neutral", f"Options price ±{d['straddle']:,.0f} by {d['expiry'][:6]}",
                 f"That is a range of {lo:,.0f} to {hi:,.0f}. " + ("Both walls sit inside it, so the market is pricing a real chance of testing either one." if len(inside) == 2 else
                                                                 "One wall sits inside it, so that side is within normal reach." if inside else
                                                                 "Both walls sit outside it, so reaching either would take a bigger than expected move.")))
    pcr = d["pcr"]
    tone = "up" if pcr >= 1.0 else "dn" if pcr < 0.8 else "neutral"
    text = (f"PCR {pcr}. " + ("Far more puts are open than calls. Writers are betting on support holding, though a very high PCR can also mean that side is crowded." if pcr > 1.2 else
                              "More puts are open than calls, so writers lean toward support holding." if pcr >= 1.0 else
                              "Far more calls are open than puts. Writers are betting on the price staying capped." if pcr < 0.7 else
                              "More calls are open than puts, so writers lean toward the price staying capped." if pcr < 0.8 else
                              "Puts and calls are reasonably balanced."))
    pc, cc = d.get("pe_chg") or 0, d.get("ce_chg") or 0
    if pc or cc:
        if cc > 0 and pc >= 0 and cc > pc * 2:
            text += f" Today call writers were far busier: {cc:,} calls added against {pc:,} puts."
            tone = "dn"
        elif pc > 0 and cc >= 0 and pc > cc * 2:
            text += f" Today put writers were far busier: {pc:,} puts added against {cc:,} calls."
            tone = "up"
        else:
            text += f" Today {pc:+,} puts and {cc:+,} calls changed hands in open interest."
    out.append(r(tone, "Who is writing", text))
    mp = d["max_pain"]; g = (mp / spot - 1) * 100
    if abs(g) > 0.3:
        out.append(r("neutral", f"Max pain {mp:,.0f}, {g:+.1f}% from price",
                     "Max pain is where option buyers lose the most. Price sometimes drifts toward it near expiry, but our own record shows it is a weak pull, so treat it as context rather than a magnet."))
    m = d["momentum"]
    if abs(m) >= 40:
        out.append(r("up" if m > 0 else "dn", f"Flow momentum {m:+d}",
                     "Today's position changes near the price lean clearly " + ("toward put writing: puts being written and calls covered." if m > 0 else "toward call writing: calls being written and puts bought or covered.")
                     + " This describes today's positioning, which can reverse quickly."))
    return out[:5]


def oiflow(d):
    out = options(d)
    hot = d.get("hot") or []
    if hot:
        h = hot[0]
        out.insert(1, r("neutral", f"Busiest strike: {h['k']:,.0f} {h['side']}",
                        f"{h['b']} at {abs(h['spd']):,.0f} contracts a minute{' live' if d.get('speed_live') else ' on average through the session'}. "
                        "The fastest changing strikes show where traders are acting right now, not just where positions sit."))
    return out[:5]


# ---------------------------------------------------------------- radar
def radar(d):
    out = []
    f = d.get("factors", {})
    if not f:
        return out
    best = max(f.items(), key=lambda kv: kv[1]); worst = min(f.items(), key=lambda kv: kv[1])
    lead = (f"Strongest reading {best[0].lower()} ({best[1]:+.1f}), weakest {worst[0].lower()} ({worst[1]:+.1f}). " if best[1] > 0 else
            f"No reading is positive. The weakest is {worst[0].lower()} ({worst[1]:+.1f}). " if worst[1] < 0 else "")
    out.append(r("up" if d["score"] > 2 else "dn" if d["score"] < -2 else "neutral", f"Overall: {d['label'].lower()} ({d['score']:+.1f})",
                 lead + "This is a snapshot of the setup today. We have not tested it as a forecast."))
    last, e50, e200 = d["last"], d["ema50"], d["ema200"]
    trend = ("above both its 50 and 200 day averages, the shape of an uptrend" if last > e50 > e200 else
             "below both its 50 and 200 day averages, the shape of a downtrend" if last < e50 < e200 else
             "between its 50 and 200 day averages, so the trend is unsettled")
    out.append(r("up" if last > e50 > e200 else "dn" if last < e50 < e200 else "neutral", "Trend", f"Price {last:,.2f} sits {trend}."))
    rsi = d["rsi"]
    if rsi >= 70 or rsi <= 30:
        out.append(r("warn", f"RSI {rsi:.0f}", "Stretched " + ("up. Strong stocks can stay overbought, but moves this extended often pause." if rsi >= 70 else "down. Weak stocks can stay oversold, but moves this extended often pause.")))
    if d.get("iv_vs_rv") is not None:
        gap = d["iv_vs_rv"]
        out.append(r("warn" if gap > 5 else "neutral", "Options vs reality",
                     f"Option IV is {abs(gap):.1f} points {'above' if gap > 0 else 'below'} the stock's realised volatility. "
                     + ("Options are pricing more movement than the stock has been showing, often ahead of news." if gap > 0 else "Options are pricing less movement than the stock has actually been making.")))
    if d.get("range"):
        rg = d["range"]
        out.append(r("neutral", f"Expected range {rg['lo']:,.0f} to {rg['hi']:,.0f}", f"Roughly a two in three chance of finishing inside it by {rg['by']}, based on {'option pricing' if rg.get('iv') else 'recent movement'}."))
    return out[:5]


# ---------------------------------------------------------------- results
def results(d):
    rows = d.get("rows") or []
    if not rows:
        return []
    out = []
    prem = [x for x in rows if x.get("premium")]
    hot = [x for x in prem if x["premium"] >= 2]
    if prem:
        out.append(r("warn", f"{len(hot)} of {len(prem)} are priced for a big reaction",
                     "Their options price at least twice the stock's normal move. The market expects these results to matter."))
        cheap = sorted(prem, key=lambda x: x["premium"])[:3]
        out.append(r("neutral", "Least excitement priced in",
                     ", ".join(f"{x['sym']} ({x['premium']:.1f}x)" for x in cheap) + ". Options here price close to a normal move, so the market expects little surprise."))
    by_day = {}
    for x in rows:
        by_day.setdefault(x["date"], []).append(x)
    busiest = max(by_day.items(), key=lambda kv: len(kv[1]))
    out.append(r("neutral", f"Busiest day: {busiest[0]}", f"{len(busiest[1])} F&O companies report. Stock-specific swings tend to cluster on days like this."))
    big = max(rows, key=lambda x: x["move_pct"])
    out.append(r("warn", f"Largest priced move: {big['sym']}", f"±{big['move_pct']:.1f}%, a range of {big['lo']:,.0f} to {big['hi']:,.0f} by the {big['expiry'][:6]} expiry."))
    out.append(r("neutral", "How to read the priced move",
                 "It is the price of an at-the-money straddle. Results often move a stock by less than this, because option sellers charge extra for uncertainty."))
    return out[:5]


# ---------------------------------------------------------------- expiry
def expiry(d):
    out = []
    c = [x for x in d.get("cycle") or [] if x.get("pcr") is not None]
    if len(c) < 2:
        return out
    f, l = c[0], c[-1]
    dp = l["pcr"] - f["pcr"]
    out.append(r("up" if dp > 0.1 else "dn" if dp < -0.1 else "neutral", f"PCR {f['pcr']:.2f} → {l['pcr']:.2f} this cycle",
                 ("Put writing grew faster than call writing as the cycle went on, so sellers grew more willing to bet on support." if dp > 0.1 else
                  "Call writing grew faster than put writing as the cycle went on, so sellers grew more willing to bet on a cap." if dp < -0.1 else
                  "The balance of puts and calls barely changed through the cycle.")))
    out.append(r("neutral", f"Max pain moved {f['mp']:,.0f} → {l['mp']:,.0f}",
                 "Max pain follows where positions build up. " + ("It has been falling with the price, so writers have been resetting lower." if l["mp"] < f["mp"] else "It has been rising, so writers have been resetting higher.")))
    gap = (l["mp"] / l["spot"] - 1) * 100
    out.append(r("neutral", f"Price is {abs(gap):.1f}% {'below' if gap > 0 else 'above'} max pain", "With the expiry close, this is the gap people watch. The record below shows how often it actually closed."))
    rec = [x for x in d.get("record", []) if x.get("gap_pct") is not None]
    if rec:
        w = sum(1 for x in rec if abs(x["gap_pct"]) <= 1)
        avg = sum(abs(x["gap_pct"]) for x in rec) / len(rec)
        out.append(r("warn" if w < len(rec) / 2 else "neutral", f"Max pain record: {w} of {len(rec)} within 1%",
                     f"On average price settled {avg:.1f}% away from where max pain stood three sessions earlier. Useful as a reference, unreliable as a prediction."))
    return out[:5]


# ---------------------------------------------------------------- calm
def calm(d):
    pts = d.get("points") or []
    if not pts:
        return []
    out = []
    before = [p for p in pts if p["status"] == "before"]
    rv = sorted(p["rv"] for p in pts); med = rv[len(rv) // 2]
    out.append(r("neutral", f"Typical F&O stock: {med:.0f}% volatility", f"Half of the {len(pts)} F&O stocks move less than this on an annualised basis. The quietest are far below it."))
    out.append(r("warn", f"{len(before)} report before {d.get('expiry', 'expiry')[:6]}",
                 "A calm chart going into results says little about the day itself. Results often end quiet periods abruptly."))
    q = [p for p in pts if p["status"] != "before"][:3]
    out.append(r("neutral", "Quietest without a result in the way", ", ".join(f"{p['sym']} ({p['rv']:.0f}%)" for p in q) + ". Low recent movement and no scheduled results before expiry."))
    out.append(r("neutral", "Calm is backward looking", "These readings describe the last 20 sessions. Volatility tends to cluster, but quiet stocks can wake up on news with no warning."))
    return out


# ---------------------------------------------------------------- global
def global_(d):
    by = {i["t"]: i for i in d["items"]}
    out = []
    us = [by[t]["chg"] for t in ("^GSPC", "^IXIC", "^DJI") if t in by]
    if us:
        a = sum(us) / len(us)
        out.append(r("up" if a > 0.3 else "dn" if a < -0.3 else "neutral", f"US markets {pct(a)} on average",
                     "Overnight US moves usually set the tone for the Indian open, most of all for IT, which earns in dollars."))
    if "CL=F" in by:
        c = by["CL=F"]
        if abs(c["chg"]) > 1.5:
            out.append(r("dn" if c["chg"] > 0 else "up", f"Crude {pct(c['chg'])} to ${c['last']:.0f}",
                         "India imports most of its oil, so a rise in crude usually weighs on oil marketing companies, paints, airlines and the rupee. A fall does the opposite."))
    if "USDINR=X" in by and "DX-Y.NYB" in by:
        u, x = by["USDINR=X"], by["DX-Y.NYB"]
        out.append(r("dn" if u["chg"] > 0.2 else "up" if u["chg"] < -0.2 else "neutral", f"Rupee {u['last']:.2f} per dollar",
                     f"Dollar index {pct(x['chg'])}. " + ("The rupee weakened. A weaker rupee helps exporters like IT and pharma and tends to keep foreign investors cautious." if u["chg"] > 0.2
                     else "The rupee strengthened. A stronger rupee trims what exporters like IT and pharma earn in rupees and tends to suit importers." if u["chg"] < -0.2
                     else "The rupee barely moved.")))
    if "GC=F" in by:
        g = by["GC=F"]
        out.append(r("neutral", f"Gold {pct(g['chg'])}", f"About ₹{g.get('inr', 0) / 1e5:.2f} lakh per 10g before duties. Gold rising with stocks falling is the classic flight to safety."))
    if "BTC-USD" in by:
        b = by["BTC-USD"]
        out.append(r("neutral", f"Bitcoin {pct(b['chg'])}", "Crypto trades around the clock and often moves with global risk appetite, so it can hint at the mood before Asian markets open."))
    return out[:5]


# ---------------------------------------------------------------- screens
def screens(d):
    return []


# ---------------------------------------------------------------- one stock
def _rel(mine, peer, higher_good=True, band=0.15):
    if mine is None or not peer:
        return None
    gap = mine / peer - 1
    if abs(gap) <= band:
        return "in line"
    better = gap > 0 if higher_good else gap < 0
    return "better" if better else "worse"


def stock(d):
    out, glance = [], []
    nm = d.get("profile", {}).get("name") or d["sym"]
    p, t = d.get("price"), d.get("tech")
    if t:
        last, e50, e200 = t["last"], t["ema50"], t["ema200"]
        if last > e50 > e200:
            glance.append({"k": "Trend", "v": "Uptrend", "tone": "up"})
        elif last < e50 < e200:
            glance.append({"k": "Trend", "v": "Downtrend", "tone": "dn"})
        else:
            glance.append({"k": "Trend", "v": "Sideways", "tone": "neutral"})
    if p:
        off = (p["last"] / p["hi52"] - 1) * 100 if p["hi52"] else 0
        tone = "up" if (p.get("r1y") or 0) > 10 else "dn" if (p.get("r1y") or 0) < -10 else "neutral"
        out.append(r(tone, f"{pct(p['r1y'] or 0, 1)} over a year",
                     f"Three months {pct(p['r3m'] or 0, 1)}, one month {pct(p['r1m'] or 0, 1)}. "
                     + ("Trading at its 52 week high." if off > -1 else f"It sits {abs(off):.0f}% below its 52 week high of {p['hi52']:,.0f}.")
                     + (f" {glance[0]['v']} on the daily chart." if glance else "")))
    if d.get("has_fund"):
        mine, peer = d["mine"], d["peer"]; lender = d.get("lender")
        if (d.get("profile") or {}).get("peer_compare") is False:
            glance.append({"k": "Valuation", "v": "No fair peer set", "tone": "neutral"})
        pe_ok, pe_why = _pe_ok(d)
        if mine.get("pe") and peer.get("pe") and not pe_ok:
            glance.append({"k": "Valuation", "v": "P/E not meaningful", "tone": "neutral"})
            out.append(r("neutral", f"P/E {mine['pe']:.1f} is not a fair read right now", f"The {pe_why}. Compare valuation again once profit settles."))
        elif mine.get("pe") and peer.get("pe"):
            g = mine["pe"] / peer["pe"] - 1
            v = "Cheaper than peers" if g < -0.15 else "Richer than peers" if g > 0.15 else "In line with peers"
            glance.append({"k": "Valuation", "v": v, "tone": "up" if g < -0.15 else "dn" if g > 0.15 else "neutral"})
            out.append(r("neutral", f"P/E {mine['pe']:.1f} against a peer median of {peer['pe']:.1f}",
                         f"Compared with the median of {peer.get('n', 0)} companies in {d['profile'].get('peer_scope', 'its industry')}. "
                         + ("The market pays less for each rupee of its earnings than for its peers'. That can mean value, or doubts the market has about the business." if g < -0.15 else
                            "The market pays more for each rupee of its earnings than for its peers'. That usually reflects expected growth or quality, and leaves less room for disappointment." if g > 0.15 else
                            "Valued close to what similar companies trade at.")))
        q_key = "roe" if lender else "roce"
        if mine.get(q_key) is not None and peer.get(q_key):
            rel = _rel(mine[q_key], peer[q_key])
            glance.append({"k": "Business quality", "v": {"better": "Above peers", "worse": "Below peers", "in line": "In line"}[rel],
                           "tone": {"better": "up", "worse": "dn", "in line": "neutral"}[rel]})
            out.append(r({"better": "up", "worse": "dn", "in line": "neutral"}[rel], f"{q_key.upper()} {mine[q_key]:.1f}% against {peer[q_key]:.1f}% for peers",
                         f"Return on {'equity' if lender else 'capital employed'} measures how much profit the business earns on the money in it. "
                         + {"better": "This company earns more than similar companies.", "worse": "This company earns less than similar companies.", "in line": "In line with similar companies."}[rel]))
        sy, py_, lq = d.get("sales_yoy"), d.get("profit_yoy"), d.get("latest_q")
        rs = d.get("rstatus") or {}
        q = rs.get("quarter")
        if rs.get("state") == "out" and py_ is not None:
            when = f"out {rs['filed']}" if rs.get("filed") else "out"
            glance.append({"k": f"{q} results, {when}", "v": f"Profit {pct(py_, 0)} YoY", "tone": "up" if py_ > 5 else "dn" if py_ < -5 else "neutral"})
            qq = d.get("profit_qoq")
            out.append(r("up" if py_ > 5 else "dn" if py_ < -5 else "neutral", f"{q} quarter: sales {pct(sy or 0, 0)}, profit {pct(py_, 0)} on last year",
                         (f"Results came out on {rs['filed']}. " if rs.get("filed") else "") +
                         (f"Against the previous quarter, profit moved {pct(qq, 0)}. " if qq is not None else "") +
                         (f"Over five years sales grew {d['sales_cagr5']:.0f}% a year and profit {d['profit_cagr5']:.0f}% a year." if d.get("sales_cagr5") is not None and d.get("profit_cagr5") is not None else "")))
        elif rs.get("state") == "out" and d.get("latest_profit") is not None:
            lp = d["latest_profit"]
            qs_ = (d.get("quarters") or {}).get("profit") or []
            pp = qs_[-5] if len(qs_) >= 5 else None
            when = f"out {rs['filed']}" if rs.get("filed") else "out"
            if lp < 0:
                v = f"Loss ₹{abs(lp):,.0f} cr"
                tone = "warn" if pp is not None and pp < lp else "dn"
                txt = f"A loss of ₹{abs(lp):,.0f} crore" + (f", against a loss of ₹{abs(pp):,.0f} crore a year earlier, so it narrowed." if pp is not None and pp < lp else
                                                          f", against a loss of ₹{abs(pp):,.0f} crore a year earlier, so it widened." if pp is not None and pp < 0 else
                                                          f", against a profit of ₹{pp:,.0f} crore a year earlier." if pp is not None else ".")
            else:
                v, tone = "Back to profit", "up"
                txt = f"A profit of ₹{lp:,.0f} crore, after a loss a year earlier."
            glance.append({"k": f"{q} results, {when}", "v": v, "tone": tone})
            out.append(r(tone if tone != "warn" else "neutral", f"{q} quarter: {v.lower()}", (f"Results came out on {rs['filed']}. " if rs.get("filed") else "") + txt))
        else:
            res = d.get("results") or {}
            if rs.get("state") == "filed_pending":
                v, tone, txt = f"Filed {rs['filed']}", "warn", f"The company filed its {q} results with the exchange on {rs['filed']}. Our numbers source has not picked them up yet, so the figures below are still for {lq}."
            elif res.get("date"):
                v, tone, txt = f"Due {res.get('dow', '')} {res['date']}", "warn", f"{q} results are scheduled for {res.get('dow', '')} {res['date']}. Until then the latest numbers are for {lq}."
            else:
                v, tone, txt = "Not out yet", "neutral", f"{q} results are not out and no date is announced. Companies have until {rs.get('deadline', 'mid November')} to report. The latest numbers are for {lq}."
            if q:
                glance.append({"k": f"{q} results", "v": v, "tone": tone})
            if py_ is not None:
                glance.append({"k": f"{lq} quarter", "v": f"Profit {pct(py_, 0)} YoY", "tone": "up" if py_ > 5 else "dn" if py_ < -5 else "neutral"})
                out.append(r(tone, f"{q} results: {v[:1].lower() + v[1:]}", txt + f" In {lq}, sales were {pct(sy or 0, 0)} and profit {pct(py_, 0)} on the year before."))
        own = d.get("own", {}).get("rows", {})
        f_, di = own.get("FIIs", []), own.get("DIIs", [])
        if len(f_) >= 2 and len(di) >= 2:
            q1 = (f_[-1] - f_[-2]) + (di[-1] - di[-2])
            y1 = (f_[-1] - f_[-5]) + (di[-1] - di[-5]) if len(f_) >= 5 else None
            v = "Adding" if q1 > 0.5 else "Cutting" if q1 < -0.5 else "Steady"
            glance.append({"k": "Big money, last quarter", "v": v, "tone": "up" if q1 > 0.5 else "dn" if q1 < -0.5 else "neutral"})
            per = d["own"]["periods"]
            txt = (f"FIIs {f_[-2]:.1f}% → {f_[-1]:.1f}% and DIIs {di[-2]:.1f}% → {di[-1]:.1f}% between {per[-2]} and {per[-1]}. ")
            if y1 is not None:
                txt += f"Over a year their combined holding moved {y1:+.1f} points. "
            if f_[-1] < f_[-2] and di[-1] > di[-2]:
                txt += "Domestic funds have been taking the shares foreign investors sold."
            elif f_[-1] > f_[-2] and di[-1] > di[-2]:
                txt += "Both foreign and domestic institutions added."
            elif f_[-1] < f_[-2] and di[-1] < di[-2]:
                txt += "Both foreign and domestic institutions reduced."
            out.append(r("up" if q1 > 0.5 else "dn" if q1 < -0.5 else "neutral", f"Institutions {v.lower()} ({q1:+.1f} points)", txt))
            pr = own.get("Promoters", [])
            if len(pr) >= 2 and abs(pr[-1] - pr[-2]) >= 0.5:
                out.append(r("up" if pr[-1] > pr[-2] else "warn", f"Promoter holding {pr[-2]:.1f}% → {pr[-1]:.1f}%",
                             "Promoters " + ("raised" if pr[-1] > pr[-2] else "reduced") + " their stake last quarter. Promoter changes are worth reading alongside the company's own disclosures."))
    o = d.get("opt")
    if o:
        out.append(r("neutral", f"Options box it between {o['floor']:,.0f} and {o['ceiling']:,.0f}",
                     f"Put writers are most committed at {o['floor']:,.0f} and call writers at {o['ceiling']:,.0f}. Options price a move of about ±{o['straddle']:,.0f} points by {o['expiry'][:6]}."))
    res = d.get("results")
    if res and (d.get("rstatus") or {}).get("state") != "out":
        if res.get("move_pct"):
            out.append(r("warn", f"Results on {res['dow']} {res['date']}",
                         f"Options price about ±{res['move_pct']:.1f}% by the {res['expiry'][:6]} expiry"
                         + (f", {res['premium']:.1f} times its usual move." if res.get("premium") else ".")
                         + " Results can move the stock well outside its recent range."))
    pt = d.get("pattern")
    if pt:
        out.append(r("up" if pt["direction"] == "bullish" else "dn", f"Chart pattern: {pt['pattern']}",
                     f"{pt['status']}, {pt['direction']}. Our backtest grades this pattern type as {pt['reliability'].lower()}. {pt['trigger'].split(' — ')[0].split('(')[0].strip()}."))
    ch = d.get("chart")
    if ch:
        glance.insert(1, {"k": "Chart strength", "v": f"{ch['score']} · {ch['band']}",
                          "tone": "up" if ch["score"] >= 60 else "dn" if ch["score"] < 45 else "warn"})
    d["glance"] = glance
    return out[:7]


# ---------------------------------------------------------------- what changed (My Stocks)
def changes(d):
    """The few things about a stock worth knowing today, most important first.
    Each item: tone, text, rank (lower = more important)."""
    from datetime import datetime, date
    out = []
    p, t, o = d.get("price") or {}, d.get("tech") or {}, d.get("opt")
    chg = p.get("chg") or 0
    if abs(chg) >= 3:
        out.append({"rank": 1, "tone": "up" if chg > 0 else "dn", "text": f"{'Up' if chg > 0 else 'Down'} {abs(chg):.1f}% in the last session"})
    if d.get("call"):
        c = d["call"]
        out.append({"rank": 0, "tone": "up" if c.get("action") == "BUY" else "dn", "text": f"Live desk call: {c.get('action')} ({c.get('horizon', '')})"})
    rs = d.get("rstatus") or {}
    if rs.get("state") == "out" and rs.get("filed"):
        try:
            age = (date.today() - datetime.strptime(f"{rs['filed']} {date.today().year}", "%d %b %Y").date()).days
        except ValueError:
            age = 99
        if 0 <= age <= 14 and d.get("profit_yoy") is None and d.get("latest_profit") is not None and d["latest_profit"] < 0:
            out.append({"rank": 1, "tone": "dn", "text": f"{rs['quarter']} results out {rs['filed']}: a loss of ₹{abs(d['latest_profit']):,.0f} cr"})
        if 0 <= age <= 14 and d.get("profit_yoy") is not None:
            py_ = d["profit_yoy"]
            out.append({"rank": 1, "tone": "up" if py_ > 5 else "dn" if py_ < -5 else "neutral",
                        "text": f"{rs['quarter']} results out {rs['filed']}: profit {pct(py_, 0)} on last year"})
    elif rs.get("state") == "filed_pending":
        out.append({"rank": 2, "tone": "warn", "text": f"{rs['quarter']} results filed {rs['filed']}, numbers still loading"})
    res = d.get("results") or {}
    if res.get("date") and rs.get("state") != "out":
        mv = f", options price ±{res['move_pct']:.1f}%" if res.get("move_pct") else ""
        out.append({"rank": 1, "tone": "warn", "text": f"Results on {res.get('dow', '')} {res['date']}{mv}"})
    if o and p.get("last"):
        if p["last"] < o["floor"]:
            out.append({"rank": 1, "tone": "dn", "text": f"Trading below its option floor of {o['floor']:,.0f}"})
        elif p["last"] > o["ceiling"]:
            out.append({"rank": 1, "tone": "up", "text": f"Trading above its option ceiling of {o['ceiling']:,.0f}"})
    if p.get("hi52") and p.get("last"):
        if p["last"] >= p["hi52"] * 0.98:
            out.append({"rank": 2, "tone": "up", "text": f"Within 2% of its 52 week high ({p['hi52']:,.0f})"})
        elif p.get("lo52") and p["last"] <= p["lo52"] * 1.02:
            out.append({"rank": 2, "tone": "dn", "text": f"Within 2% of its 52 week low ({p['lo52']:,.0f})"})
    own = (d.get("own") or {}).get("rows", {})
    f_, di = own.get("FIIs", []), own.get("DIIs", [])
    if len(f_) >= 2 and len(di) >= 2:
        q1 = (f_[-1] - f_[-2]) + (di[-1] - di[-2])
        if abs(q1) >= 1:
            per = (d.get("own") or {}).get("periods", [""])[-1]
            out.append({"rank": 3, "tone": "up" if q1 > 0 else "dn", "text": f"Institutions {'added' if q1 > 0 else 'cut'} {abs(q1):.1f} points of holding in {per}"})
    fn = d.get("fut_net") or {}
    if fn.get("kind1") and fn.get("oi1") is not None and abs(fn["oi1"]) >= 5:
        word = {"long_buildup": ("up", "new long positions"), "short_buildup": ("dn", "new short positions"),
                "short_covering": ("up", "shorts closing"), "long_unwinding": ("dn", "longs exiting")}[fn["kind1"]]
        out.append({"rank": 2, "tone": word[0], "text": f"Futures positions {'+' if fn['oi1'] > 0 else '−'}{abs(fn['oi1']):.0f}%: {word[1]}"})
    pt = d.get("pattern")
    if pt and pt.get("status") == "Triggered" and pt.get("age_days", 99) <= 3:
        out.append({"rank": 3, "tone": "up" if pt["direction"] == "bullish" else "dn", "text": f"{pt['pattern']} pattern triggered ({'upward' if pt['direction'] == 'bullish' else 'downward'} shape)"})
    if t and p.get("last"):
        if t.get("rsi", 50) >= 75:
            out.append({"rank": 4, "tone": "warn", "text": f"RSI {t['rsi']:.0f}, stretched after a strong run"})
        elif t.get("rsi", 50) <= 25:
            out.append({"rank": 4, "tone": "warn", "text": f"RSI {t['rsi']:.0f}, stretched after a sharp fall"})
    out.sort(key=lambda x: x["rank"])
    return out[:4]


# ---------------------------------------------------------------- result cards
def _ud(x):
    return f"up {abs(x):.0f}%" if x >= 0 else f"down {abs(x):.0f}%"


def result_card(c):
    """Two to four plain lines that explain one company's results."""
    lines = []
    sy, py_, pq = c.get("sales_yoy"), c.get("profit_yoy"), c.get("profit_qoq")
    word = "Income" if c.get("lender") else "Sales"
    if py_ is not None and sy is not None:
        if c.get("profit") is not None and c["profit"] < 0:
            lines.append({"tone": "dn", "text": f"Reported a loss of ₹{abs(c['profit']):,.0f} cr. {word} {_ud(sy)} on last year."})
        elif py_ > sy + 5:
            lines.append({"tone": "up", "text": f"Profit {_ud(py_)} against {word.lower()} {_ud(sy)}. More of each rupee earned reached the bottom line."})
        elif py_ < sy - 5:
            lines.append({"tone": "dn" if py_ < 0 else "warn", "text": f"{word} {_ud(sy)} but profit {_ud(py_)}. Costs grew faster than income, so margins narrowed."})
        else:
            lines.append({"tone": "up" if py_ > 0 else "dn", "text": f"{word} {_ud(sy)} and profit {_ud(py_)} on last year, roughly in step."})
    if c.get("margin") is not None and c.get("margin_prev") is not None and not c.get("lender"):
        dm = c["margin"] - c["margin_prev"]
        if abs(dm) >= 1:
            lines.append({"tone": "up" if dm > 0 else "dn", "text": f"Net margin {c['margin_prev']:.1f}% → {c['margin']:.1f}% against the same quarter last year."})
    if pq is not None and abs(pq) >= 10:
        lines.append({"tone": "up" if pq > 0 else "dn", "text": f"Against the previous quarter, profit is {_ud(pq)}."})
    rx = c.get("reaction")
    if rx is not None:
        t = f"The stock moved {pct(rx, 1)} on {c['reaction_day']}, the first session after the results."
        if c.get("priced"):
            ratio = abs(rx) / c["priced"] if c["priced"] else 0
            t += (f" Options expected about ±{c['priced']:.1f}%. The move was {ratio:.1f} times that, a real surprise." if ratio >= 1.5 else
                  f" Options expected about ±{c['priced']:.1f}%, and the move was a bit bigger than that." if ratio > 1 else
                  f" Options expected about ±{c['priced']:.1f}%, so the result was mostly priced in." if ratio >= 0.4 else
                  f" Options expected about ±{c['priced']:.1f}%. The stock barely reacted, so the market had it figured out.")
        lines.append({"tone": "up" if rx > 0 else "dn", "text": t})
    else:
        lines.append({"tone": "neutral", "text": "The first trading session after the results has not happened yet."})
    return lines[:4]


# ---------------------------------------------------------------- compare two stocks
def compare(a, b):
    """Plain differences between two stocks. Describes, never picks."""
    na, nb = a["sym"], b["sym"]
    out = []
    ma, mb = a.get("mine") or {}, b.get("mine") or {}
    pa, pb = a.get("price") or {}, b.get("price") or {}
    ca, cb = (a.get("profile") or {}).get("mcap"), (b.get("profile") or {}).get("mcap")
    if ca and cb:
        big, small, r_ = (na, nb, ca / cb) if ca >= cb else (nb, na, cb / ca)
        out.append(r("neutral", "Size", f"{big} is about {r_:.1f} times the size of {small} by market value." if r_ >= 1.3 else "The two are of similar size by market value."))
    if ma.get("pe") and mb.get("pe"):
        hi, lo = (na, nb) if ma["pe"] > mb["pe"] else (nb, na)
        ph, pl = max(ma["pe"], mb["pe"]), min(ma["pe"], mb["pe"])
        out.append(r("neutral", "Valuation", f"{na} trades at {ma['pe']:.1f} times earnings and {nb} at {mb['pe']:.1f}. The market pays about {(ph / pl - 1) * 100:.0f}% more for each rupee of {hi}'s profit, which usually reflects higher expected growth or quality."))
    qk = "roe" if (a.get("lender") or b.get("lender")) else "roce"
    if ma.get(qk) is not None and mb.get(qk) is not None:
        hi = na if ma[qk] > mb[qk] else nb
        out.append(r("neutral", "Returns on capital", f"{qk.upper()} {ma[qk]:.1f}% for {na} against {mb[qk]:.1f}% for {nb}. {hi} earns more profit on the money in its business."))
    if a.get("profit_yoy") is not None and b.get("profit_yoy") is not None:
        out.append(r("neutral", "Latest quarter", f"Profit {pct(a['profit_yoy'], 0)} for {na} ({a.get('latest_q')}) and {pct(b['profit_yoy'], 0)} for {nb} ({b.get('latest_q')}), each against the same quarter a year earlier."))
    if a.get("sales_cagr5") is not None and b.get("sales_cagr5") is not None:
        w = "Income" if (a.get("lender") or b.get("lender")) else "Sales"
        out.append(r("neutral", "Five year growth", f"{w} grew {a['sales_cagr5']:.0f}% a year at {na} and {b['sales_cagr5']:.0f}% a year at {nb}."))
    if pa.get("r1y") is not None and pb.get("r1y") is not None:
        out.append(r("neutral", "Price over a year", f"{na} {pct(pa['r1y'], 1)}, {nb} {pct(pb['r1y'], 1)}."))
    def inst(d):
        o = (d.get("own") or {}).get("rows", {}); f_, di = o.get("FIIs", []), o.get("DIIs", [])
        return (f_[-1] - f_[-2]) + (di[-1] - di[-2]) if len(f_) >= 2 and len(di) >= 2 else None
    ia, ib = inst(a), inst(b)
    if ia is not None and ib is not None:
        out.append(r("neutral", "Big money last quarter", f"Institutions moved {ia:+.1f} points in {na} and {ib:+.1f} points in {nb}."))
    return out


BY_TAB = {"pulse": pulse, "flow": flow, "options": options, "oiflow": oiflow, "liquidity": options, "radar": radar,
          "results": results, "expiry": expiry, "calm": calm, "global": global_, "screens": screens, "stock": stock}


# ---------------------------------------------------------------- stocks in focus
_FUT_WORD = {
    "long_buildup": ("up", "new buying", "Futures positions rose {oi} as the price climbed. Money is being added on the long side, not just shorts closing."),
    "short_buildup": ("dn", "fresh shorts", "Futures positions rose {oi} while the price fell. Traders are opening new bets against it, not just holders selling."),
    "short_covering": ("up", "short covering", "The price rose while futures positions fell {oi}. That is shorts closing. Rallies built on covering fade more often than ones built on new buying."),
    "long_unwinding": ("dn", "holders leaving", "The price fell as futures positions shrank {oi}. Holders are exiting rather than shorts piling in{mild}."),
}


def focus(d, card=None, uni=None):
    """Why this stock deserves a look today, written as one connected thought.
    -> {score, tone, title, why: [sentences], tags} or None when nothing stands out."""
    from datetime import datetime
    p, t, o = d.get("price") or {}, d.get("tech") or {}, d.get("opt") or {}
    last, chg = p.get("last"), p.get("chg") or 0
    if not last:
        return None
    sig = []          # (weight, tone, tag, sentence, title)

    # 1. results, the strongest reason to look
    if card and (card.get("profit_yoy") is not None or card.get("profit") is not None):
        py_, rx, pf, pp = card.get("profit_yoy"), card.get("reaction"), card.get("profit"), card.get("profit_prev")
        if pf is not None and pf < 0:
            prof, good, bad = (f"a loss of ₹{abs(pf):,.0f} cr" + (", smaller than a year ago" if pp is not None and pp < pf else ", wider than a year ago" if pp is not None and pp < 0 and pf < pp else ", against a profit a year ago" if pp is not None and pp > 0 else "")), False, not (pp is not None and pp < pf)
        elif pp is not None and pp < 0 and pf is not None and pf > 0:
            prof, good, bad = "a swing from loss to profit", True, False
        elif py_ is not None:
            prof, good, bad = f"profit {_ud(py_)} on last year" + (" (off a low base a year ago)" if py_ > 150 else ""), py_ > 10, py_ < -10
        else:
            prof, good, bad = None, False, False
        if prof and rx is None:
            sig.append((3.0, "up" if good else "dn" if bad else "neutral", "results",
                        f"{card['quarter']} results came out {card['filed']} with {prof}. The first market reaction is still to come.",
                        f"Results out, {prof.split(' on last')[0]}"))
        elif prof:
            when = "on results day" if card.get("rx_is_last") else f"on results day ({card.get('reaction_day', '')})"
            if good and rx >= 2:
                s_, tl, tn = f"Results landed well: {prof}, and the stock rose {rx:.1f}% {when}. The market believed the number.", "Strong results, market agreed", "up"
            elif good and rx <= -2:
                s_, tl, tn = f"{prof[0].upper() + prof[1:]}, yet the stock fell {abs(rx):.1f}% {when}. When good numbers get sold, the market usually expected more or doubts how the profit was made.", "Good numbers, sold anyway", "dn"
            elif bad and rx >= 2:
                s_, tl, tn = f"{prof[0].upper() + prof[1:]}, yet the stock rose {rx:.1f}% {when}. The damage was smaller than feared, or something in the outlook outweighed it.", "Weak numbers, bought anyway", "up"
            elif bad and rx <= -2:
                s_, tl, tn = f"Weak results and the market agreed: {prof}, and the stock fell {abs(rx):.1f}% {when}.", "Weak results, market agreed", "dn"
            elif pf is not None and pf < 0 and rx <= -3:
                s_, tl, tn = f"{prof[0].upper() + prof[1:]}, and the stock fell {abs(rx):.1f}% {when}. The improvement was not enough for what the price already assumed.", "Loss narrowed, sold anyway", "dn"
            elif pf is not None and pf < 0 and rx >= 3:
                s_, tl, tn = f"{prof[0].upper() + prof[1:]}, and the stock rose {rx:.1f}% {when}. The market is looking past the loss to where the business is heading.", "Still a loss, bought anyway", "up"
            elif rx <= -3:
                s_, tl, tn = f"{prof[0].upper() + prof[1:]}, and the stock fell {abs(rx):.1f}% {when}. Results that do not grow are being punished: the market wanted more.", "Flat results, sold", "dn"
            elif rx >= 3:
                s_, tl, tn = f"{prof[0].upper() + prof[1:]}, yet the stock rose {rx:.1f}% {when}. Something beyond the headline number, often margins or the outlook, carried it.", "Flat results, bought", "up"
            else:
                s_, tl, tn = f"Results with {prof} moved the stock {rx:+.1f}% {when}. No real surprise either way.", "Results, no surprise", "neutral"
            if card.get("priced"):
                s_ += f" Options had priced ±{card['priced']:.1f}%, so the move was {'bigger' if abs(rx) > card['priced'] else 'smaller'} than traders expected."
            since = card.get("since")
            if since is not None and not card.get("rx_is_last") and abs(since) >= 2:
                if (since > 0) != (rx > 0):
                    s_ += f" It has {'recovered' if since > 0 else 'given back'} {abs(since):.1f}% since, so the first reaction is being questioned."
                    tn = "warn"
                elif abs(rx) < 2 and abs(since) >= 4:
                    s_ += f" The real move came after: {since:+.1f}% since then."
                    tn = "up" if since > 0 else "dn"
                    tl = "Rose after results" if since > 0 else "Slid after results"
                else:
                    s_ += f" It has moved a further {since:+.1f}% since, so the reaction is holding."
            sig.append((3.0 + min(abs(rx), 10) / 3, tn, "results", s_, tl))

    # 2. results coming, priced for a big move
    res = d.get("results") or {}
    if res.get("move_pct") and res.get("premium") and not card:
        try:
            days = (datetime.strptime(res["iso"], "%Y-%m-%d").date() - datetime.now().date()).days
        except (KeyError, ValueError):
            days = 99
        if 0 <= days <= 4 and res["premium"] >= 1.6:
            sig.append((1.5 + res["premium"], "warn", "results soon",
                        f"Results on {res.get('dow', '')} {res['date']}. Options price a ±{res['move_pct']:.1f}% move, {res['premium']:.1f} times its normal day. Traders are bracing for a big reaction.",
                        f"Results {res.get('dow', '')}, big move priced"))

    # 3. futures positioning, all expiries added up
    fn = d.get("fut_net") or {}
    kind, oi1, oi5 = fn.get("kind1"), fn.get("oi1"), fn.get("oi5")
    if oi5 is not None and abs(oi5) >= 8 and fn.get("kind5") and (oi1 is None or abs(oi5) > abs(oi1) * 1.5):
        kind, oi, span, pm = fn["kind5"], oi5, "over five sessions", fn.get("p5")
    else:
        oi, span, pm = oi1, "in the last session", fn.get("p1")
    if kind and oi is not None and abs(oi) >= 4:
        tn, tag, txt = _FUT_WORD[kind]
        txt = txt.replace("The price rose", f"The price rose {abs(pm or 0):.1f}%").replace("The price fell", f"The price fell {abs(pm or 0):.1f}%").replace("as the price climbed", f"as the price climbed {abs(pm or 0):.1f}%").replace("while the price fell", f"while the price fell {abs(pm or 0):.1f}%")
        mild = ", usually the milder kind of fall" if abs(pm or 0) < 3 else ""
        sig.append((1.0 + min(abs(oi), 30) / 8, tn, tag, txt.format(oi=f"{abs(oi):.0f}% {span}", mild=mild), f"{tag.capitalize()} in futures"))

    # 4. option levels broken
    if o.get("floor") and last < o["floor"]:
        sig.append((2.0, "dn", "below floor", f"It closed at {last:,.0f}, under {o['floor']:,.0f}, the strike where put writers had the most money. They were defending that level and lost it.", f"Lost its {o['floor']:,.0f} floor"))
    elif o.get("ceiling") and last > o["ceiling"]:
        sig.append((2.0, "up", "above ceiling", f"It closed at {last:,.0f}, above {o['ceiling']:,.0f}, the strike where call writers had capped it. Those sellers are now on the wrong side.", f"Broke its {o['ceiling']:,.0f} ceiling"))

    # 5. 52 week extremes, read with the trend
    e50, e200 = t.get("ema50"), t.get("ema200")
    trend = None
    if e50 and e200:
        trend = "up" if last > e50 > e200 else "dn" if last < e50 < e200 else None
    if p.get("hi52") and last >= p["hi52"] * 0.98:
        sig.append((1.6 if trend == "up" else 1.2, "up", "52w high", f"It trades within 2% of its 52 week high of {p['hi52']:,.0f}" + (", with the trend already up." if trend == "up" else "."), "Near its 52 week high"))
    elif p.get("lo52") and last <= p["lo52"] * 1.02:
        sig.append((1.4 if trend == "dn" else 1.1, "dn", "52w low", f"It trades within 2% of its 52 week low of {p['lo52']:,.0f}" + (", and the trend has been down for months." if trend == "dn" else "."), "Near its 52 week low"))

    # 6. a big day, unless it was the results reaction already counted
    if abs(chg) >= 3 and not (card and card.get("rx_is_last")) and not ((uni or {}).get("vr") or 0) >= 3:
        sig.append((1.0 + abs(chg) / 3, "up" if chg > 0 else "dn", "big move", f"It moved {chg:+.1f}% in the last session.", f"{'Up' if chg > 0 else 'Down'} {abs(chg):.1f}%"))

    # 6b. unusual volume: a move on heavy trading means more than a quiet one
    vr = (uni or {}).get("vr")
    if vr and vr >= 3 and abs(chg) >= 2:
        sig.append((1.0 + min(vr, 12) / 4, "up" if chg > 0 else "dn", "heavy volume",
                    f"It traded {vr:.0f} times its usual volume as it {'rose' if chg > 0 else 'fell'} {abs(chg):.1f}%. Moves on heavy volume carry more conviction than quiet ones.",
                    f"{'Up' if chg > 0 else 'Down'} {abs(chg):.1f}% on {vr:.0f}× volume"))

    # 7. institutions going against the price
    own = (d.get("own") or {}).get("rows", {})
    f_, di = own.get("FIIs", []), own.get("DIIs", [])
    if len(f_) >= 2 and len(di) >= 2 and p.get("r3m") is not None:
        q1 = (f_[-1] - f_[-2]) + (di[-1] - di[-2])
        per = (d.get("own") or {}).get("periods", [""])[-1]
        if q1 >= 1 and p["r3m"] <= -8:
            sig.append((1.5, "up", "funds buying", f"Funds added {q1:.1f} points of holding in the {per} quarter even as the stock fell {abs(p['r3m']):.0f}% in three months. Big holders were buying the fall.", "Funds buying the fall"))
        elif q1 <= -1 and p["r3m"] >= 8:
            sig.append((1.5, "dn", "funds selling", f"Funds cut {abs(q1):.1f} points of holding in the {per} quarter while the stock rose {p['r3m']:.0f}% in three months. Big holders used the rally to sell.", "Funds selling the rise"))

    if not sig:
        return None
    sig.sort(key=lambda x: -x[0])
    w_up = sum(x[0] for x in sig if x[1] == "up"); w_dn = sum(x[0] for x in sig if x[1] == "dn")
    tone = "up" if w_up > w_dn * 1.3 else "dn" if w_dn > w_up * 1.3 else "warn"
    why = [x[3] for x in sig[:3]]
    same = [x for x in sig if x[1] == tone]
    if tone in ("up", "dn") and len(same) >= 3:
        why.append(f"{len(same)} separate signals point the same way, which means more than any one of them alone.")
    elif w_up >= 1.5 and w_dn >= 1.5:
        why.append("The signals disagree. That usually means the next move is still being decided.")
    score = sum(x[0] for x in sig) + (1.5 if len(same) >= 3 else 0)
    return {"score": round(score, 2), "tone": tone, "title": sig[0][4], "why": why, "tags": [x[2] for x in sig[:4]]}


# ---------------------------------------------------------------- compare: scorecard
def _ind(d):
    path = d.get("industry") or []
    return (path[-1] if path else None) or (d.get("profile") or {}).get("peer_scope")


def _sector(d):
    path = d.get("industry") or []
    return (path[0] if path else None) or (d.get("profile") or {}).get("sector_name")


def _pe_ok(d):
    """P/E is only meaningful when profit is positive and not freshly collapsed."""
    pe = (d.get("mine") or {}).get("pe")
    if not pe or pe <= 0:
        return None, "makes a loss, so P/E has no meaning"
    if pe > 60 and (d.get("profit_yoy") or 0) < -40:
        return None, f"P/E of {pe:.0f} is inflated by a {abs(d['profit_yoy']):.0f}% fall in quarterly profit"
    return pe, None


def verdict(a, b):
    """Which of two stocks the numbers favour, measure by measure.
    Same industry: head to head. Different industries: each against its own peers,
    because a bank's P/E and a software firm's P/E are not the same kind of number."""
    na, nb = a["sym"], b["sym"]
    ia, ib = _ind(a), _ind(b)
    same = bool(ia and ib and ia == ib)
    same_sector = _sector(a) and _sector(a) == _sector(b)
    la, lb = bool(a.get("lender")), bool(b.get("lender"))
    rows = []

    def add(measure, ta, tb, edge, why):
        rows.append({"measure": measure, "a": ta, "b": tb, "edge": edge, "why": why})

    # 1. valuation
    pa_, wa = _pe_ok(a); pb_, wb = _pe_ok(b)
    ma, mb = a.get("mine") or {}, b.get("mine") or {}
    if wa or wb:
        add("Valuation", f"P/E {ma.get('pe') or 0:.1f}", f"P/E {mb.get('pe') or 0:.1f}", None,
            "Not scored: " + "; ".join(f"{s} {w}" for s, w in ((na, wa), (nb, wb)) if w) + ".")
    elif pa_ and pb_ and same:
        g = pa_ / pb_ - 1
        e = None if abs(g) < 0.15 else ("b" if g > 0 else "a")
        add("Valuation", f"P/E {pa_:.1f}", f"P/E {pb_:.1f}", e,
            "Same industry, so P/E compares directly. " + ("Priced about the same." if not e else
            f"{nb if e == 'b' else na} costs {abs(g) * 100 if g > 0 else (pb_ / pa_ - 1) * 100:.0f}% less for each rupee of profit."))
    elif pa_ and pb_:
        qa, qb = (a.get("peer") or {}).get("pe"), (b.get("peer") or {}).get("pe")
        if qa and qb and (a.get("profile") or {}).get("peer_compare", True) and (b.get("profile") or {}).get("peer_compare", True):
            ra, rb = pa_ / qa, pb_ / qb
            e = None if abs(ra - rb) < 0.2 else ("a" if ra < rb else "b")
            add("Valuation", f"{ra:.1f}× its industry", f"{rb:.1f}× its industry", e,
                f"Different industries, so each P/E is set against its own peers ({pa_:.0f} vs {qa:.0f}, and {pb_:.0f} vs {qb:.0f}). "
                + ("Both priced alike relative to their industries." if not e else f"{na if e == 'a' else nb} is cheaper against its own industry."))
        else:
            add("Valuation", f"P/E {pa_:.1f}", f"P/E {pb_:.1f}", None, "Not scored: different industries and no fair peer set to measure each against.")

    # 2. business quality
    if la != lb:
        ka, kb = ("roe" if la else "roce"), ("roe" if lb else "roce")
        va, vb = ma.get(ka), mb.get(kb)
        qa, qb = (a.get("peer") or {}).get(ka), (b.get("peer") or {}).get(kb)
        if None not in (va, vb, qa, qb):
            da, db_ = va - qa, vb - qb
            e = None if abs(da - db_) < 2 else ("a" if da > db_ else "b")
            add("Business quality", f"{ka.upper()} {va:.1f}% ({da:+.1f} vs peers)", f"{kb.upper()} {vb:.1f}% ({db_:+.1f} vs peers)", e,
                "A lender is judged on ROE and a company on ROCE, so each is set against its own peers.")
    else:
        k = "roe" if la else "roce"
        va, vb = ma.get(k), mb.get(k)
        if va is not None and vb is not None:
            if same or same_sector:
                e = None if abs(va - vb) < 2 else ("a" if va > vb else "b")
                add("Business quality", f"{k.upper()} {va:.1f}%", f"{k.upper()} {vb:.1f}%", e,
                    "Profit earned on the money in the business. " + ("Similar." if not e else f"{na if e == 'a' else nb} earns more on its capital."))
            else:
                qa, qb = (a.get("peer") or {}).get(k), (b.get("peer") or {}).get(k)
                if qa is not None and qb is not None:
                    da, db_ = va - qa, vb - qb
                    e = None if abs(da - db_) < 2 else ("a" if da > db_ else "b")
                    add("Business quality", f"{k.upper()} {va:.1f}% ({da:+.1f} vs peers)", f"{k.upper()} {vb:.1f}% ({db_:+.1f} vs peers)", e,
                        "Different industries need different amounts of capital, so each is measured against its own peers.")

    # 3. long run growth: comparable across industries
    sa, sb = a.get("sales_cagr5"), b.get("sales_cagr5")
    if sa is not None and sb is not None:
        e = None if abs(sa - sb) < 3 else ("a" if sa > sb else "b")
        w = "Income" if (la or lb) else "Sales"
        add("Five year growth", f"{sa:.0f}% a year", f"{sb:.0f}% a year", e, f"{w} growth over five years. " + ("Similar pace." if not e else f"{na if e == 'a' else nb} has grown faster."))

    # 4. latest quarter
    ya, yb = a.get("profit_yoy"), b.get("profit_yoy")
    if ya is not None and yb is not None and a.get("latest_q") != b.get("latest_q"):
        from datetime import datetime as _dt
        qd = lambda q: _dt.strptime(q, "%b %Y") if q else _dt.min
        late = na if qd(a.get("latest_q")) < qd(b.get("latest_q")) else nb
        add("Latest quarter", f"Profit {ya:+.0f}% ({a.get('latest_q')})", f"Profit {yb:+.0f}% ({b.get('latest_q')})", None,
            f"Not scored: these are different quarters. {late} has not reported the newer one yet.")
    elif ya is not None and yb is not None:
        e = None if abs(ya - yb) < 10 else ("a" if ya > yb else "b")
        note = " One of these is off a very low base, so read it with care." if max(abs(ya), abs(yb)) > 150 else ""
        add("Latest quarter", f"Profit {ya:+.0f}%", f"Profit {yb:+.0f}%", e,
            f"Profit in the {a.get('latest_q')} quarter against a year earlier.{note}")

    # 5. price trend
    pa, pb = a.get("price") or {}, b.get("price") or {}
    if pa.get("r3m") is not None and pb.get("r3m") is not None:
        e = None if abs(pa["r3m"] - pb["r3m"]) < 5 else ("a" if pa["r3m"] > pb["r3m"] else "b")
        add("Price trend", f"{pa['r3m']:+.1f}% in 3 months", f"{pb['r3m']:+.1f}% in 3 months", e,
            "Which one the market has been rewarding lately. " + ("Moving alike." if not e else f"{na if e == 'a' else nb} is holding up better."))

    # 6. big money
    def inst(d):
        o = (d.get("own") or {}).get("rows", {}); f_, di = o.get("FIIs", []), o.get("DIIs", [])
        return (f_[-1] - f_[-2]) + (di[-1] - di[-2]) if len(f_) >= 2 and len(di) >= 2 else None
    xa, xb = inst(a), inst(b)
    if xa is not None and xb is not None:
        e = None if abs(xa - xb) < 0.5 else ("a" if xa > xb else "b")
        add("Fund buying", f"{xa:+.1f} points", f"{xb:+.1f} points", e,
            "Change in foreign and domestic fund holding last quarter. " + ("No real difference." if not e else f"Funds favoured {na if e == 'a' else nb}."))

    scored = [r_ for r_ in rows if r_["edge"]]
    wa_, wb_ = sum(1 for r_ in scored if r_["edge"] == "a"), sum(1 for r_ in scored if r_["edge"] == "b")
    lead = lambda e: ", ".join(r_["measure"].lower() for r_ in rows if r_["edge"] == e)
    if not scored:
        bottom, winner = "Neither stands out on these numbers.", None
    elif wa_ == wb_:
        bottom, winner = f"Evenly split: {na} leads on {lead('a')}, {nb} on {lead('b')}. The choice depends on which of those matters to you.", None
    else:
        winner = "a" if wa_ > wb_ else "b"
        w_, l_ = (na, nb) if winner == "a" else (nb, na)
        wl = lead(winner); ll = lead("b" if winner == "a" else "a")
        bottom = f"{w_} leads on {max(wa_, wb_)} of {len(rows)} measures ({wl})." + (f" {l_} leads on {ll}." if ll else f" {l_} leads on none.")
    if same:
        basis = f"Both are in {ia}, so the numbers compare directly."
    elif same_sector:
        basis = f"Same sector, different industries ({ia} and {ib}). Valuation is measured against each one's own peers."
    else:
        basis = (f"{na} ({ia or 'its industry'}) and {nb} ({ib or 'its industry'}) are in different sectors. Comparing their P/E or returns directly would mislead, "
                 "so those are measured against each one's own peers. Growth, price trend and fund buying compare directly.")
    return {"rows": rows, "a": wa_, "b": wb_, "winner": winner, "bottom": bottom, "basis": basis, "same": same}


# ---------------------------------------------------------------- one line at the top of a stock page
def summary(d):
    """The whole page in one plain sentence, built from the same readings shown below it."""
    pos, neg, extra = [], [], []
    g = {x["k"]: x["v"] for x in d.get("glance") or []}
    card = d.get("result_card")
    rs = d.get("rstatus") or {}
    py_, lp = d.get("profit_yoy"), d.get("latest_profit")
    # results come first
    if card or rs.get("state") == "out":
        if lp is not None and lp < 0:
            neg.append("still making a loss")
        elif py_ is not None and py_ > 10:
            pos.append(f"strong results (profit {py_:+.0f}%)")
        elif py_ is not None and py_ < -10:
            neg.append(f"weak results (profit {py_:+.0f}%)")
        elif py_ is not None:
            extra.append("results were flat")
        if card and card.get("reaction") is not None and card.get("priced") and abs(card["reaction"]) > 1.5 * card["priced"]:
            extra.insert(0, f"results moved it {card['reaction']:+.1f}%, far more than options expected")
    else:
        res = d.get("results") or {}
        if res.get("date"):
            extra.append(f"results are due {res.get('dow', '')} {res['date']}".replace("  ", " "))
    # trend
    tr = g.get("Trend")
    if tr == "Uptrend":
        pos.append("the trend is up")
    elif tr == "Downtrend":
        neg.append("the trend is down")
    elif tr == "Sideways":
        extra.append("the price is moving sideways")
    p = d.get("price") or {}
    if p.get("hi52") and p.get("last") and p["last"] >= p["hi52"] * 0.98:
        pos.append("it is near its 52 week high")
    elif p.get("lo52") and p.get("last") and p["last"] <= p["lo52"] * 1.02:
        neg.append("it is near its 52 week low")
    # valuation and quality, only when the comparison is fair
    v = g.get("Valuation")
    mine, peer = d.get("mine") or {}, d.get("peer") or {}
    if v == "Richer than peers":
        far = mine.get("pe") and peer.get("pe") and mine["pe"] > 1.6 * peer["pe"]
        neg.append("priced well above its peers" if far else "priced above its peers")
    elif v == "Cheaper than peers":
        pos.append("cheaper than its peers")
    q = g.get("Business quality")
    if q == "Above peers":
        pos.append("it earns more on its capital than peers")
    elif q == "Below peers":
        neg.append("it earns less on its capital than peers")
    m = g.get("Big money, last quarter")
    if m == "Adding":
        pos.append("funds have been adding")
    elif m == "Cutting":
        neg.append("funds have been cutting")

    pos, neg = pos[:2], neg[:2]
    def join(xs):
        return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]
    if pos and neg:
        text = f"{join(pos)}, but {join(neg)}"
    elif pos or neg:
        text = join(pos or neg)
    else:
        text = ""
    if extra:
        text = (text + "; " if text else "") + extra[0]
    if not text:
        return None
    tone = "up" if len(pos) > len(neg) + 0 and len(pos) >= 2 and not neg else "dn" if len(neg) >= 2 and not pos else \
           "up" if len(pos) > len(neg) else "dn" if len(neg) > len(pos) else "warn"
    return {"text": text[0].upper() + text[1:] + ".", "tone": tone}
