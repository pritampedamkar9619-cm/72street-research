# Running the Market Desk on AWS: what the server needs

For the tech team. Everything below is settings and one-time commands; no code changes are needed.
Nothing secret is in this file: keys go in the environment or in `data/*.env` files, which Git ignores.

## 1. Keep `data/` on persistent storage (fix list 48)

The server keeps everything it learns in `./data`: page caches, the track record logs, price history, option
history, margin settings, user accounts, feedback. If `data/` is wiped on each deploy, the track record loses days and
every page starts cold.

- Mount a persistent volume (EBS or EFS) at `<app>/data`.
- Deploys must replace code only, never `data/`.
- Back the volume up daily (it holds `users.json`, `focus_log.json`, `v3_log.json`, `v4_log.json`: the record cannot be rebuilt).

## 2. Run it all day, every day

The server writes the track record and builds every stock page overnight. It must stay up 24/7, including weekends.
Restart on failure (systemd `Restart=always`, or the container's restart policy). Set the clock to India time or leave it:
`server.py` sets `TZ=IST-5:30` at start.

## 3. Watch it (fix list 49)

- **Uptime monitor:** call `GET /api/health` every 5 minutes. Alert when `status` is `degraded`; the `problems` list says
  what is wrong in plain words (NSE data failing, the evening log missing, VIX history stale, Upstox token dead, ...).
- **Every morning at 8:30 am:** run `python tools/smoke_test.py https://<site>`. It opens all 25 pages' data and exits with
  code 1 if any fails. Alert on a non-zero exit.
- **Email alerts:** point the uptime monitor's alert at the team's email (CloudWatch alarm + SNS, or any uptime service).
  The app itself does not need mail settings.

## 4. Check NSE and Yahoo can be reached from AWS (fix list 46)

NSE and Yahoo both block many cloud addresses. From the server, during market hours:

```
curl -s -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0" https://www.nseindia.com/api/marketStatus
python tools/smoke_test.py http://127.0.0.1:8772
```

- If NSE answers 403 or times out: run the server in the Mumbai region (ap-south-1) and, if still blocked, give it a
  fixed outbound address (NAT gateway with an Elastic IP). A licensed data feed (fix list 42) removes the problem.
- If Yahoo fails: nothing to do. Stock prices fall back to our own NSE history (`nsehist.py`).

## 5. One-time data to copy or build

These are built from public exchange files and are not in Git. Either copy them from the current server's `data/`
folder, or build them on the new server:

| File | What it is | Build it |
|---|---|---|
| `data/optpack_NIFTY.npz`, `_BANKNIFTY`, `_SENSEX` | Strategy Builder prices since 2019 | copy (built from the research archive); then they update themselves every evening |
| `data/index_mood_stats.json` | Index Mood's history | rebuilt monthly by the server from the files above |
| `data/span_params.json` | NSE margin settings, one a month since 2019 | `python tools/span_params.py` (about 30 minutes) |
| `data/nsehist/` | two years of daily stock prices (Yahoo's backup) | `python nsehist.py` (about 20 minutes) |
| `data/vix_hist.json`, `data/idx_*.json` | India VIX and index closes | build themselves on first use |
| `data/structure_stats.json` | the price structure test | `python structure_test.py`, or copy |

After that the server keeps all of them current: option prices and stock prices every weekday evening at 6:45 pm,
margin settings monthly, Index Mood history monthly.

## 6. Settings (environment or `data/*.env`, never in Git)

| Setting | Where | What for |
|---|---|---|
| `ADMIN_TOKEN` | environment | the desk calls page and the Upstox renewal link; keep it stable |
| `UPSTOX_API_KEY`, `UPSTOX_API_SECRET` | `data/upstox.env` | live market data |
| `UPSTOX_REDIRECT_URI` | `data/upstox.env` (optional) | defaults to `<site>/upstox/callback`; register the same URL in the Upstox developer console |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` | `data/telegram.env` | watchlist alerts on Telegram; create the bot with BotFather |

**Upstox, daily:** SEBI requires the account holder to log in once a day. They open
`https://<site>/upstox/login?key=<ADMIN_TOKEN>` on their phone and sign in; the server saves the day's token itself.
The health check says when it is needed.

## 7. Search and sharing

`/sitemap.xml` and `/robots.txt` are served by the app. Behind a load balancer, pass `Host` and `X-Forwarded-Proto` so
canonical links read `https://<your domain>/...`. Submit the sitemap in Google Search Console once the domain is live.
See `SEO_NOTE.md`.
