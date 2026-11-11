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
