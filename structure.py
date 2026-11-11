"""Price structure: swing points, breaks of structure, changes of character, sweeps and order blocks.

One engine for everything. The stock chart, the Price Structure page and the backtest that writes
data/structure_stats.json all call analyse(), so the "we tested this" line always describes the
exact rules that drew the chart.

It walks the candles forward one bar at a time and only uses what was known on that bar:
a swing point counts K bars after it formed, never before. Nothing is redrawn after the fact.

Words follow the desk's rules: events say what price did ("closed above its last swing high"),
never what to do, and never "bullish" or "bearish".
"""
from datetime import datetime

VERSION = 3    # bump when a rule or the page output changes, so cached stock pages rebuild their structure
K = 3          # a swing high has K lower highs on each side (a swing low, K higher lows)
BUF = 0.1      # a break must close beyond the level by this many ATRs; a hair over is not a break
OB_LOOK = 15   # an order block is searched for in at most this many candles before the break
STRONG = 1.5   # a break candle whose range is this many ATRs is a strong move away
VOL = 1.5      # break-day volume this many times its 20-day average counts as heavy

KINDS = {      # plain names, for cards and markers
    "BoS": "Break of structure",
    "CHoCH": "Change of character",
    "Break": "Break",
    "Sweep": "Liquidity sweep",
    "DaySweep": "Previous-day sweep",
    "OB": "Order block retest",
}


def _atr(h, l, c, n=14):
    out = [None] * len(c)
    trs = []
    for i in range(1, len(c)):
        trs.append(max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
        if len(trs) >= n:
            out[i] = sum(trs[-n:]) / n
    return out


def _day(t):
    return datetime.fromtimestamp(t).strftime("%d %b")


def analyse(candles, k=K, buf=BUF):
    """candles: list of {t, o, h, l, c, v?} oldest first. Returns swings, trend, events and order blocks."""
    n = len(candles)
    if n < 4 * k + 20:
        return None
    t_ = [x["t"] for x in candles]
    o = [x["o"] for x in candles]
    h = [x["h"] for x in candles]
    l = [x["l"] for x in candles]
    c = [x["c"] for x in candles]
    v = [x.get("v") or 0 for x in candles]
    atr = _atr(h, l, c)

    is_sh = [False] * n
    is_sl = [False] * n
    for i in range(k, n - k):
        if h[i] > max(h[i - k:i]) and h[i] > max(h[i + 1:i + k + 1]):
            is_sh[i] = True
        if l[i] < min(l[i - k:i]) and l[i] < min(l[i + 1:i + k + 1]):
            is_sl[i] = True

    highs, lows = [], []                 # confirmed swings: (bar, price)
    events, blocks, swings = [], [], []
    used_h = used_l = None               # a swing level breaks once
    swept_h = swept_l = None             # and is swept once
    trend_hist = []

    def trend():
        if len(highs) < 2 or len(lows) < 2:
            return "none"
        if highs[-1][1] > highs[-2][1] and lows[-1][1] > lows[-2][1]:
            return "up"
        if highs[-1][1] < highs[-2][1] and lows[-1][1] < lows[-2][1]:
            return "down"
        return "none"

    def avg_vol(i):
        w = [x for x in v[max(0, i - 20):i] if x]
        return sum(w) / len(w) if w else 0

    for i in range(n):
        j = i - k                        # the swing that just became visible
        if j >= 0 and is_sh[j]:
            highs.append((j, h[j])); swings.append({"t": t_[j], "p": round(h[j], 2), "kind": "H"})
        if j >= 0 and is_sl[j]:
            lows.append((j, l[j])); swings.append({"t": t_[j], "p": round(l[j], 2), "kind": "L"})
        tr = trend()
        trend_hist.append(tr)

        # order blocks already standing: retest, wear and break
        for b in blocks:
            if b["status"] == "broken" or b["_bar"] >= i:
                continue
            if b["dir"] == "up":
                broke, touch = c[i] < b["bot"], l[i] <= b["top"]
            else:
                broke, touch = c[i] > b["top"], h[i] >= b["bot"]
            if broke:
                b["status"], b["broken_t"] = "broken", t_[i]
                continue
            if touch and not b["_in"]:
                b["tests"] += 1
                b["status"] = "tested"
                if b["tests"] == 1:
                    events.append({"t": t_[i], "bar": i, "kind": "OB", "dir": b["dir"], "level": b["top"] if b["dir"] == "up" else b["bot"],
                                   "block": b["id"], "after": b["after"], "chain": b["chain"], "strong": b["strong"],
                                   "text": f"Came back to the order block from {_day(b['t'])} (₹{b['bot']:,.2f} to ₹{b['top']:,.2f}) for the first time"})
            b["_in"] = touch

        if i < 1 or atr[i] is None or not highs or not lows:
            continue
        H1, L1 = highs[-1], lows[-1]
        rng = h[i] - l[i]
        strong = rng >= STRONG * atr[i]
        heavy = bool(v[i]) and avg_vol(i) > 0 and v[i] >= VOL * avg_vol(i)

        def swept_before(direction):             # a swing-level sweep the same way in the last 10 candles: the posts' sweep-then-break chain
            for e in reversed(events):
                if e["bar"] < i - 10:
                    return False
                if e["kind"] == "Sweep" and e["dir"] == direction:      # previous-day sweeps happen on a third of all days, too common to mean anything here
                    return True
            return False

        def add_block(direction, ev):
            lo_bar = (lows[-1][0] if direction == "up" else highs[-1][0])
            for jj in range(i - 1, max(lo_bar, i - OB_LOOK) - 1, -1):
                if (direction == "up" and c[jj] < o[jj]) or (direction == "dn" and c[jj] > o[jj]):
                    blocks.append({"id": len(blocks), "t": t_[jj], "made_t": t_[i], "dir": direction, "top": round(h[jj], 2), "bot": round(l[jj], 2),
                                   "status": "fresh", "tests": 0, "after": ev["kind"], "chain": bool(ev.get("after_sweep")),
                                   "strong": ev.get("strong"), "_bar": i, "_in": False})
                    ev["block"] = len(blocks) - 1
                    return

        # a close beyond the last swing high
        if used_h != H1[0] and c[i] > H1[1] + buf * atr[i] and c[i - 1] <= H1[1] + buf * atr[i]:
            used_h = H1[0]
            kind = "BoS" if tr == "up" else "CHoCH" if tr == "down" else "Break"
            ev = {"t": t_[i], "bar": i, "kind": kind, "dir": "up", "level": round(H1[1], 2), "level_t": t_[H1[0]], "strong": strong, "heavy": heavy,
                  "text": {"BoS": "Closed above its last swing high while making higher highs and higher lows",
                           "CHoCH": "Closed above its last swing high after a run of lower highs and lower lows",
                           "Break": "Closed above its last swing high"}[kind] + f" (₹{H1[1]:,.2f} from {_day(t_[H1[0]])})"}
            ev["after_sweep"] = swept_before("up")
            events.append(ev); add_block("up", ev)
        # a close beyond the last swing low
        if used_l != L1[0] and c[i] < L1[1] - buf * atr[i] and c[i - 1] >= L1[1] - buf * atr[i]:
            used_l = L1[0]
            kind = "BoS" if tr == "down" else "CHoCH" if tr == "up" else "Break"
            ev = {"t": t_[i], "bar": i, "kind": kind, "dir": "dn", "level": round(L1[1], 2), "level_t": t_[L1[0]], "strong": strong, "heavy": heavy,
                  "text": {"BoS": "Closed below its last swing low while making lower highs and lower lows",
                           "CHoCH": "Closed below its last swing low after a run of higher highs and higher lows",
                           "Break": "Closed below its last swing low"}[kind] + f" (₹{L1[1]:,.2f} from {_day(t_[L1[0]])})"}
            ev["after_sweep"] = swept_before("dn")
            events.append(ev); add_block("dn", ev)

        # sweeps: through the level on the wick, back inside it on the close, closing in the far half of the candle
        if rng > 0:
            if swept_l != L1[0] and l[i] < L1[1] and c[i] > L1[1] and c[i] >= l[i] + 0.5 * rng:
                swept_l = L1[0]
                events.append({"t": t_[i], "bar": i, "kind": "Sweep", "dir": "up", "level": round(L1[1], 2), "level_t": t_[L1[0]],
                               "text": f"Dipped below its last swing low (₹{L1[1]:,.2f}) and closed back above it"})
            if swept_h != H1[0] and h[i] > H1[1] and c[i] < H1[1] and c[i] <= l[i] + 0.5 * rng:
                swept_h = H1[0]
                events.append({"t": t_[i], "bar": i, "kind": "Sweep", "dir": "dn", "level": round(H1[1], 2), "level_t": t_[H1[0]],
                               "text": f"Rose above its last swing high (₹{H1[1]:,.2f}) and closed back below it"})
            if l[i] < l[i - 1] and c[i] > l[i - 1] and c[i] >= l[i] + 0.5 * rng:
                events.append({"t": t_[i], "bar": i, "kind": "DaySweep", "dir": "up", "level": round(l[i - 1], 2),
                               "text": f"Dipped below the previous day's low (₹{l[i - 1]:,.2f}) and closed back above it"})
            if h[i] > h[i - 1] and c[i] < h[i - 1] and c[i] <= l[i] + 0.5 * rng:
                events.append({"t": t_[i], "bar": i, "kind": "DaySweep", "dir": "dn", "level": round(h[i - 1], 2),
                               "text": f"Rose above the previous day's high (₹{h[i - 1]:,.2f}) and closed back below it"})

    # when did the current shape start
    now = trend_hist[-1] if trend_hist else "none"
    since = None
    for i in range(len(trend_hist) - 1, -1, -1):
        if trend_hist[i] != now:
            since = t_[i + 1] if i + 1 < n else None
            break
    for b in blocks:
        b.pop("_bar", None); b.pop("_in", None)
    return {"k": k, "buf": buf, "trend": now, "since": since,
            "last_high": {"t": t_[highs[-1][0]], "p": round(highs[-1][1], 2)} if highs else None,
            "last_low": {"t": t_[lows[-1][0]], "p": round(lows[-1][1], 2)} if lows else None,
            "swings": swings, "events": events, "blocks": blocks, "last": round(c[-1], 2), "atr": round(atr[-1], 2) if atr[-1] else None}


def merge_blocks(blocks):
    """Order blocks of one direction whose price ranges overlap (or sit within 1%) become one band, so stacked zones
    read as one area instead of a smudge. Newest band first. A band is fresh only if none of its
    blocks has been revisited."""
    bands = []
    for b in sorted(blocks, key=lambda b: b["bot"]):
        if bands and b["bot"] <= bands[-1]["top"] * 1.01:      # overlapping, or within 1%: drawn apart they read as one smudge anyway
            m = bands[-1]
            m["top"] = max(m["top"], b["top"])
            m["dates"].append(b["t"])
            m["t"], m["made_t"] = min(m["t"], b["t"]), max(m["made_t"], b["made_t"])
            m["tests"] = max(m["tests"], b["tests"])
            if b["status"] != "fresh":
                m["status"] = "tested"
        else:
            bands.append({**b, "dates": [b["t"]]})
    for m in bands:
        m["dates"].sort()
        m["n"] = len(m["dates"])
    return sorted(bands, key=lambda m: -m["made_t"])


def for_page(candles, start_t=None, stats=None):
    """What the stock chart and card need: everything inside the visible window, the order blocks still
    standing, and the tested line for each kind of event."""
    a = analyse(candles)
    if not a:
        return None
    t0 = start_t or candles[0]["t"]
    ev = [e for e in a["events"] if e["t"] >= t0 and e["kind"] != "DaySweep"]
    live = [b for b in a["blocks"] if b["status"] != "broken" and b["t"] >= t0]     # zones from before the visible year are clutter
    live = merge_blocks([b for b in live if b["dir"] == "up"])[:3] + merge_blocks([b for b in live if b["dir"] == "dn"])[:3]
    today = [e for e in a["events"] if e["t"] == candles[-1]["t"]]
    for e in ev + today:
        e.pop("bar", None)
    out = {"v": VERSION, "trend": a["trend"], "since": a["since"], "last_high": a["last_high"], "last_low": a["last_low"], "last": a["last"],
           "swings": [s for s in a["swings"] if s["t"] >= t0], "events": ev[-40:], "blocks": live, "today": today,
           "rules": {"k": a["k"], "buf": a["buf"]}}
    if stats:
        out["tested"] = stats
    return out
