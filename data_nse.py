"""Data layer. Every outside fetch goes through here, so moving to a licensed
feed later means replacing this file and nothing else.

Sources today: NSE public website endpoints (delayed, throttled) and Yahoo
Finance via yfinance (delayed). Each call is cached with its own lifetime."""
import threading, time, json, os
from collections import defaultdict
import requests

DISK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "nse_cache")
os.makedirs(DISK, exist_ok=True)
NO_DISK = ("/api/option-chain-v3", "/api/corporate-announcements")   # big or per stock: not worth keeping on disk


def _disk_path(key):
    import hashlib
    return os.path.join(DISK, hashlib.md5(key.encode()).hexdigest() + ".json")


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
BASE = "https://www.nseindia.com"


class NSE:
    """Calls are paced (one may start every min_gap seconds) but not queued: a slow or failing call
    holds up only the visitors waiting for that same answer, never everyone else."""
    def __init__(self, min_gap=0.35):
        self.slot = threading.Lock()                  # guards only the pacing clock
        self.keys = defaultdict(threading.Lock)       # one fetch per answer, however many visitors want it
        self.wlock = threading.Lock()                 # one session warm-up at a time
        self.flight = threading.BoundedSemaphore(4)   # never more than four calls open at NSE
        self.min_gap = min_gap
        self.last = 0.0
        self.s = None
        self.warmed = 0.0
        self.cache = {}
        self.ok = {}          # path -> time of last good answer
        self.fail = {}        # path -> time of last failure
        self.wrote = {}       # key -> time last saved to disk

    def _save(self, key, path, data):
        if path.startswith(NO_DISK) or time.time() - self.wrote.get(key, 0) < 60:
            return
        try:
            f = _disk_path(key)
            json.dump({"ts": time.time(), "key": key, "data": data}, open(f + ".tmp", "w", encoding="utf8"))
            os.replace(f + ".tmp", f)
            self.wrote[key] = time.time()
        except Exception:
            pass

    def _load(self, key):
        """Last good answer from disk, so a restart or an NSE block shows old data, not an error."""
        try:
            d = json.load(open(_disk_path(key), encoding="utf8"))
            if time.time() - d["ts"] < 7 * 86400:
                return d["ts"], d["data"]
        except Exception:
            pass
        return None

    def _session(self):
        s = self.s
        if s is not None and time.time() - self.warmed <= 600:
            return s
        with self.wlock:
            if self.s is None or time.time() - self.warmed > 600:
                s = requests.Session()
                s.headers.update({"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                                  "Accept-Language": "en-US,en;q=0.9", "Referer": BASE + "/option-chain"})
                for path in ("/", "/option-chain"):
                    try:
                        s.get(BASE + path, timeout=10)
                    except requests.RequestException:
                        pass
                self.s, self.warmed = s, time.time()
            return self.s

    def _pace(self):
        with self.slot:
            now = time.time()
            start = max(now, self.last + self.min_gap)
            self.last = start
        if start > now:
            time.sleep(start - now)

    def get(self, path, params=None, ttl=60):
        key = path + json.dumps(params or {}, sort_keys=True)
        hit = self.cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        with self.keys[key]:
            hit = self.cache.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
            if hit and time.time() - self.fail.get(path, 0) < 60:
                return hit[1]                  # NSE failed this a moment ago: show the last answer, do not pile on
            last_err = None
            for attempt in range(2):
                self._pace()
                s = self._session()
                try:
                    with self.flight:
                        r = s.get(BASE + path, params=params, timeout=10)
                    if r.status_code in (401, 403):
                        if self.s is s:
                            self.s = None      # cookies expired, warm a new session
                        continue
                    r.raise_for_status()
                    data = r.json()
                    self.cache[key] = (time.time(), data)
                    self.ok[path] = time.time()
                    self._save(key, path, data)
                    return data
                except (requests.RequestException, ValueError) as e:
                    last_err = e
                    if self.s is s:
                        self.s = None
                    time.sleep(0.5)
            self.fail[path] = time.time()
            if hit:                            # serve stale rather than nothing
                return hit[1]
            disk = None if path.startswith(NO_DISK) else self._load(key)
            if disk:
                self.cache[key] = (time.time() - ttl + 30, disk[1])   # retry NSE again in 30 seconds
                return disk[1]
            raise RuntimeError(f"NSE {path} failed: {last_err}")

    # ---- endpoints -------------------------------------------------------
    def all_indices(self):      return self.get("/api/allIndices", ttl=45)
    def market_status(self):    return self.get("/api/marketStatus", ttl=45)
    def fii_dii(self):          return self.get("/api/fiidiiTradeReact", ttl=900)
    def variations(self, kind): return self.get("/api/live-analysis-variations", {"index": kind}, ttl=90)
    def high52(self):           return self.get("/api/live-analysis-data-52weekhighstock", ttl=300)
    def low52(self):            return self.get("/api/live-analysis-data-52weeklowstock", ttl=300)
    def oi_spurts(self):        return self.get("/api/live-analysis-oi-spurts-underlyings", ttl=90)
    def oi_contracts(self):     return self.get("/api/live-analysis-oi-spurts-contracts", ttl=90)
    def fno_list(self):         return self.get("/api/master-quote", ttl=86400)
    def events(self):           return self.get("/api/event-calendar", ttl=21600)
    def contract_info(self, sym): return self.get("/api/option-chain-contract-info", {"symbol": sym}, ttl=3600)

    def option_chain(self, sym, expiry, ttl=55):
        typ = "Indices" if sym in INDEX_SYMBOLS else "Equity"
        return self.get("/api/option-chain-v3", {"type": typ, "symbol": sym, "expiry": expiry}, ttl=ttl)


INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}

YF_MAP = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
          "MIDCPNIFTY": "NIFTY_MID_SELECT.NS", "NIFTYNXT50": "^NSMIDCP"}


def yf_symbol(sym):
    return YF_MAP.get(sym, sym + ".NS")


class Yahoo:
    """Candles and global prices. Cached; yfinance is slow and rate limited."""
    def __init__(self):
        self.cache = {}
        self.keys = defaultdict(threading.Lock)       # one download per answer; different answers run side by side
        self.flight = threading.BoundedSemaphore(4)

    def _cached(self, key, ttl, fn):
        hit = self.cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        with self.keys[key], self.flight:
            hit = self.cache.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
            try:
                val = fn()
            except Exception:
                if hit:
                    return hit[1]
                raise
            self.cache[key] = (time.time(), val)
            return val

    def history(self, ticker, period="6mo", interval="1d", ttl=600):
        import yfinance as yf
        def fn():
            df = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=False)
            if df is None or df.empty:
                return []
            out = []
            for ts, r in df.iterrows():
                if r["Close"] != r["Close"]:         # Yahoo sends a blank row for a day with no trade yet
                    continue
                out.append({"t": int(ts.timestamp()), "o": float(r["Open"]), "h": float(r["High"]),
                            "l": float(r["Low"]), "c": float(r["Close"]), "v": float(r.get("Volume", 0) or 0)})
            return out
        return self._cached(("h", ticker, period, interval), ttl, fn)

    def batch_daily(self, tickers, period="3mo", ttl=21600):
        import yfinance as yf
        def fn():
            df = yf.download(list(tickers), period=period, interval="1d", group_by="ticker",
                             auto_adjust=False, progress=False, threads=True)
            out = {}
            for t in tickers:
                try:
                    sub = df[t].dropna(how="all")
                except KeyError:
                    continue
                if sub.empty:
                    continue
                out[t] = [{"t": int(ts.timestamp()), "o": float(r["Open"]), "h": float(r["High"]),
                           "l": float(r["Low"]), "c": float(r["Close"]), "v": float(r["Volume"] or 0)}
                          for ts, r in sub.iterrows() if r["Close"] == r["Close"]]
            return out
        return self._cached(("b", tuple(sorted(tickers)), period), ttl, fn)


nse = NSE()
yahoo = Yahoo()
