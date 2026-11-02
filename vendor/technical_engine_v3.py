"""
technical_engine_v3.py  —  Venty Technical Score, clean-room v3 rebuild.

Self-contained. Replaces nothing; the old technical_score.py (11-factor) stays beside it as
legacy/backtest reference. Built from the factor-by-factor designs validated against the user's eye.

SIX factors, each rated 1.0-5.0, weighted, mapped to 0-100:
  1. STRUCTURE   (28%) - swing staircase (HH/HL over the whole window) + fresh-high proximity
  2. EMA STACK   (24%) - price vs the 20/50/200 EMAs (the 9 was dropped: too noisy)
  3. MOMENTUM    (20%) - RSI (range-rule floor + divergence)  x  MACD (crossover + acceleration), matrix-combined
  4. WEEKLY      (15%) - REAL weekly trend: consecutive higher-high/higher-low streak (daily->weekly resample)
  5. VOLUME      ( 8%) - VWAP control  +  money-flow (close-in-range, block-capped)
  6. VOLATILITY  ( 5%) - soft: ATR coil/wild, softened by India VIX (market composure). Rarely penalises.

BACKEND-SAFE: uses only what Venty stores - EMA 9/12/20/26/50/200, RSI14, ATR14, VWAP20,
MACD(line/signal/hist) - all recomputed here from OHLCV, plus optional live India VIX. No EMA100,
no Bollinger, no beta.

Usage:  s = score(df, vix=14.2)   # df = daily OHLCV DataFrame, newest last
"""
import numpy as np
import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
#  WEIGHTS  (the one knob - adjust freely; normalised by their sum)
# ─────────────────────────────────────────────────────────────────────────────
WEIGHTS = {
    "structure":  0.28,
    "ema_stack":  0.24,
    "momentum":   0.20,
    "weekly":     0.15,
    "volume":     0.08,
    "volatility": 0.05,
}

# ─────────────────────────────────────────────────────────────────────────────
#  INDICATORS  (recomputed from OHLCV to mirror the backend columns)
# ─────────────────────────────────────────────────────────────────────────────
def _ema(s, n):  return s.ewm(span=n, adjust=False).mean()

def _rsi(s, n=14):
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).fillna(50)

def _atr(df, n=14):
    h, l, c = df["High"], df["Low"], df["Close"]
    pc = c.shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1/n, adjust=False).mean()          # Wilder ATR

def _map5(x10):
    """Map a 0-10 sub-score to the 1-5 factor scale."""
    return 1.0 + float(np.clip(x10, 0, 10)) * 0.4


# ─────────────────────────────────────────────────────────────────────────────
#  1. EMA STACK  (20 / 50 / 200)
# ─────────────────────────────────────────────────────────────────────────────
def f_ema_stack(C, e20, e50, e200):
    p = C.iloc[-1]; a, b, c = e20.iloc[-1], e50.iloc[-1], e200.iloc[-1]
    if p > a > b > c:            return 5.0     # above all three, stacked in order
    if p > b and p > c:          return 4.0     # above the two key lines
    if p > c:                    return 3.0     # above the 200 only
    if p > b:                    return 2.0     # recovering, still under the 200
    return 1.0                                  # broken


# ─────────────────────────────────────────────────────────────────────────────
#  2. STRUCTURE  (staircase + fresh-high)   [validated ~1pt vs the user's eye]
# ─────────────────────────────────────────────────────────────────────────────
def f_structure(df, win=120, k=3, age_stale=65.0, dd_far=0.20):
    H = df["High"].values[-win:]; L = df["Low"].values[-win:]; C = df["Close"].values[-win:]
    N = len(C); price = float(C[-1])
    sh = [(j, float(H[j])) for j in range(k, N - k) if H[j] >= H[j - k:j + k + 1].max()]   # swing highs
    sl = [(j, float(L[j])) for j in range(k, N - k) if L[j] <= L[j - k:j + k + 1].min()]   # swing lows
    def dirn(sw):
        if len(sw) < 2: return 0.0
        mid = np.median([j for j, _ in sw])
        old = [v for j, v in sw if j <= mid]; rec = [v for j, v in sw if j > mid]
        return (np.mean(rec) - np.mean(old)) / price if old and rec else 0.0
    A = float(np.clip(0.5 + (dirn(sh) + dirn(sl)) * 7.0, 0, 1))            # staircase up-ness
    pk = int(np.argmax(H)); peak = float(H[pk]); age = N - 1 - pk; dd = (peak - price) / peak
    fresh = float(np.clip(1 - age / age_stale, 0, 1))
    near = float(np.clip(1 - dd / dd_far, 0, 1))
    B = 0.5 * fresh + 0.5 * near                                          # high fresh & close
    s01 = max(0.5 * A + 0.5 * B, 0.85 * B)     # a fresh near-high can't be dragged down by a choppy staircase
    return _map5(2.0 + 8.0 * s01)


# ─────────────────────────────────────────────────────────────────────────────
#  3. MOMENTUM  (RSI floor+divergence  x  MACD crossover+accel, matrix-combined)
# ─────────────────────────────────────────────────────────────────────────────
def _diverge(price, R, k=3, look=45):
    n = len(price)
    ph = [(j, price[j]) for j in range(max(k, n - look), n - k) if price[j] >= price[j - k:j + k + 1].max()]
    pl = [(j, price[j]) for j in range(max(k, n - look), n - k) if price[j] <= price[j - k:j + k + 1].min()]
    bear = len(ph) >= 2 and ph[-1][1] > ph[-2][1] * 1.005 and R[ph[-1][0]] < R[ph[-2][0]] - 2
    bull = len(pl) >= 2 and pl[-1][1] < pl[-2][1] * 0.995 and R[pl[-1][0]] > R[pl[-2][0]] + 2
    return bool(bear), bool(bull)

def f_momentum(C, R, macd_line, macd_hist):
    r = R.values; price = C.values
    floor = float(np.min(r[-25:])); rsi01 = float(np.clip((floor - 25) / 25.0, 0, 1))   # range-rule regime
    bear_div, bull_div = _diverge(price, r)                                              # RSI vs PRICE
    h = macd_hist.values; line = macd_line.values
    m01 = 0.5
    m01 += 0.25 if h[-1] > 0 else -0.25              # above/below signal (crossover state)
    m01 += 0.15 if h[-1] > h[-3] else -0.15         # histogram rising (accelerating)?
    m01 += 0.10 if line[-1] > 0 else -0.10          # MACD above/below zero
    m01 = float(np.clip(m01, 0, 1))
    combined = 0.5 * m01 + 0.5 * rsi01 - 0.30 * abs(m01 - rsi01)     # matrix: conviction on agree, caution on disagree
    if bear_div: combined = min(combined, 0.28)     # real exhaustion warning
    if bull_div: combined = max(combined, 0.42)     # bottoming
    combined = float(np.clip(combined, 0, 1))
    return _map5(1.5 + 8.5 * combined)


# ─────────────────────────────────────────────────────────────────────────────
#  4. WEEKLY TREND  (real weekly: consecutive HH+HL streak)
# ─────────────────────────────────────────────────────────────────────────────
def f_weekly(df):
    wk = df.resample("W-FRI").agg({"High": "max", "Low": "min", "Close": "last"}).dropna()
    if len(wk) < 5: return 3.0
    H, L, C = wk["High"].values, wk["Low"].values, wk["Close"].values
    n = len(H)
    up_streak = 0
    for i in range(n - 1, 0, -1):
        hh = H[i] > H[i - 1] * 1.001; hl = L[i] > L[i - 1] * 0.999
        inside = H[i] <= H[i - 1] and L[i] >= L[i - 1]      # inside week = pause, doesn't break the streak
        if hh and hl:   up_streak += 1
        elif inside:    continue
        else:           break
    down_streak = 0
    for i in range(n - 1, 0, -1):
        if L[i] < L[i - 1] * 0.999:  down_streak += 1        # consecutive lower lows
        else:                        break
    broke_low = C[-1] < L[-2]                                # closed below last week's low (genuine breakdown)
    if up_streak >= 3:               return 5.0
    if up_streak == 2:               return 4.0
    if down_streak >= 2:             return 1.0
    if broke_low or down_streak >= 1: return 2.0
    return 3.0


# ─────────────────────────────────────────────────────────────────────────────
#  5. VOLUME  (VWAP control + money-flow, block-capped)
# ─────────────────────────────────────────────────────────────────────────────
def f_volume(df, flow_n=15):
    C = df["Close"].values; V = df["Volume"].values; H = df["High"].values; L = df["Low"].values
    tp = (H + L + C) / 3
    vwap = (tp[-20:] * V[-20:]).sum() / V[-20:].sum()
    price = C[-1]
    control = float(np.clip(0.5 + (price / vwap - 1) * 10, 0, 1))          # price vs VWAP20
    med = np.median(V[-40:]); Vc = np.minimum(V, 3 * med)                   # block-deal cap
    Hn, Ln, Cn, Vn = H[-flow_n:], L[-flow_n:], C[-flow_n:], Vc[-flow_n:]
    rng = np.where(Hn > Ln, Hn - Ln, np.nan)
    mfm = np.nan_to_num(((Cn - Ln) - (Hn - Cn)) / rng)                      # close-in-range, -1..+1
    acc = float((mfm * Vn).sum() / Vn.sum())                               # money-flow ratio
    flow = float(np.clip(0.5 + acc, 0, 1))
    drying = V[-5:].mean() < V[-20:].mean() * 0.9
    if control < 0.5 and drying and acc > -0.20:                           # dip below VWAP on dry volume = healthy pullback
        control = max(control, 0.45)
    return _map5((0.5 * control + 0.5 * flow) * 10)


# ─────────────────────────────────────────────────────────────────────────────
#  6. VOLATILITY  (soft: ATR coil/wild, softened by India VIX). Rarely penalises.
# ─────────────────────────────────────────────────────────────────────────────
def f_volatility(df, atrpct, atrpct_med, vix=None):
    r_now = atrpct.iloc[-1]; med = atrpct_med.iloc[-1]
    up = df["Close"].iloc[-1] > _ema(df["Close"], 50).iloc[-1]
    if np.isnan(med) or med == 0: return 3.0
    r = r_now / med
    if   r < 0.70 and up:  base = 5.0     # tight coil in an uptrend
    elif r < 0.85 and up:  base = 4.0     # contracting in an uptrend
    elif r > 1.60:         base = 2.0     # genuinely wild (the ONLY penalty tier)
    else:                  base = 3.0     # wide neutral default (most stocks land here)
    # India VIX only ever HELPS (soften unfair penalties / reward composure) - never adds a penalty
    if vix is not None:
        vix_fear = vix > 18.0             # market fearful
        if base == 2.0 and vix_fear:  base = 3.0     # wild, but the whole market is wild -> not the stock's fault
        if base >= 4.0 and vix_fear:  base = 5.0     # coiling calm while others panic = composure
    return base


# ─────────────────────────────────────────────────────────────────────────────
#  ASSEMBLE  ->  0-100
# ─────────────────────────────────────────────────────────────────────────────
def _band(t):
    return ("Strong" if t >= 75 else "Constructive" if t >= 60 else "Neutral" if t >= 45
            else "Weak" if t >= 30 else "Broken")

def score(df, vix=None):
    """df: daily OHLCV (columns Open/High/Low/Close/Volume), oldest->newest. Returns dict."""
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    if len(df) < 210:
        return {"score": None, "band": "n/a", "reason": "need >=210 daily bars", "factors": {}}
    C = df["Close"]
    e20, e50, e200 = _ema(C, 20), _ema(C, 50), _ema(C, 200)
    R = _rsi(C)
    m_line = _ema(C, 12) - _ema(C, 26); m_sig = _ema(m_line, 9); m_hist = m_line - m_sig
    atr = _atr(df); atrpct = atr / C; atrpct_med = atrpct.rolling(120, min_periods=40).median()

    factors = {
        "structure":  f_structure(df),
        "ema_stack":  f_ema_stack(C, e20, e50, e200),
        "momentum":   f_momentum(C, R, m_line, m_hist),
        "weekly":     f_weekly(df),
        "volume":     f_volume(df),
        "volatility": f_volatility(df, atrpct, atrpct_med, vix),
    }
    tw = sum(WEIGHTS.values())
    raw = sum(WEIGHTS[k] * factors[k] for k in WEIGHTS) / tw       # weighted avg on the 1-5 scale
    t = int(round((raw - 1.0) / 4.0 * 100))                        # map 1->0, 3->50, 5->100
    t = int(min(100, max(0, t)))
    return {"score": t, "band": _band(t), "raw": round(raw, 2),
            "factors": {k: round(v, 2) for k, v in factors.items()}}


# ─────────────────────────────────────────────────────────────────────────────
#  demo / smoke test
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys, warnings
    warnings.filterwarnings("ignore"); sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    import yfinance as yf
    # India VIX (market context for the Volatility factor)
    try:
        vd = yf.download("^INDIAVIX", period="1mo", interval="1d", progress=False)
        vix = float(vd["Close"].dropna().iloc[-1])
    except Exception:
        vix = None
    print("India VIX:", vix)
    syms = sys.argv[1:] or ["TITAN", "CUPID", "DIXON", "GRAPHITE", "PIRAMALFIN",
                            "ITC", "RELIANCE", "TATASTEEL", "BEL", "SUZLON"]
    print(f"{'stock':11} {'T':>4} {'band':13} | struc ema mom wkly vol volt")
    print("-" * 62)
    for s in syms:
        try:
            d = yf.download(s + ".NS", period="2y", interval="1d", progress=False, auto_adjust=True)
            d.columns = [c[0] if isinstance(c, tuple) else c for c in d.columns]
            r = score(d, vix=vix)
            if r["score"] is None: print(f"{s:11}  {r['reason']}"); continue
            f = r["factors"]
            print(f"{s:11} {r['score']:>4} {r['band']:13} | "
                  f"{f['structure']:>5} {f['ema_stack']:>3} {f['momentum']:>3} "
                  f"{f['weekly']:>4} {f['volume']:>3} {f['volatility']:>4}")
        except Exception as e:
            print(f"{s:11} ERR {str(e)[:40]}")
