"""Intraday recorder: option chains for a few symbols every 5 minutes in market hours, saved to disk,
so the live option features can be built and tested on real intraday history before the licensed feed arrives.

data/rec/YYYY-MM-DD/SYM.jsonl, one line per snapshot:
  {"t": epoch, "spot": .., "exp": {expiry: [[strike, ce_oi, ce_chg, ce_ltp, ce_vol, ce_iv, pe_oi, pe_chg, pe_ltp, pe_vol, pe_iv], ...]}}
data/rec/YYYY-MM-DD/SYM_1m.json: the day's 1-minute candles of the underlying (Yahoo), saved after the close.
data/ is not in git."""
import json, os, time, traceback
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(ROOT, "data", "rec")
SYMS = ["NIFTY", "BANKNIFTY", "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "SBIN"]
EVERY = 300          # seconds between snapshots
STATE = {"last": None, "snaps": 0, "errors": 0}


def _day_dir(d=None):
    p = os.path.join(REC, (d or datetime.now()).strftime("%Y-%m-%d"))
    os.makedirs(p, exist_ok=True)
    return p


def snapshot(nse, chain_rows):
    """One pass over SYMS: the two nearest expiries' full chains."""
    now = time.time()
    for sym in SYMS:
        try:
            exps = (nse.contract_info(sym).get("expiryDates") or [])[:2]
            line = {"t": int(now), "spot": None, "exp": {}}
            for exp in exps:
                spot, _, rows = chain_rows(nse.option_chain(sym, exp, ttl=60))
                line["spot"] = line["spot"] or spot
                line["exp"][exp] = [[r["k"], r["CE"]["oi"], r["CE"]["chg"], r["CE"]["ltp"], r["CE"]["vol"], r["CE"]["iv"],
                                     r["PE"]["oi"], r["PE"]["chg"], r["PE"]["ltp"], r["PE"]["vol"], r["PE"]["iv"]] for r in rows]
            if line["exp"]:
                with open(os.path.join(_day_dir(), f"{sym}.jsonl"), "a", encoding="utf8") as f:
                    f.write(json.dumps(line, separators=(",", ":")) + "\n")
                STATE["snaps"] += 1
        except Exception:
            STATE["errors"] += 1
            traceback.print_exc()
    STATE["last"] = datetime.now().strftime("%H:%M")


def save_minutes(yahoo, yf_symbol):
    """After the close: the day's 1-minute candles of each underlying (Yahoo keeps about 7 days of them)."""
    for sym in SYMS:
        try:
            bars = yahoo.history(yf_symbol(sym), period="7d", interval="1m", ttl=600)
            by_day = {}
            for b in bars:
                by_day.setdefault(datetime.fromtimestamp(b["t"]).strftime("%Y-%m-%d"), []).append(b)
            for day, rows in by_day.items():
                p = os.path.join(REC, day, f"{sym}_1m.json")
                if not os.path.exists(p):
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    json.dump(rows, open(p, "w", encoding="utf8"))
        except Exception:
            traceback.print_exc()


def job(nse, chain_rows, yahoo, yf_symbol, is_open):
    """Runs forever in the server: snapshots every 5 minutes while the market is open, minutes once after the close."""
    time.sleep(60)
    saved_for = None
    save_minutes(yahoo, yf_symbol)               # the last 7 days of 1-minute candles, right away
    while True:
        try:
            now = datetime.now()
            mins = now.hour * 60 + now.minute
            if is_open() and 555 <= mins <= 930:
                snapshot(nse, chain_rows)
            elif mins > 975 and saved_for != now.date():
                save_minutes(yahoo, yf_symbol); saved_for = now.date()
                try:                             # every F&O stock's 1-minute and 5-minute candles, so the history keeps growing
                    import intraday_store as IS
                    IS.update(log=lambda m: None)
                except Exception:
                    traceback.print_exc()
        except Exception:
            traceback.print_exc()
        time.sleep(EVERY)
