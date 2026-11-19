# Getting the Market Desk found on Google

For the tech team. About half a day of work, and best done before launch so the first links shared on X get indexed.

## The problem
Every page lives behind a `#`, for example `/#stock/RELIANCE`. Google treats everything after `#` as the same page, so all 2,366 stock pages count as one URL. Someone searching "Reliance pledge" or "TCS P/E history" will never land on us.

## The fix
1. **Real paths.** Serve `/stock/RELIANCE`, `/fno/NIFTY`, `/heat/Pharma` and so on, all returning `index.html`. In `web/app.js`, `route()` reads `location.hash`. Change it to read `location.pathname` (keeping `#` links working by redirecting them), and change internal links and `goTab` to use `history.pushState`.
2. **Something for Google to read.** The page content is built by JavaScript. Either:
   - render a small HTML summary server-side for `/stock/SYM` (name, price, the one-line summary sentence, P/E, results line), placed inside `<main>` before the script runs; or
   - pre-render each stock page nightly into static HTML (the `snapshot.py` used for the Vercel preview does a version of this).
3. **Per page title and description.** `setTitle()` in `app.js` already sets titles such as "Reliance Industries Limited (RELIANCE): price, results, valuation". The server-side summary should put the same title and a one-sentence description in the HTML `<head>`.
4. **`sitemap.xml`** listing every `/stock/SYM` path plus the main tabs, rebuilt nightly, and a `robots.txt` that points to it.
5. **Canonical tags,** so `/stock/reliance` and `/stock/RELIANCE` count as one page.
6. **Share previews.** `og:title` and `og:description` per stock page, so links pasted on X and WhatsApp show the company and the summary sentence.

## Done (fix list item 26, Nov 2026)
- `/stock/SYM`, `/fno/SYM`, `/heat/NAME` and the main tabs (`/mood`, `/builder`, `/today`...) are real addresses. The server
  returns the app page with that page's title, description, canonical link, `og` tags and a one-paragraph readable summary
  (`seo_page()` in `server.py`); the app then opens the matching view and tidies the address bar to the `#` form.
- `/sitemap.xml` lists every stock page and the main tabs; `/robots.txt` points to it and keeps crawlers off `/api/`.
- Share cards carry the stock's real address.
- Still for Tech: canonical links assume https (set the right host behind the load balancer), and submit the sitemap
  in Google Search Console once the domain is live.

## Already done in the app
- Site-wide title, description and `og` tags in `web/index.html`.
- A readable title per tab and per stock (`setTitle` in `app.js`).
- The chart library is served from our own server (`web/lib/`), so pages do not depend on an outside site loading.

## What not to do
Do not put the per-stock "reading" text into meta descriptions as advice. It describes the data; keep it worded the way the page words it.
