"""Upstox market-data client: read-only. Only quote, candle, option-chain and feed endpoints are called here;
nothing in this project places, modifies or reads orders.

Credentials come from data/upstox.env (gitignored), never from code or chat:
    UPSTOX_API_KEY=...
    UPSTOX_API_SECRET=...
    UPSTOX_ACCESS_TOKEN=...      # the daily token, valid until about 3:30 am the next day
"""
import gzip, json, os, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(ROOT, "data", "upstox")
ENV = os.path.join(ROOT, "data", "upstox.env")
UA = "72street-desk/1.0"          # Upstox's Cloudflare blocks the default Python agent
INDICES = {"NIFTY": "NSE_INDEX|Nifty 50", "BANKNIFTY": "NSE_INDEX|Nifty Bank", "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
           "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT", "NIFTYNXT50": "NSE_INDEX|Nifty Next 50", "INDIAVIX": "NSE_INDEX|India VIX"}


def env():
    return dict(l.strip().split("=", 1) for l in open(ENV, encoding="utf8") if "=" in l and not l.startswith("#"))


class Limiter:
    """Keeps under Upstox's standard limits (50/s, 500/min, 2000/30 min) with room to spare."""
    def __init__(self, per_min=300, per_30=1800):
        self.t, self.lock, self.per_min, self.per_30 = [], threading.Lock(), per_min, per_30

    def wait(self):
        while True:
            with self.lock:
                now = time.time()
                self.t = [x for x in self.t if now - x < 1800]
                if sum(1 for x in self.t if now - x < 60) < self.per_min and len(self.t) < self.per_30 and \
                        sum(1 for x in self.t if now - x < 1) < 20:
                    self.t.append(now); return
            time.sleep(0.25)


LIMIT = Limiter()


def get(path, params=None, tries=4):
    url = path if path.startswith("http") else "https://api.upstox.com" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    h = {"Authorization": "Bearer " + env()["UPSTOX_ACCESS_TOKEN"], "Accept": "application/json", "User-Agent": UA}
    for i in range(tries):
        LIMIT.wait()
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30))
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode("utf8", "replace")
            if e.code == 429 or e.code >= 500:
                time.sleep(5 * (i + 1)); continue
            raise RuntimeError(f"Upstox {e.code} on {path}: {body}")
        except (urllib.error.URLError, TimeoutError):
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"Upstox: gave up on {path}")


def instruments(max_age_h=12):
    """NSE instrument master (equities, indices, futures, options), refreshed twice a day."""
    os.makedirs(DIR, exist_ok=True)
    p = os.path.join(DIR, "NSE_instruments.json")
    if not os.path.exists(p) or time.time() - os.path.getmtime(p) > max_age_h * 3600:
        r = urllib.request.urlopen(urllib.request.Request("https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
                                                          headers={"User-Agent": UA}), timeout=120)
        json.dump(json.loads(gzip.decompress(r.read())), open(p + ".tmp", "w"))
        os.replace(p + ".tmp", p)
    return json.load(open(p))


def universe(ins=None):
    """F&O underlyings: {sym: {"eq": key, "futs": [(expiry_ms, key), ...] nearest first}} plus the indices."""
    ins = ins or instruments()
    now = time.time() * 1000
    u = {}
    for d in ins:
        if d.get("segment") == "NSE_FO" and d.get("instrument_type") == "FUT" and d.get("expiry", 0) > now:
            s = d["underlying_symbol"]
            x = u.setdefault(s, {"eq": d.get("underlying_key"), "futs": [], "type": d.get("underlying_type")})
            x["futs"].append((d["expiry"], d["instrument_key"]))
    for x in u.values():
        x["futs"].sort()
    return u


def options(ins, underlying, expiry_ms=None):
    """Option contracts of one underlying: nearest expiry unless given. [(strike, 'CE'/'PE', key)]"""
    now = time.time() * 1000
    rows = [d for d in ins if d.get("segment") == "NSE_FO" and d.get("instrument_type") in ("CE", "PE")
            and d.get("underlying_symbol") == underlying and d.get("expiry", 0) > now]
    if not rows:
        return None, []
    exp = expiry_ms or min(d["expiry"] for d in rows)
    return exp, sorted((d["strike_price"], d["instrument_type"], d["instrument_key"]) for d in rows if d["expiry"] == exp)


def ltp(keys):
    out = {}
    for i in range(0, len(keys), 450):
        d = get("/v2/market-quote/ltp", {"instrument_key": ",".join(keys[i:i + 450])}).get("data", {})
        for v in d.values():
            out[v["instrument_token"]] = v["last_price"]
    return out


def token_ok():
    try:
        return get("/v2/user/profile").get("status") == "success"
    except Exception:
        return False


def candles_1m(key, to_date, from_date):
    """1-minute candles between two dates (at most about a month per call): [[t, o, h, l, c, v, oi]] oldest first."""
    q = urllib.parse.quote(key, safe="")
    d = get(f"/v3/historical-candle/{q}/minutes/1/{to_date}/{from_date}").get("data", {}).get("candles", [])
    out = []
    for c in d:
        t = int(datetime.fromisoformat(c[0]).timestamp())
        out.append([t, c[1], c[2], c[3], c[4], c[5], c[6] if len(c) > 6 else 0])
    return out[::-1]


def candles_1m_today(key):
    q = urllib.parse.quote(key, safe="")
    d = get(f"/v3/historical-candle/intraday/{q}/minutes/1").get("data", {}).get("candles", [])
    return [[int(datetime.fromisoformat(c[0]).timestamp()), c[1], c[2], c[3], c[4], c[5], c[6] if len(c) > 6 else 0] for c in d][::-1]


def chain(key, expiry):
    """Full option chain with OI, volume, IV and greeks. expiry as YYYY-MM-DD."""
    return get("/v2/option/chain", {"instrument_key": key, "expiry_date": expiry}).get("data", [])
