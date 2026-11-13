# 72 Street AI Dashboard: handover for the tech team

Plain Python server (standard library plus `requests`, `yfinance`, `pandas`, `numpy`, `scipy`, `beautifulsoup4`, `lxml`). No database. All state is files in `data/`.

## Run

    HOST=0.0.0.0 PORT=8772 PYTHONIOENCODING=utf-8 python server.py

Run one process only. Background jobs live inside it, so several workers would each hit NSE. Put nginx or a CDN in front for HTTPS. Keep `data/` on persistent disk. Allow about a minute to start.

No sibling folders are needed any more: `vendor/` holds the stock master and the chart strength engine, and `seed/seed.zip` is unpacked into `data/` on first start by `bootstrap.py`. Chart patterns still need the separate `patterns logic` folder next to this one; without it the pattern card is simply not shown.

## Check first: this is the biggest risk

NSE often blocks cloud IP ranges. Before anything else, run from the server:

    python -c "from data_nse import nse; print(nse.all_indices()['timestamp'])"

If it fails, the live data will not work from that host. Yahoo Finance may behave the same. Options are a different region, a proxy, or a licensed feed. `data_nse.py` is the single file to change for a feed.

## Monitoring

`GET /api/health` returns `status: ok` or `degraded` with `problems` and the age of each source. Point an uptime monitor at it.

## Tested locally, not on a server

- 800 simulated visitors, 366 requests a second, median 0.016s, 95% under 0.6s, no errors. Laptop, same machine, market closed.
- Replies are cached 15 seconds and gzipped. Stock pages are preloaded overnight (about 2,400). The machine must stay on after the close for nightly jobs: market scan, verdict log, pattern scan.

## Before public launch

- Data licence: NSE, Yahoo and Screener pages are scraped. This needs a decision, not code.
- Compliance read of on-page wording: see `WORDING_FOR_COMPLIANCE.md`.
- `/admin.html` is protected by the token in `data/admin_token.txt`. Keep that file private, and consider blocking the path at the proxy.
- Real device testing on Android and iPhone. Layouts were checked at 390px in Chrome only.
- `data/server.log` needs rotation in production.


## Review changes, 31 Oct 2026
- Track record shows no percentage until 30 stocks are checked. "Picks" became "readings", "Leaning up/down" became "Signals up/down". Skipped log days are named on the page.
- No bullish or bearish wording on option pages. The OI Flow gauge now reads put writers against call writers. The old radar score page redirects to Stocks.
- IV and Greeks on the F&O page use the forward implied by the options themselves, so call and put IV match at a strike.
- New endpoint /api/extra: debt to equity, interest cover, cash conversion, promoter holding, and year end P/E history. Promoter pledge comes from the NSE shareholding filing (promoter_pledge in server.py), one fetch per company per quarter, stored in data/pledge.json. Chart strength sits under "More on" on stock pages.
- Stock chart has 12 months, 5 days and Today. Former names are searchable through WAS in stockdata.py.

## Added 1 Nov 2026
- **AI mode** (`web/fx.js`, `web/fx.css`): off by default, switched on by the header button or `?fx=1`, remembered per browser. Dot field, breathing frames, ticker (`/api/pulse` every 2 min), arrivals once per page per visit, price flash on silent refresh. Disabled for reduced motion. Count-up always restores the real number within about a second.
- **Ask 72 Street** (quick search, `/` or Ctrl+K): plain English to screener filters, compare, sector or stock. Rule based in `askParse` in `app.js`, no model.
- **Screener** (`#screener`, `/api/screener`): rebuilt every 30 minutes from data already held. Sector P/E is the median of listed companies in the group.
- **Exchange filings** on stock pages (`/api/filings`): NSE announcements, last 45 days, routine paperwork filtered by `FILING_SKIP`.
- **Promoter pledge** (`promoter_pledge`): from the NSE shareholding XBRL, cached in `data/pledge.json` per quarterly filing.
- **Watchlist link** `#mine/SYM1,SYM2` imports a list. **Trading journal** page with `web/72Street_Trading_Journal.xlsx` (example uses "Stock A", no real names).
- **Chart library** now served from `web/lib/`. **Google indexing**: see `SEO_NOTE.md`.

## Load and data fixes, 2 Nov 2026 (from the pre-launch audit)
- NSE and Yahoo calls are paced, not queued: one may start every 0.35 s, at most 4 open at once, and only visitors waiting for the same answer wait on each other. A path that failed in the last minute serves its last answer instead of retrying.
- Option chains are polled each minute only for symbols opened on the Options tab, at most 12 besides Nifty and Bank Nifty. Stock pages read the chain once.
- Reply cache: the key keeps only the query values views read, so `?x=random` hits the same entry. No full wipe; old entries are dropped first. One rebuild per entry; others get the last answer (up to 5 minutes old) while it rebuilds.
- Unknown symbols get a 404 before any NSE call (`/api/stock`, `/api/filings`, `/api/options`, `/api/extra`, `/api/compare`, `/api/watch` ...).
- India time on any host: `server.py` sets `TZ=IST-5:30` at start (no timezone files needed). Railway's UTC clock no longer shifts market hours.
- Fundamentals refresh after deploy: `vendor/screener.py` is an unchanged copy of the Fundamental Engine scraper. When NSE shows a results filing that our copy lacks, the stock is re-fetched on its next visit.
- P/E, P/B, dividend yield and market value follow today's price (earnings and book value stay as reported). Skipped if the price moved more than 3x since the copy (split or bonus). Market value drives the largest-companies list and liquidity cuts.
- Static files are gzipped (app.js 200 KB to 65 KB) with browser caching; API replies carry `Cache-Control: public, max-age=15` so a CDN can sit in front.
- Measured on the dev laptop in market hours, 30 simulated visitors on random Nifty 500 stocks: stock page median 1.5 s, slowest 10% 8.3 s (was 15 s / 23 s on Nifty 100). Cold start: first Today about 50 s while the company list loads.
- Still open: memory with all 2,396 pages cached is large (cache file 44 MB on disk); peer-table P/Es are still the copied figures; the repo should be private.

## Track record scoring and Price Structure, 8 to 11 Nov 2026

Track record (server.py `api_track`, app.js `vTrack`):
- Each reading is now scored against an index of its own size (Nifty 100, Midcap 150, Smallcap 250), not Nifty 50. The headline is the gap between signals-up and signals-down readings, with a plain "could be chance" note.
- A stock repeated within 5 sessions with the same signal counts once. Lists lock at 9 pm; anything written later is marked late and not scored (23 Oct and 30 Oct were). Weekend special sessions (Muhurat) are skipped and the 8 Nov entries are labelled, not deleted.
- No result shows until 30 different stocks and 20 sessions are checked.

Price Structure (Smart Money Concepts, shown as descriptions only):
- `structure.py` is the one engine: swing points (3 bars each side, visible 3 bars late, no hindsight), break of structure, change of character, plain breaks (close beyond the level by 0.1 ATR), liquidity sweeps (swing level and previous day), order blocks (last opposite candle before a break; fresh, tested, or removed after a close through it).
- `structure_test.py` backtests the same engine on 5 years of every stock (`data/structure_bt_prices.pkl`, downloaded by a one-off script, gitignored) and writes `data/structure_stats.json` (committed). Each event's line on the site quotes this file. Re-run it after changing any rule in structure.py.
- Stock page: a "Structure" switch on the price chart (remembered per browser) draws zones, markers and the last swing lines, and adds a Price structure card. The stock page shows six months of markers; the tool page shows the year.
- Price Structure page (Stocks tab, `#structure/SYM`): big chart, card, today's counts across F&O or all stocks, and the full test table.
- The nightly all-stock scan (universe.py) now also writes `data/structure_scan.json` (today's counts) and appends events to `data/structure_log.json` after the close, so structure events can be scored in Track record later.
- Never shown: entries, stops, targets, R:R, "bullish/bearish", "institutions". Wording is in WORDING_FOR_COMPLIANCE.md, with one open question for compliance.

Price Structure follow-up (11 Nov): the stock page shows only the trend reading and order blocks; the tool page adds BoS, CHoCH and swing points as switchable layers (order blocks only by default, each with an i button). Sweeps, plain breaks and order-block retest dots are worked out but not shown. The per-event "we tested this" lines and the test table were removed from the site (one disclaimer instead) until compliance rules on quoting backtests. Backtest finding, all settings, 5 years, 2,197 stocks: hit rates 47 to 52%, up and down events within about 0.5 pts of each other at 20 sessions; no edge. Method note for whoever re-runs structure_test.py: against a size median every event looks about +1.5 to +2 pts because of right skew, and against a size mean the median stock looks behind; compare up events with down events directly, or subtract the unconditional excess, before quoting any number.

## Full site review, 11 Nov 2026
All 23 pages rendered with no console errors; every API route answers (bad symbols 404, /api/brd 401 without the code).
Fixed: OI Flow hot strikes now say the live direction ("Put OI falling now · writing over the day") instead of a day label that could contradict the speed; the flow gauge says it reads near the price; covering notes no longer call strikes on the wrong side of the price "overhead supply" or "the floor"; Expiry Tracker headline says which close it is from (it is end-of-day data, so it differs from the live Option Pulse during the session); the rupee line follows which way the rupee moved; results reactions skip weekend special sessions (the Sunday Muhurat session was being read as the reaction day; affected cards rebuild); the options-verdict table in Track record shows "too early" until 30 stocks and 20 sessions; Price Structure "today" counts say when the scan ran; Learn lists Price Structure after Compare.
Checked and not a bug: 10 Nov was a market holiday (no FII/DII figure, empty F&O file is the holiday marker); the screener's "500 of 2,361" is exact (Large 100 + Mid 150 + Small 250).
Open: first Today load after a restart takes 30 to 40 s; /api/reported sends 1.2 MB; peer medians mix company sizes (TCS dividend yield 2.6% against a 0.28% median of 74 software companies, most of them small); NIFTY IV smile shows calls above puts, worth a check; the chart strength test in Track record still compares with Nifty 50, not size indices; the app banner mentions "entry, stop, target" (compliance to confirm it is fine as a pointer to the app); the all-stock structure scan only runs once a day, so a mid-session restart leaves that day's counts as of the restart.

## Trader-first pass, 11 Nov 2026
- Stock page: one Trend tile replaces the separate Trend and Chart strength tiles; it combines swing points and chart strength (insights.trend_reading, kept in step with sRead in app.js) and shows why under the label. A Key levels ladder sits under the tiles: option ceiling and floor, last swing high and low, nearest order block above and below, 52 week high and low, nearest three each side of today's price, with distance.
- "What this means" is one line of headlines on every page; "why" opens the detail.
- Market Pulse opens with the same mood word as Today (api_pulse carries market_state as "mood"); "Appetite for risk" becomes "Smaller stocks led" when VIX also rose. The "sambhal ke" line now quotes the Nifty move instead of calling 0.8% "little".
- Headlines answer instead of ask: Money Flow leads with the last 5 sessions when foreign investors changed direction; Compare reads "A vs B" and "A tie on the numbers: ..."; Track record sections still waiting for data are one line each ("too early to judge, 10 of 20 sessions"), and holidays are no longer listed as missed logs.
- Chart pattern notes no longer print "bullish"/"bearish" (CR-10); they say "an upward/downward shape".
- Price Structure "Now" view (11 Nov): by default the chart shows only the order block price is inside plus the nearest above and below, and the latest change in structure (BoS, CHoCH or a plain break) as a line from the swing point to the candle that broke it, labelled at the right edge. Six months are shown; the 50/200 day averages step aside on the stock page while Structure is on. "Show history" brings back every standing zone, every BoS/CHoCH marker and the last swing lines.
- Sector Rotation (11 Nov): the default view is now a scoreboard, one row per sector with a verdict (Heating up, Just turned up, Cooling off, Just turned down, or folded as no clear run), one plain sentence, 8 weekly bars against the market and the 4-week figure. The three summary cards use the same verdicts. Blocks and Table are still there. Sector pages opened from a stock page now link back to that stock instead of the heatmap.

## Live F&O on Upstox (12 Nov 2026)
- **Feed:** `upstox_ticks.py` (run separately; stops 15:40) records ticks for ~1,030 instruments and writes
  `data/ticks/DAY/minutes.json` every 15 s. That file holds 1-minute candles of every F&O stock and index, backfilled from 9:15.
- **Board:** `livefo.build` reads that file when it is under 3 minutes old and refreshes every 30 s. Otherwise it falls back
  to Yahoo every 2 minutes. The previous session comes from the recorder's own previous-day file, else `data/intraday/1m`.
  It must never read the 2-year `data/upstox/1m` history, which is far too large to parse on each start.
- **Build speed:** the per-stock loop is numpy (about 5 s for 218 stocks). Timestamps use `index.as_unit("s")`, because pandas
  may store seconds or nanoseconds.
- **New on screen:**
  - volume profile on the F&O stock "Today" chart (`LF.profile`, `volProfile()`): most traded price, 70% band;
  - replay slider on Sector/Stock flow (`lfAt`);
  - optional chime on alerts (`mAlerts().sound`);
  - flash on new one-way entrants (`lfFlash`).
- **Credentials:** `data/upstox.env`, gitignored. The access token is daily: paste a new one each morning.
- **Open:**
  - Public display of Upstox data needs Upstox's written OK (redistribution).
  - The header badge and footer still say "delayed / NSE and Yahoo".
  - Futures OI is still read from NSE, not Upstox.

## Accounts and the Terminal (12 Nov 2026)
- **`accounts.py`:** email and password accounts.
  - Passwords: PBKDF2-SHA256 with 310k rounds and a salt per user.
  - Sessions: a 30-day HttpOnly cookie `s72` (Secure when served over https).
  - Failed log-ins are limited to 8 per 15 minutes per address and per email.
  - Storage: `data/users.json` and `data/sessions.json`, both gitignored.
  - Routes: `POST /api/auth/signup|login|logout`, `GET /api/me` (`?touch=1` records the visit), `POST /api/me/state`
    (whitelisted keys: watch, journal, alerts, malerts, prefs; at most 300 KB).
- **Sync:** the browser joins its local watchlist, journal and alerts with the account's on log-in, then pushes changes every
  8 s and when the tab is hidden (`acctMerge` / `acctPush`).
- **`#terminal`** (`vTerminal`, `GET /api/terminal?syms=`): one screen holding
  - the index strip (`LF.indices()` from the recorder's minute file, last session after hours);
  - breadth;
  - a "since you last looked" digest;
  - the member's list (live chips);
  - the selected stock (5-minute chart, VWAP, volume profile, today's levels ladder, option writers' floor and ceiling);
  - a "What happened" feed (5-minute BoS/CHoCH/breaks plus first time in the top 10 one-way lists, `LF.STATE["joined"]`);
  - one-way movers.
  - Keys: j/k, Enter, a, /. It refreshes every 30 s while the market is open.
- **Ask 72 Street (`/`)** now also jumps to pages ("Go to").
- **Not built:** password reset (needs an email sender), Google login (needs an OAuth client), and stop/target (research running in
  `levels_lab/`; nothing goes on screen until it passes and compliance signs off).

## Polish, My Feed and the F&O funnel (13 Nov 2026)
- **Live F&O, funnel view** (default; "Cards" switches back): one chart of every F&O stock's day first, then the market in words (rising vs falling, how the day went, sectors rising / falling), then Rising steadily and Falling steadily (top 3 cards, 4 to 10, 11 to 20). Click a line, a tile or a sector, or type in "Follow a stock": the rest blurs, the chart rescales to fit the followed stock, a focus card opens with a 5-minute chart, Z1 (nearest order block), R1/R2 and S1/S2 (nearest swing points and day highs and lows), described in plain words. No bull/bear, scores, entries, stops, targets or R:R. Code: `fnl*` functions and `lfFunnel` in `web/app.js`.
- **My Feed** (Watchlist → My Feed): `feed.py` + `/api/feed`. Curated timeline for the visitor's stocks: results out and due, NSE filings (routine paperwork hidden), bulk and block deals (NSE's large-deal file is one day only, so each day is kept in `data/deals/`), standing facts in "Right now". Importance ranking, two items per stock per day up front.
- **Glance chips** on Price Structure (plus a levels ladder), the stock page and Live F&O.
- **Repetition removed**: OI Flow and Liquidity Map have their own headlines and notes; the "What this means" box only on Option Pulse; boilerplate tails in `insights.py` shortened; the extra disclaimer line under readings removed (footer stays).
- **Fixes**: header 10px too wide on phones; Log in invisible in light theme; two health checks treated a fresh 0.0 minutes as missing (false "degraded").
- Backup of `web/` before all of this: `D:\Scanners\72 street backups\web_2026-11-13_before_polish`.
- **Terminal page retired** (13 Nov): its tab is gone and `#terminal` links redirect to My Feed. The header "Log in" opens `#login` (vLogin): log in or create an account, or, when logged in, account details and Log out. After logging in the visitor lands on My Feed. The vTerminal code is still in app.js but nothing routes to it.
