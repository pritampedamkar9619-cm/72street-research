"""Watchlist alerts on Telegram, so they arrive when the site is closed.

A logged-in member taps "Get alerts on Telegram" on the Watchlist. The site gives a one-time link to our bot
(t.me/<bot>?start=<code>); opening it and pressing Start ties that Telegram chat to the member's account. From then
on the server checks the member's watchlist every few minutes in market hours (and once after the close for results)
with the same alert settings the member saved per stock on the site, and sends each alert once.
"/stop" in the chat, or "Stop Telegram alerts" on the site, unlinks it.

Settings: TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_NAME in data/telegram.env (not in Git) or in the environment.
Stored: data/tg_links.json {email: chat id} and data/tg_fired.json {email: {alert key: date sent}}.
Messages describe what happened to the stock, never what to do.
"""
import json, os, secrets, threading, time, traceback, urllib.parse, urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
LINKS, FIRED = os.path.join(DATA, "tg_links.json"), os.path.join(DATA, "tg_fired.json")
CODES, LOCK, STATE = {}, threading.Lock(), {"offset": 0, "sent": 0, "last_check": None}
ADEF = {"above": None, "below": None, "move": 4, "results": True, "levels": True, "focus": True}   # as on the site


def cfg():
    env = {}
    p = os.path.join(DATA, "telegram.env")
    if os.path.exists(p):
        env = dict(l.strip().split("=", 1) for l in open(p, encoding="utf8") if "=" in l and not l.startswith("#"))
    tok = os.environ.get("TELEGRAM_BOT_TOKEN") or env.get("TELEGRAM_BOT_TOKEN")
    name = os.environ.get("TELEGRAM_BOT_NAME") or env.get("TELEGRAM_BOT_NAME")
    return (tok, name) if tok and name else (None, None)


def enabled():
    return cfg()[0] is not None


def _j(p, d):
    try:
        return json.load(open(p, encoding="utf8"))
    except Exception:
        return d


def _save(p, v):
    json.dump(v, open(p + ".tmp", "w", encoding="utf8")); os.replace(p + ".tmp", p)


def _call(method, **params):
    tok, _ = cfg()
    req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/{method}", data=urllib.parse.urlencode(params).encode(),
                                 headers={"User-Agent": "72street-desk/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=40))


def send(chat, text):
    try:
        _call("sendMessage", chat_id=chat, text=text, disable_web_page_preview="true")
        STATE["sent"] += 1
        return True
    except Exception:
        traceback.print_exc()
        return False


# ---------------------------------------------------------------- linking an account to a chat
def link_for(email):
    """A one-time t.me link that ties the member's Telegram chat to this account (valid 15 minutes)."""
    _, name = cfg()
    code = secrets.token_urlsafe(9).replace("-", "a").replace("_", "b")
    with LOCK:
        CODES[code] = (email, time.time() + 900)
    return f"https://t.me/{name}?start={code}"


def linked(email):
    return email in _j(LINKS, {})


def unlink(email):
    with LOCK:
        L = _j(LINKS, {}); chat = L.pop(email, None); _save(LINKS, L)
    if chat:
        send(chat, "Telegram alerts from the 72 Street Market Desk are off. Turn them on again from your Watchlist.")


def poll():
    """Reads the bot's new messages: '/start <code>' links a chat, '/stop' unlinks it."""
    try:
        r = _call("getUpdates", offset=STATE["offset"], timeout=20)
    except Exception:
        return
    for u in r.get("result", []):
        STATE["offset"] = u["update_id"] + 1
        m = u.get("message") or {}
        chat, text = (m.get("chat") or {}).get("id"), (m.get("text") or "").strip()
        if not chat:
            continue
        if text.startswith("/start"):
            code = text[6:].strip()
            with LOCK:
                email, until = CODES.pop(code, (None, 0))
                if email and until > time.time():
                    L = _j(LINKS, {}); L[email] = chat; _save(LINKS, L)
            send(chat, "Done. Alerts for the stocks on your 72 Street watchlist will arrive here, using the alert settings on the site. "
                       "Send /stop to turn them off." if email and until > time.time() else
                       "That link has expired. Open your Watchlist on the 72 Street Market Desk and tap 'Get alerts on Telegram' again.")
        elif text.startswith("/stop"):
            with LOCK:
                L = _j(LINKS, {}); gone = [e for e, c in L.items() if c == chat]
                for e in gone: L.pop(e)
                _save(LINKS, L)
            send(chat, "Alerts are off.")


# ---------------------------------------------------------------- checking members' watchlists
def check(users_state, watch_rows):
    """users_state: email -> saved account state {watch, alerts}; watch_rows(list of symbols) -> the Watchlist's rows."""
    L = _j(LINKS, {})
    if not L:
        return 0
    fired = _j(FIRED, {})
    today = datetime.now().strftime("%Y-%m-%d"); n_all = 0
    for email, chat in L.items():
        stt = users_state(email) or {}
        syms = [s for s in (stt.get("watch") or []) if isinstance(s, str)][:30]
        if not syms:
            continue
        cfg_ = stt.get("alerts") or {}
        f = fired.setdefault(email, {})
        msgs = []
        def hit(key, title, body):
            if f.get(key) or len(msgs) >= 5:
                return
            f[key] = today; msgs.append(f"{title}\n{body}")
        for r in watch_rows(syms):
            if r.get("error") or not r.get("last"):
                continue
            s, a = r["sym"], {**ADEF, **(cfg_.get(r["sym"]) or {})}
            try:
                if a.get("above") and r["last"] >= float(a["above"]): hit(f"{s}|above|{a['above']}", f"{s} crossed ₹{float(a['above']):,.2f}", f"Now ₹{r['last']:,.2f}, {r.get('chg', 0):+.2f}% on the day.")
                if a.get("below") and r["last"] <= float(a["below"]): hit(f"{s}|below|{a['below']}", f"{s} fell below ₹{float(a['below']):,.2f}", f"Now ₹{r['last']:,.2f}, {r.get('chg', 0):+.2f}% on the day.")
                if a.get("move") and abs(r.get("chg") or 0) >= float(a["move"]):
                    hit(f"{s}|move|{today}", f"{s} {'up' if r['chg'] > 0 else 'down'} {abs(r['chg']):.1f}% today", ((r.get("changes") or [{}])[0] or {}).get("text") or "A bigger move than your alert level.")
                if a.get("results") and r.get("rstate") == "out" and r.get("quarter"):
                    c = next((c["text"] for c in r.get("changes", []) if "results out" in c.get("text", "")), None)
                    hit(f"{s}|res|{r['quarter']}", f"{s} {r['quarter']} results are out", c or "Open the stock page for the numbers.")
                if a.get("levels") and r.get("floor") and r["last"] < r["floor"]: hit(f"{s}|floor|{r['floor']}", f"{s} is below {r['floor']:,.0f}", "The strike with the most put positions.")
                if a.get("levels") and r.get("ceiling") and r["last"] > r["ceiling"]: hit(f"{s}|ceil|{r['ceiling']}", f"{s} is above {r['ceiling']:,.0f}", "The strike with the most call positions.")
                if a.get("focus") and r.get("in_focus"): hit(f"{s}|focus|{today}", f"{s} is in Stocks in the news", "There is a lot going on with it today. Open Today on the site to see why.")
            except (TypeError, ValueError):
                continue
        if msgs:
            first_run = not f.get("_base")
            if not first_run:                          # the first check only notes what is already true, so a new member is not flooded
                send(chat, "72 Street Market Desk\n\n" + "\n\n".join(msgs) + "\n\nWhat the data shows, not a recommendation to buy or sell.")
                n_all += len(msgs)
        f["_base"] = today
        for k in [k for k, v in f.items() if k != "_base" and v < today and ("|move|" in k or "|focus|" in k)]:
            f.pop(k, None)                               # daily alerts can fire again tomorrow
    _save(FIRED, fired)
    STATE["last_check"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    return n_all
