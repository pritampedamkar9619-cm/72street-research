"""User accounts for the Market Desk: email and password, a session cookie, and each member's saved state
(watchlist, journal, alerts, preferences, last visit) so it follows them from laptop to phone.

data/users.json and data/sessions.json (data/ is not in git).
Passwords: PBKDF2-SHA256, 310,000 rounds, a random salt per user. Never stored or logged in plain text.
Sessions: a random 256-bit token in an HttpOnly cookie, 30 days, deleted on log out.
Failed log-ins are limited per address and per email so passwords cannot be guessed at speed."""
import hashlib, hmac, json, os, re, secrets, threading, time

ROOT = os.path.dirname(os.path.abspath(__file__))
USERS = os.path.join(ROOT, "data", "users.json")
SESS = os.path.join(ROOT, "data", "sessions.json")
COOKIE = "s72"
DAYS = 30
ROUNDS = 310_000
LOCK = threading.Lock()
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$")
STATE_KEYS = {"watch": list, "journal": list, "alerts": dict, "malerts": dict, "prefs": dict}
MAX_STATE = 300_000                    # bytes of saved state per member
FAILS = {}                             # key -> [times of failed attempts]


def _load(p):
    try:
        return json.load(open(p, encoding="utf8"))
    except Exception:
        return {}


def _save(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(d, open(p + ".tmp", "w", encoding="utf8"))
    os.replace(p + ".tmp", p)


def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf8"), bytes.fromhex(salt), ROUNDS).hex()


def _limited(*keys):
    now = time.time()
    for k in keys:
        FAILS[k] = [t for t in FAILS.get(k, []) if now - t < 900]
        if len(FAILS[k]) >= 8:
            return True
    return False


def _fail(*keys):
    for k in keys:
        FAILS.setdefault(k, []).append(time.time())


def _new_session(email):
    tok = secrets.token_urlsafe(32)
    with LOCK:
        s = _load(SESS)
        now = time.time()
        s = {k: v for k, v in s.items() if v.get("exp", 0) > now}       # drop expired sessions while here
        s[tok] = {"email": email, "exp": now + DAYS * 86400}
        _save(SESS, s)
    return tok


def _public(u, email):
    return {"email": email, "name": u.get("name") or email.split("@")[0], "since": u.get("created"),
            "state": u.get("state") or {}, "last_seen": u.get("last_seen")}


def signup(body, ip):
    email = str(body.get("email") or "").strip().lower()
    name = re.sub(r"[^\w .'-]", "", str(body.get("name") or "")).strip()[:40]
    pw = str(body.get("password") or "")
    if not EMAIL_RE.match(email):
        return {"error": "Enter a valid email address."}, 400, None
    if len(pw) < 8:
        return {"error": "Use a password of at least 8 characters."}, 400, None
    if _limited("ip:" + ip):
        return {"error": "Too many attempts. Try again in 15 minutes."}, 429, None
    with LOCK:
        users = _load(USERS)
        if email in users:
            _fail("ip:" + ip)
            return {"error": "An account with this email already exists. Log in instead."}, 409, None
        salt = secrets.token_hex(16)
        users[email] = {"name": name, "salt": salt, "hash": _hash(pw, salt), "created": time.strftime("%Y-%m-%d"),
                        "state": {}, "last_seen": None}
        _save(USERS, users)
    return {"ok": True, "user": _public(users[email], email)}, 200, _new_session(email)


def login(body, ip):
    email = str(body.get("email") or "").strip().lower()
    pw = str(body.get("password") or "")
    if _limited("ip:" + ip, "em:" + email):
        return {"error": "Too many attempts. Try again in 15 minutes."}, 429, None
    users = _load(USERS)
    u = users.get(email)
    if not u or not hmac.compare_digest(_hash(pw, u["salt"]), u["hash"]):
        _fail("ip:" + ip, "em:" + email)
        return {"error": "That email and password do not match."}, 401, None
    return {"ok": True, "user": _public(u, email)}, 200, _new_session(email)


def logout(tok):
    if not tok:
        return
    with LOCK:
        s = _load(SESS)
        if s.pop(tok, None) is not None:
            _save(SESS, s)


def email_for(tok):
    if not tok:
        return None
    v = _load(SESS).get(tok)
    return v["email"] if v and v.get("exp", 0) > time.time() else None


def me(tok, touch=False):
    """The member's profile and saved state. touch=True records this visit and returns the one before it,
    which the terminal uses for 'since you last looked'."""
    email = email_for(tok)
    if not email:
        return None
    with LOCK:
        users = _load(USERS)
        u = users.get(email)
        if not u:
            return None
        out = _public(u, email)
        if touch:
            u["last_seen"] = int(time.time())
            _save(USERS, users)
    return out


def save_state(tok, body):
    email = email_for(tok)
    if not email:
        return {"error": "Log in to save."}, 401
    clean = {}
    for k, typ in STATE_KEYS.items():
        if k in body and isinstance(body[k], typ):
            clean[k] = body[k]
    if len(json.dumps(clean)) > MAX_STATE:
        return {"error": "Too much to save at once."}, 413
    with LOCK:
        users = _load(USERS)
        u = users.get(email)
        if not u:
            return {"error": "Log in to save."}, 401
        u["state"] = {**(u.get("state") or {}), **clean}
        _save(USERS, users)
    return {"ok": True}, 200
