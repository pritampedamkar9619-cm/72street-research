# 72 Street AI Dashboard: handover for the tech team

Plain Python server (standard library plus `requests`, `yfinance`, `pandas`, `numpy`, `scipy`, `beautifulsoup4`, `lxml`). No database. All state is files in `data/`.

## Run

    HOST=0.0.0.0 PORT=8772 PYTHONIOENCODING=utf-8 python server.py

Run one process only. Background jobs live inside it, so several workers would each hit NSE. Put nginx or a CDN in front for HTTPS. Keep `data/` on persistent disk. Allow about a minute to start.

Sibling folders are needed next to the dashboard folder: `Verdict logic/`, `patterns logic/`, `fundamental sectors/`, `Fundamental Engine/` (the zip has the parts used).

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
