"""Keeps the index option history current on the server itself, so the Strategy Builder and Index Mood never go stale.

Every weekday evening (after the exchanges publish their end of day files, about 6:30 pm):
1. download each missing day's NSE and BSE F&O bhavcopy (public archives, UDiFF format) for NIFTY, BANKNIFTY, SENSEX
2. append those days to data/optpack_<SYM>.npz (the Strategy Builder's price files) without rebuilding the past
3. on the first run of each month, rebuild data/index_mood_stats.json (Index Mood's history) from the same files

The first full history (2019 onwards) is built once with tools/pack_options.py from the research archive; after that
this module only adds days. Public data only, read-only, generic User-Agent.
"""
import csv, io, json, math, os, time, traceback, urllib.error, urllib.request, zipfile
from datetime import date, datetime, timedelta
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
KEEP = {"NIFTY", "BANKNIFTY", "SENSEX"}
UA = "Mozilla/5.0 (72street-desk/1.0)"
STATUS = {"last_run": None, "added": {}, "error": None}


# ---------------------------------------------------------------- download one day
def _get(url, ref):
    for k in range(3):
        try:
            r = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Referer": ref})
            return urllib.request.urlopen(r, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403):
                return None
        except Exception:
            pass
        time.sleep(3 * (k + 1))
    return None


def _iso(s):
    s = s.strip()
    for f in ("%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, f).date().isoformat()
        except ValueError:
            pass
    return s


def _udiff(text, d):
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        s = (r.get("TckrSymb") or "").strip()
        if s not in KEEP or (r.get("FinInstrmTp") or "").strip() not in ("IDO", "IDF"):
            continue
        kind = "FUT" if r["FinInstrmTp"].strip() == "IDF" else r["OptnTp"].strip()
        num = lambda k: float(r.get(k) or 0) if str(r.get(k) or "").strip() not in ("", "-") else 0.0
        out.append({"date": d.isoformat(), "sym": s, "kind": kind, "expiry": _iso(r["XpryDt"]),
                    "strike": num("StrkPric") if kind != "FUT" else None, "close": num("ClsPric"), "settle": num("SttlmPric"),
                    "contracts": num("TtlTradgVol"), "lot": num("NewBrdLotQty")})
    return out


def fetch_day(d):
    """All index F&O rows for one trading day, or None when NSE has no file (holiday or not published yet)."""
    b = _get(f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d:%Y%m%d}_F_0000.csv.zip", "https://www.nseindia.com/")
    if not b:
        return None
    z = zipfile.ZipFile(io.BytesIO(b))
    rows = _udiff(z.read(z.namelist()[0]).decode("utf8", "ignore"), d)
    bb = _get(f"https://www.bseindia.com/download/BhavCopy/Derivative/BhavCopy_BSE_FO_0_0_0_{d:%Y%m%d}_F_0000.CSV", "https://www.bseindia.com/")
    if bb and not bb[:20].lstrip().startswith(b"<"):
        rows += _udiff(bb.decode("utf8", "ignore"), d)
    return rows


# ---------------------------------------------------------------- append days to a price pack
def _load(sym):
    p = os.path.join(DATA, f"optpack_{sym}.npz")
    return {k: v for k, v in np.load(p, allow_pickle=False).items()} if os.path.exists(p) else None


def append(sym, new_rows):
    """Adds new trading days to data/optpack_<sym>.npz. Same rules as tools/pack_options.py: near-month futures price
    per day; option price = close when traded, else settle; strikes within 20% of the futures price; up to 50 days ahead."""
    P = _load(sym)
    if P is None:
        return 0
    have = set(P["days"].tolist())
    rows = [r for r in new_rows if r["sym"] == sym and r["date"] not in have]
    if not rows:
        return 0
    days = sorted(set(P["days"].tolist()) | {r["date"] for r in rows})
    exps = sorted(set(P["exps"].tolist()) | {r["expiry"] for r in rows if r["kind"] != "FUT"})
    di, ei = {t: i for i, t in enumerate(days)}, {e: i for i, e in enumerate(exps)}
    fut = dict(zip(P["days"].tolist(), P["fut"].tolist()))
    final = {e: f for e, f in zip(P["exps"].tolist(), P["final"].tolist()) if f == f}
    lot = dict(zip(P["exps"].tolist(), P["lot"].tolist()))
    by_day = {}
    for r in rows:
        by_day.setdefault(r["date"], []).append(r)
    add = {"r_day": [], "r_exp": [], "r_k": [], "r_ce": [], "r_px": [], "r_n": []}
    for t, rs in sorted(by_day.items()):
        fs = sorted((r for r in rs if r["kind"] == "FUT" and r["expiry"] > t), key=lambda r: r["expiry"])
        if fs:
            f0 = fs[0]; fut[t] = f0["close"] or f0["settle"]
        F = fut.get(t) or (fut[max(k for k in fut if k < t)] if any(k < t for k in fut) else None)
        fut[t] = F
        sett = [r["settle"] for r in rs if r["kind"] in ("CE", "PE") and r["expiry"] == t and F and 0.5 * F < r["settle"] < 1.5 * F]
        if sett and t not in final:
            final[t] = float(np.median(sett))
        for r in rs:
            if r["kind"] not in ("CE", "PE"):
                continue
            if r["lot"]:
                lot[r["expiry"]] = int(r["lot"])
            px = r["close"] if r["contracts"] > 0 and r["close"] > 0 else r["settle"]
            dte = (date.fromisoformat(r["expiry"]) - date.fromisoformat(t)).days
            if px <= 0 or not F or dte < 0 or dte > 50 or abs(r["strike"] / F - 1) > 0.20:
                continue
            add["r_day"].append(di[t]); add["r_exp"].append(ei[r["expiry"]]); add["r_k"].append(r["strike"])
            add["r_ce"].append(r["kind"] == "CE"); add["r_px"].append(px); add["r_n"].append(int(r["contracts"]))
    # old rows keep their meaning: re-map their day / expiry indexes onto the extended lists
    od, oe = P["days"].tolist(), P["exps"].tolist()
    r_day = np.concatenate([np.array([di[od[i]] for i in P["r_day"]], dtype="int32"), np.array(add["r_day"], dtype="int32")])
    r_exp = np.concatenate([np.array([ei[oe[i]] for i in P["r_exp"]], dtype="int32"), np.array(add["r_exp"], dtype="int32")])
    ex = np.array(exps)
    months = np.array([e[:7] for e in exps])
    monthly = np.array([e == max(ex[months == m]) for e, m in zip(exps, months)])
    out = dict(days=np.array(days), fut=np.array([fut.get(t, np.nan) for t in days], dtype="float64"), exps=ex,
               final=np.array([final.get(e, np.nan) for e in exps]), lot=np.array([int(lot.get(e) or 0) for e in exps], dtype="int32"),
               monthly=monthly, r_day=r_day, r_exp=r_exp,
               r_k=np.concatenate([P["r_k"], np.array(add["r_k"], dtype="float64")]),
               r_ce=np.concatenate([P["r_ce"], np.array(add["r_ce"], dtype=bool)]),
               r_px=np.concatenate([P["r_px"], np.array(add["r_px"], dtype="float32")]),
               r_n=np.concatenate([P["r_n"], np.array(add["r_n"], dtype="int32")]))
    p = os.path.join(DATA, f"optpack_{sym}.npz")
    np.savez_compressed(p + ".tmp.npz", **out)
    os.replace(p + ".tmp.npz", p)
    return len(by_day)


# ---------------------------------------------------------------- Index Mood history, from the same files
def mood_stats():
    """Rebuilds data/index_mood_stats.json (same method as fo_platform/mood_stats.py) from the price packs and VIX history."""
    try:
        vix = json.load(open(os.path.join(DATA, "vix_hist.json"), encoding="utf8"))
    except Exception:
        return None
    vk = sorted(vix); vv = np.array([vix[k] for k in vk], dtype=float)
    lvl = {}
    for i in range(120, len(vk)):
        past = vv[max(0, i - 252):i]
        lo, hi = np.quantile(past, [1 / 3, 2 / 3])
        lvl[vk[i]] = "HIGH" if vv[i] > hi else "LOW" if vv[i] < lo else "MID"
    fri = {}
    for k in sorted(lvl):
        d = date.fromisoformat(k)
        fri[(d + timedelta(days=(4 - d.weekday()) % 7)).isoformat()] = lvl[k]     # the week's Friday; the last day of the week wins
    fk = sorted(fri); same = [fri[a] == fri[b] for a, b in zip(fk, fk[1:])]
    persist = {"all": round(float(np.mean(same)) * 100, 1), "n_weeks": len(same)}
    for m in ("LOW", "MID", "HIGH"):
        s = [fri[a] == fri[b] for a, b in zip(fk, fk[1:]) if fri[a] == m]
        persist[m] = round(float(np.mean(s)) * 100, 1) if s else None
    calm = [fri[a] != "HIGH" for a in fk]
    persist["calm_vs_nervous"] = round(float(np.mean([a == b for a, b in zip(calm, calm[1:])])) * 100, 1)
    res = {"built": date.today().isoformat(), "mood_persistence": persist, "index": {}}
    buckets = [(1, 3, "1-3 days"), (4, 7, "4-7 days"), (8, 14, "8-14 days"), (15, 35, "15-35 days")]
    for sym in ("NIFTY", "BANKNIFTY", "SENSEX"):
        P = _load(sym)
        if P is None:
            continue
        days, exps, F = P["days"], P["exps"], P["fut"]
        lr = np.diff(np.log(F)); rv = {days[i]: float(np.nanstd(lr[i - 20:i])) for i in range(20, len(days))}
        order = np.lexsort((P["r_k"], P["r_exp"], P["r_day"]))
        rd, re_, rk, rc, rp = P["r_day"][order], P["r_exp"][order], P["r_k"][order], P["r_ce"][order], P["r_px"][order]
        out = []
        for i, t in enumerate(days):
            m = rd == i
            if not m.any():
                continue
            ex_i = sorted({int(e) for e in re_[m] if exps[e] > t and np.isfinite(P["final"][e])})
            if not ex_i or not np.isfinite(F[i]):
                continue
            e = ex_i[0]; mm = m & (re_ == e)
            ks = rk[mm]; ce = rc[mm]; pxs = rp[mm]
            both = sorted(set(ks[ce]) & set(ks[~ce]))
            if not both:
                continue
            k = min(both, key=lambda x: abs(x - F[i]))
            if abs(k / F[i] - 1) > 0.02:
                continue
            M = (pxs[(ks == k) & ce][0] + pxs[(ks == k) & ~ce][0]) / F[i]
            dte = (date.fromisoformat(exps[e]) - date.fromisoformat(t)).days
            td = max(1, int(np.busday_count(t, exps[e])))
            act = abs(P["final"][e] / F[i] - 1)
            r_ = rv.get(t)
            mood = lvl.get(t) or next((lvl[x] for x in reversed(vk) if x < t and x in lvl), None)
            out.append((t, dte, M, act, act <= M, M / (r_ * math.sqrt(td)) if r_ else np.nan, mood))
        if not out:
            continue
        def summ(xs):
            if len(xs) < 30:
                return None
            return {"n": len(xs), "inside": round(float(np.mean([x[4] for x in xs])) * 100, 1),
                    "actual_vs_priced": round(float(np.median([x[3] / x[2] for x in xs])), 2), "priced_pct": round(float(np.median([x[2] for x in xs])) * 100, 2)}
        r = {"from": out[0][0], "to": out[-1][0], "by_dte": {}, "by_mood": {}, "by_rich": {}}
        for a, b, lab in buckets:
            r["by_dte"][lab] = summ([x for x in out if a <= x[1] <= b])
        for mo in ("LOW", "MID", "HIGH"):
            r["by_mood"][mo] = summ([x for x in out if x[6] == mo])
        rich = [x for x in out if np.isfinite(x[5])]
        cuts = [float(np.quantile([x[5] for x in rich], q)) for q in (1 / 3, 2 / 3)]
        r["rich_cuts"] = [round(c, 3) for c in cuts]; r["rich_median"] = round(float(np.median([x[5] for x in rich])), 3)
        r["by_rich"] = {"cheap": summ([x for x in rich if x[5] <= cuts[0]]), "fair": summ([x for x in rich if cuts[0] < x[5] < cuts[1]]),
                        "expensive": summ([x for x in rich if x[5] >= cuts[1]])}
        res["index"][sym] = r
    p = os.path.join(DATA, "index_mood_stats.json")
    json.dump(res, open(p + ".tmp", "w"), indent=1); os.replace(p + ".tmp", p)
    return res


# ---------------------------------------------------------------- the evening job
def update(log=print):
    """Adds every missing trading day since the packs end (today too, once its files are out). Returns days added per index."""
    P = _load("NIFTY")
    if P is None:
        STATUS.update(error="no price packs yet: build them once with tools/pack_options.py"); return {}
    last = date.fromisoformat(str(P["days"][-1]))
    d, rows, tried = last + timedelta(days=1), [], 0
    while d <= date.today():
        if d.weekday() < 5:
            if d == date.today() and datetime.now().hour * 60 + datetime.now().minute < 18 * 60 + 30:
                break                                      # today's files are published around 6 pm
            x = fetch_day(d); tried += 1
            if x:
                rows += x
            time.sleep(0.6)
        d += timedelta(days=1)
    added = {s: append(s, rows) for s in ("NIFTY", "BANKNIFTY", "SENSEX")} if rows else {}
    stats = _stats_age()
    if added and (stats is None or stats > 25):
        try:
            mood_stats(); log("  Index Mood history rebuilt")
        except Exception:
            traceback.print_exc()
    STATUS.update(last_run=datetime.now().strftime("%Y-%m-%d %H:%M"), added=added, error=None)
    if added:
        log(f"  F&O history: added {added} ({tried} days tried)")
    return added


def _stats_age():
    try:
        b = json.load(open(os.path.join(DATA, "index_mood_stats.json"), encoding="utf8"))["built"]
        return (date.today() - date.fromisoformat(b)).days
    except Exception:
        return None
