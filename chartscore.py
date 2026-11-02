"""Chart strength: the Venty Technical Score v3, used exactly as it is in ../Verdict logic.

Loaded by file path so nothing in that folder shadows modules here, and nothing there is changed.
It describes how a chart looks today. Whether it predicts anything is being measured in the
track record (data/v3_log.json), not assumed."""
import importlib.util, os

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(ROOT), "Verdict logic", "technical_engine_v3.py")
_mod = None

NAMES = {"structure": "Price structure", "ema_stack": "Moving averages", "momentum": "Momentum",
         "weekly": "Weekly trend", "volume": "Volume", "volatility": "Volatility"}


def _engine():
    global _mod
    if _mod is None:
        spec = importlib.util.spec_from_file_location("venty_tech_v3", SRC)
        _mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_mod)
    return _mod


def describe(f):
    """Plain words from the six factor ratings (1 to 5)."""
    strong = [NAMES[k].lower() for k, v in f.items() if v >= 4 and k != "volatility"]
    weak = [NAMES[k].lower() for k, v in f.items() if v <= 2 and k != "volatility"]
    j = lambda xs: xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]
    parts = []
    if strong:
        parts.append(f"{j(strong)} {'look' if len(strong) > 1 else 'looks'} strong")
    if weak:
        parts.append(f"{j(weak)} {'look' if len(weak) > 1 else 'looks'} weak")
    if not parts:
        return "Nothing stands out either way; every part of the chart is middling."
    s = "; ".join(parts) + "."
    return s[0].upper() + s[1:]


def score_df(df, vix=None):
    try:
        r = _engine().score(df, vix=vix)
    except Exception:
        return None
    if r.get("score") is None:
        return None
    return {"score": r["score"], "band": r["band"], "factors": r["factors"], "text": describe(r["factors"])}


def score_candles(candles, vix=None):
    import pandas as pd
    if not candles or len(candles) < 210:
        return None
    df = pd.DataFrame([{"Open": c["o"], "High": c["h"], "Low": c["l"], "Close": c["c"], "Volume": c.get("v", 0)} for c in candles],
                      index=pd.to_datetime([c["t"] for c in candles], unit="s"))
    return score_df(df, vix)
