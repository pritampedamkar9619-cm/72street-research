# 72 Street AI Dashboard — what the reference does

Source: Instagram reel by @_abcd_ai (local dashboard at 127.0.0.1:8790).
Goal stated by Akash: one live website that gives traders and investors
real-time market knowledge, all in one place.

## The reference, tab by tab

| Tab | What it shows | Data it needs |
|---|---|---|
| Market Pulse | Index overview, the day's headline read | Index quotes |
| Money Flow | Where money is going: FII/DII, sectors | FII/DII, sector indices |
| Option Pulse | Index options read: PCR, max pain, IV | Option chain |
| Stock Radar | Per stock radar of 8 factors (OI, options, VWAP, volume profile, RSI, price action, ATR calm, S/R map), a score from −10 to +10, an expected range | Option chain + OHLCV |
| Calm Zone | "Calmest F&O stocks for strangles": bubble chart, colour = results already out / results before expiry / date TBA, size = premium per lot | Realised vol, option premiums, event calendar |
| Crypto & Gold | Crypto and gold prices | Binance/OKX, yfinance |
| Liquidity Map | Candles with OI walls drawn on the chart: support at the biggest put strike, resistance at the biggest call strike, max pain, futures buildup | Option chain + intraday candles |
| OI Flow | Butterfly chart per strike: puts left, calls right, coloured by long buildup / short buildup / short covering / long unwinding. "Speed" = OI change per minute. Momentum gauge −100 to +100, "What's next" bullets with a conviction %, hot strikes | Option chain snapshots every minute |
| Screeners, Academy | Filters and learning | — |

Interface touches worth copying:
- A one-line plain English headline on every tab ("HDFCBANK boxed between put sellers at 1,200 and call sellers at 1,230")
- A "What am I looking at?" button on each chart
- A "Live, delayed" badge and a "Demo data" toggle
- Symbol chips across the top plus an "any F&O symbol" search box

## What we can already feed it

| Need | Status |
|---|---|
| Index quotes, sectors, breadth | `nse_dashboard.py` already does this |
| FII / DII | Working |
| World markets, gold, crude | `world_heatmap.py` |
| Option chain, any F&O symbol | **Tested 24 Oct: NSE option-chain-v3 works.** OI, change in OI, price change, volume, IV at every strike |
| OI spurts across all F&O stocks | Tested, works (220 rows) |
| Results and events calendar | Tested, works (720 events), feeds Calm Zone |
| Sector heatmap, VCP, patterns | Existing scanners |
| Real-time feed for a public site | Symphony API (licensed). NSE website data is delayed and not licensed for redistribution |

## Things to settle before building

1. **Audience.** Internal desk tool, app subscribers, or the free public website.
   This decides compliance. "Bullish, 58% conviction" and "best stocks for
   strangles" on a public page are research recommendations from a registered RA,
   with all the disclosure duties that come with that.
2. **Data source.** NSE website (free, delayed, fine for an internal tool, not
   for public redistribution) or Symphony (live, licensed).
3. **Scores.** Our own backtest found the technical score has close to zero
   forward-return edge. A radar or score can describe the setup. It should not be
   presented as a prediction until we have measured one.
