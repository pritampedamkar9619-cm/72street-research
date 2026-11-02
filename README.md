# 72 Street Market Desk

## Run it

```
pip install -r requirements.txt
python server.py          # Mac or Linux: python3 server.py
```
Then open http://127.0.0.1:8772. On Windows you can also double-click **Start Dashboard.bat**.

Everything needed is in this repo. On the first start `bootstrap.py` unpacks `seed/seed.zip` into `data/`
(company fundamentals, peer tables, sector maps, track record logs), and `vendor/` holds the stock master list
and the chart strength engine. No sibling folders are needed. The first start takes about a minute; the
whole-market scan runs on its own after that.

Deploying: `railway.json` runs the backend on Railway (`python server.py`, health check `/api/health`).
Mount a volume at `/app/data` so logs and caches survive redeploys, and set `ADMIN_TOKEN` for the desk calls page.

## What a visitor sees

| Section | What it does |
|---|---|
| **Today** | First visit welcome. Stocks in focus: where the most signals agree, each explained in a few sentences. Search any stock. The market in one word (Risk-off, Mixed…), Nifty and Bank Nifty levels from option writers, results just out with the stock's reaction, three things to know, next results, sectors |
| **My Stocks** | The visitor's own list, saved in their browser. Each stock shows only what changed: results out or due, big move, option floor or ceiling broken, near 52 week high or low, institutions buying or selling, a live desk call. Alerts (🔔 per stock): results out, option level broken, big move, a price set by the user, joins Stocks in focus. Browser notifications while the site is open in a tab; true push needs the app or hosting with web push |
| **Track record** | Every closed session the six Stocks in focus are logged with their lean and price (`data/focus_log.json`), then scored 5 and 20 sessions later against Nifty. Never edited after the fact |
| **Stock** | Everything on one stock: six "at a glance" tiles, the 72 Street desk view (live call or none), plain reads, chart with option walls, valuation against real industry peers, eight quarters, who owns it, chart readings, options, fresh chart pattern. Buttons: add to My Stocks, Compare, Share (image) |
| **Compare** | Two stocks side by side with the differences written out |
| **Options** | Option Pulse, OI Flow, Liquidity Map, Expiry Tracker |
| **Markets** | Market Pulse, Money Flow, Results Calendar (Just reported cards + coming up), Calm Zone, Global & Crypto, Screeners |
| **Learn** | Every concept in plain words. Jargon on every page is also tap-to-explain |

Shareable links: `?s=HDFCBANK#stock`, `?w=A,B,C#mine`, `?c=A,B#compare`.

Themes: Light and Dark, switch at top right.

## Whole market and the technical score
- `universe.py`: every evening all ~2,400 stocks are scanned (about 80 s): price, 52 week range, returns, volume vs usual, daily traded value, and the 72 Street technical score (v3). Stocks in focus shortlists the most active liquid ones from it (floors: micro caps Rs 5 cr a day, small caps Rs 2 cr).
- `chartscore.py`: loads `vendor/technical_engine_v3.py`, an unchanged copy of the Verdict logic file. Shown on stock pages as "Chart strength", described, never a forecast.
- `data/v3_log.json`: every stock's score and close each session. Track record shows how each band did 5, 20 and 60 sessions later against Nifty. This is the live test of whether the score predicts anything.
- Results cards cover every company that has reported this results season, built once each and saved as they load.

## FII / DII history
NSE only publishes the latest day. Past days are filled from Trendlyne's public archive of the exchange's provisional figures (about a month), checked against NSE where both exist; the dashboard then keeps adding each day it runs (`data/fiidii_history.json`). Gaps in the chart are market holidays (20 Oct 2026 was Dussehra).

## Data traps the code handles
- Expiry week rollover: futures OI is added across every expiry, never read per contract.
- Demergers, splits, bonuses Yahoo did not adjust (TMPV, VEDL, HEG, TRENT): price history starts after any overnight gap over 30%, here and in the pattern scan.
- P/E is not scored when the company makes a loss or profit just collapsed. Compare scores head to head only inside one industry.

## Restarts
Stock data is saved to `data/stock_cache.pkl` after each warm-up and loaded at start, so a restart is instant. Stale pages refresh in the background, at most two at a time.

## Internal: desk calls

Open http://127.0.0.1:8772/admin.html. The access code is in `data/admin_token.txt`.
Calls are checked against the research call policy before they publish: stop band per
horizon, minimum risk reward to target 1 (hard reject below 1:1), a named level for the
stop, a written reason, monthly quotas, one open call per stock. Each call expires at the
end of its horizon. Published calls appear on the stock page at once.

## Files

| File | Role |
|---|---|
| `data_nse.py` | All outside fetches (NSE public endpoints, Yahoo). Swap this for a licensed feed |
| `engine.py` | Option chain maths, technical readings |
| `history.py` | PCR and max pain history from NSE daily F&O files |
| `stockdata.py` | Per-stock data: sector master, fundamentals, results status, smarter peers, patterns, desk calls |
| `insights.py` | Every plain-English read. Rule: describe what the data shows, never what to do |
| `patterns_run.py` | Nightly chart-pattern scan on fresh prices, using the patterns engine unchanged |
| `server.py` | Web server, API, background jobs (option snapshots, warm-up of Nifty 100, results feed, nightly scan) |
| `data/peer_overrides.json` | Hand-picked peers for conglomerates (Vedanta, Asian Paints, Titan, L&T) |
| `data/desk_calls.json` | Published desk calls |
| `data/fund_fresh/`, `data/peers/` | Refreshed fundamentals and peer lists. The Fundamental Engine cache is never written |

## Before going public
1. Licensed data for prices, options and fundamentals (NSE website and Screener are fine internally only).
2. Hosting, and protect admin.html properly (today it relies on the server listening only on this machine).
3. Compliance read of per-stock readings and the desk call box.
