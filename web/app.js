/* 72 Street Market Desk — front end. Plain JS, no build step. */
(() => {
const $ = s => document.querySelector(s);
const view = $('#view');
const st = { tab: 'today', sym: { options: 'NIFTY', oiflow: 'NIFTY', liquidity: 'NIFTY', radar: 'RELIANCE', expiry: 'NIFTY', stock: 'RELIANCE', structure: 'RELIANCE' }, exp: {}, tf: '5m', symbols: [] };
const IDX_CHIPS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'INFY'];
const STK_CHIPS = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'LT', 'BHARTIARTL', 'TMPV'];
let timer = null, chart = null, renderId = 0;

/* ---------- helpers ---------- */
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n = (x, d = 0) => (x === null || x === undefined || isNaN(x)) ? '–' : Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const px = x => Math.abs(x) >= 1000 ? n(x, 0) : n(x, 2);
const sg = (x, d = 2) => { const r = Number(Number(x).toFixed(d)); return (r > 0 ? '+' : r < 0 ? '−' : '') + n(Math.abs(r), d); };
const pts = x => x == null ? '–' : n(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);   // option points: no false precision
const cls = x => x > 0 ? 'up' : x < 0 ? 'dn' : 'mut';
const compact = x => { const a = Math.abs(x); return a >= 1e7 ? (x / 1e7).toFixed(1) + 'Cr' : a >= 1e5 ? (x / 1e5).toFixed(1) + 'L' : a >= 1e3 ? (x / 1e3).toFixed(1) + 'K' : String(Math.round(x)); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const B = { long_buildup: ['Long buildup', 'lb'], short_buildup: ['Short buildup', 'sb'], short_covering: ['Short covering', 'sc'], long_unwinding: ['Long unwinding', 'lu'], '': ['No change', 'faint'] };
const bcol = b => css('--' + (B[b] || B[''])[1]);
const pill = b => b ? `<span class="pill p-${B[b][1]}">${B[b][0]}</span>` : '';
const symlink = (s, tab = 'stock') => `<span class="symlink" data-go="${tab}" data-sym="${esc(s)}">${esc(s)}</span>`;
async function api(path) {
  const r = await fetch(path, { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  if (j.read) st.read = j.read;
  return j;
}
function heat(chg) {
  const a = Math.min(Math.abs(chg) / 3, 1), pct = Math.round(14 + a * 62);
  return `background:color-mix(in srgb, var(${chg >= 0 ? '--up' : '--dn'}) ${pct}%, var(--card));color:${pct > 52 ? '#fff' : 'var(--ink)'}`;
}
function spark(vals, w = 120, h = 30, color) {
  if (!vals || vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - lo) / r * (h - 4)).toFixed(1)}`).join(' ');
  const c = color || (vals[vals.length - 1] >= vals[0] ? css('--up') : css('--dn'));
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function gauge(val, min, max, label, sub) {
  const t = (Math.max(min, Math.min(max, val)) - min) / (max - min);
  const ang = Math.PI * (1 - t), cx = 110, cy = 100, r = 80;
  const seg = (a0, a1, c) => { const p = a => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))];
    const [x0, y0] = p(a0), [x1, y1] = p(a1); return `<path d="M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}" stroke="${c}" stroke-width="14" fill="none"/>`; };
  const nx = cx + (r - 6) * Math.cos(ang), ny = cy - (r - 6) * Math.sin(ang);
  return `<svg viewBox="0 0 220 132" width="100%" style="max-width:260px;display:block;margin:0 auto" role="img" aria-label="${esc(label)} ${val}">
    ${seg(0, .33, css('--dn'))}${seg(.335, .665, css('--line'))}${seg(.67, 1, css('--up'))}
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${css('--ink')}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="${css('--ink')}"/>
    <text x="${cx}" y="${cy + 28}" text-anchor="middle" style="font-size:22px;font-weight:600;fill:var(--ink)">${val > 0 ? '+' : ''}${val}</text>
    <text x="20" y="${cy + 12}" style="font-size:10px">${min}</text><text x="200" y="${cy + 12}" text-anchor="end" style="font-size:10px">+${max}</text>
  </svg><div style="text-align:center;font-weight:600;margin-top:2px">${esc(label)}</div>${sub ? `<div style="text-align:center;font-size:12.5px;color:var(--mut)">${sub}</div>` : ''}`;
}
const card = (title, body, small = '') => `<div class="card"><h3>${title}${small ? `<small>${small}</small>` : ''}</h3>${body}</div>`;
// a row of glance chips (value on top, label under), then one short sentence: the page in two seconds, the words still there
const glance = (items, line = '') => `<div class="gx">${items.filter(Boolean).map(([v, l, t]) => `<div class="gx-c ${t || ''}"><b>${v}</b><span>${l}</span></div>`).join('')}</div>${line ? `<p class="gx-s">${line}</p>` : ''}`;
const sgp = x => (x > 0 ? '+' : '') + n(x, 1) + '%';
const stat = (k, v, d = '', s = '', dc = '') => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d ${dc}">${d}</div>` : ''}${s ? `<div class="s">${s}</div>` : ''}</div>`;
const skel = (k = 3) => `<div class="grid g${Math.min(k, 3)}">${'<div class="skel"></div>'.repeat(k)}</div>`;

/* ---------- explainers (also feed the Academy) ---------- */
const EXPLAIN = {
  structure: ['Price Structure', [
    '<b>Trend reading</b> puts the swing points and chart strength together in one line: which way the trend runs, whether the two agree, and where price sits between its last swing low, swing high and the nearest order blocks.',
    '<b>Swing points</b> are the small dots: a high with three lower highs on each side, or a low with three higher lows. A swing only appears three candles after it forms, so the chart never redraws the past.',
    '<b>Break of structure (BoS)</b> is a close beyond the last swing high or low in the direction the swings were already going. <b>Change of character (CHoCH)</b> is the same close against that direction. A wick alone does not count.',
    '<b>Order block</b> is the last candle that moved the other way just before a break, shaded from its high to its low. Darker means price has not come back to it yet; lighter means it has. It disappears once a candle closes through it.',
    '<b>These describe what price did.</b> They are chart shapes, not predictions, and not a recommendation or a trade setup.']],
  mine: ['Watchlist', [
    '<b>Your list, saved in this browser.</b> No login and nothing leaves your device except the symbols we look up.',
    '<b>Each stock shows only what changed:</b> results out or due, a big move, a level broken, institutions buying or selling, a live desk call.',
    '<b>Flagged rows</b> (amber band on top) have something that may need your attention. They sort to the top.',
    '<b>Alerts:</b> tap 🔔 on a stock to choose what to be told about: results out, an option level broken, a big move, a price you set. They show while this site is open in a tab.']],
  today: ['Today', [
    '<b>The market right now</b> sums up the session in one word Indian markets have always used: <b>Tezi</b> when buying is broad, <b>Mandi</b> when selling is broad and fear (India VIX) is rising, <b>Bikwali</b> when most stocks fell without panic, and <b>Na tezi, na mandi</b> when neither side is in control. A plain English line under it says why.',
    '<b>Results just out</b> shows how the market took this week’s biggest results, one line each. Tap a company for the full card.',
    '<b>Stocks in focus</b> are the six stocks across all listed companies where the most separate signals agree today, each explained in a few lines. Thinly traded stocks are left out.',
    '<b>Search any stock</b> to see everything about it on one page.']],
  compare: ['Compare', [
    '<b>A scorecard</b> marks which stock has the edge on valuation, business quality, growth, the latest quarter, price trend and fund buying, then counts the edges.',
    '<b>Fair comparisons only:</b> two stocks in the same industry are compared head to head. Across industries, each is measured against its own peers, because a bank and a software firm are valued differently. Numbers that would mislead, like the P/E of a company making a loss, are left unscored.',
    'It scores the numbers. It does not tell you which to buy.']],
  stock: ['Stock', [
    '<b>The line at the top</b> sums up the whole page in one sentence, built from the same readings shown below it.',
    '<b>At a glance</b> covers the trend, chart strength, valuation and business quality against peers, the latest results and what big institutions did last quarter.',
    '<b>Chart strength</b> is a 72 Street score, 0 to 100, from six parts of the chart. It describes how the chart looks today. Whether it predicts anything is being measured openly in Track record.',
    '<b>Peers</b> are companies in the same industry and of a similar size. Where a company has no fair peer group, such as Reliance, no median is shown and it is compared with its own P/E history instead.',
    '<b>72 Street desk view</b> shows a live buy or sell call only when our registered analysts have published one. Everything else on the page describes the data.']],
  pulse: ['Market Pulse', [
    '<b>Index cards</b> show where each index trades, the change from yesterday, and a bar for today\'s range from low to high. The marker is the current price.',
    '<b>Breadth</b> counts how many Nifty 500 stocks rose and fell. An index can rise while most stocks fall, and breadth is how you catch that.',
    '<b>What this means</b> reads the day in plain words, and <b>Nifty 50 gainers and losers</b> show what moved the index.']],
  flow: ['Money Flow', [
    '<b>FII and DII</b> are foreign and domestic institutions. The bars show their net buying or selling in the cash market each day, in crore.']],
  options: ['Option Pulse', [
    '<b>PCR</b>, the put call ratio, is open puts divided by open calls. Above 1 means more put writers, who profit if the price holds up.',
    '<b>Max pain</b> is the strike where option buyers as a group would lose the most at expiry.',
    '<b>Priced move</b> is the price of the at-the-money straddle. It is roughly how far the options market expects the price to travel by expiry.',
    '<b>Floor and ceiling</b> are the strikes with the most put and call open interest near the price. Writers defend these levels.']],
  oiflow: ['OI Flow', [
    '<b>Each row is a strike.</b> Puts on the left, calls on the right. The faint bar is total open interest, the solid part is what was added or removed today.',
    '<b>Colour tells you who acted.</b> Green long buildup, red short buildup (writing), blue short covering, amber long unwinding.',
    '<b>Flow momentum</b> runs from −100 to +100. Put writing and call covering near the price push it up. Call writing and put covering push it down. It describes today\'s positioning, not tomorrow\'s price.',
    '<b>Speed</b> is open interest added per minute. While the market is open it is measured between live snapshots. When closed it is the session average.']],
  rotation: ['Sector Rotation', [
    '<b>Which sectors are heating up or cooling off, week by week.</b> Each number is how far the sector beat or lagged the whole market that week.',
    'The five strongest sectors stack up and the five weakest hang below, one column a week. Follow a sector across weeks to see whether it is lasting.']],
  heat: ['Sector Heatmap', [
    '<b>Every card is a sector</b>, strongest first, with its six largest companies. Colour follows today&#39;s move. Sectors are grouped from NSE industry classes.',
    'Start with <b>Large and mid caps</b>. Tap a stock to open it, or a sector name to see all its stocks.']],
  livefo: ['Live F&amp;O', [
    '<b>Every F&amp;O stock at a glance.</b> The curve shows how many moved by each 1%. Sector flow shows each sector through the day.',
    '<b>One-way moves</b> rank stocks by how far they have travelled from the open, against their usual day. 2× usual range means twice its normal high to low range. A stock only counts if the day has gone mostly one way: the distance on one side of the open must be more than twice the other side. Choppy stocks are left out.',
    '<b>Futures</b> reads price and open interest together, with every expiry added up so month end rollover does not mislead. Long buildup: price up with new positions. Short buildup: price down with new positions. Short covering: price up as positions close. Long unwinding: price down as positions close.',
    '<b>VWAP</b> is the average price paid today, weighted by volume. Above it, the average buyer today is in profit.',
    'This describes what has happened today. It is not a list of trades to take.']],
  fno: ['Stock or Index', [
    '<b>The verdict</b> at the top sums up what option prices and positions show for this stock. It describes the data. It does not say what to do.',
    '<b>Cheap or expensive</b> compares IV with its own recent range and with how much the stock has actually been moving. IV is the yearly move that option prices imply.',
    '<b>Priced range</b> is what option prices imply by expiry. It is not a forecast, and stocks often move outside it.',
    '<b>Greeks</b> are calculated by 72 Street from option and futures prices, so they can differ slightly from a broker.']],
  liquidity: ['Liquidity Map', [
    '<b>The chart</b> is price in candles. The lines are where option writers hold the most positions.',
    '<b>Floor</b> is the strike with the most put positions. <b>Ceiling</b> is the strike with the most call positions. <b>Next floor</b> and <b>next ceiling</b> are the second largest.',
    '<b>Expected range</b> is today\'s price plus and minus the straddle. The market prices roughly two in three odds of finishing inside it.']],
  track: ['Track record', [
    '<b>Stocks in focus, scored.</b> Each evening the six stocks are written down with their signal and closing price, then compared with Nifty 5 and 20 trading days later. No percentage is shown until 30 stocks are checked. Nothing is edited after the fact.',
    '<b>Chart strength, tested.</b> Every listed stock\'s chart strength is logged each evening. Later we check whether Strong stocks beat Nifty and Broken ones lagged it. If they do not, we will say so.',
    '<b>Why publish this?</b> Almost no one in India shows how their readings actually did. A coin toss is right half the time, so that is the number to beat.']],
  radar: ['Stock Radar', [
    '<b>Eight readings</b>, each from −10 to +10: trend, RSI, price against its 20 day VWAP, volume, how calm the stock is, where it sits in its 20 day range, recent price action, and option positioning.',
    '<b>The score</b> averages the directional readings. It describes the setup today. We have not tested it as a forecast, so do not read it as one.',
    '<b>Expected range</b> comes from option implied volatility to the next expiry, or from recent price movement for stocks without options.']],
  calm: ['Calm Zone', [
    '<b>Each bubble is an F&amp;O stock.</b> Further left means smaller daily moves over 20 sessions. Lower means a tighter 20 day range. Bigger means more traded value.',
    '<b>Colour shows results timing.</b> Amber has results due before this month\'s expiry, which usually brings a large move. Blue reports after expiry. Grey has no date announced.',
    '<b>Calm is a description of the past 20 sessions.</b> Quiet stocks can move sharply, especially around news.']],
  results: ['Results Calendar', [
    '<b>Every F&amp;O company reporting in the next three weeks</b>, with the move the options market is pricing for it.',
    '<b>Priced move</b> is the at-the-money straddle for the first expiry after the result, as a share of the price. It is the market\'s estimate of how far the stock travels, either way, by that expiry.',
    '<b>Usual move</b> is what the stock\'s recent volatility alone would justify over the same days. <b>Event premium</b> divides one by the other. 2x means options price twice the normal move because of the result.',
    'Where the expiry falls well after the result, the priced move includes extra days of normal movement, so compare stocks on the same expiry.']],
  expiry: ['Expiry Tracker', [
    '<b>Max pain</b> is the strike where option buyers as a group lose the most at expiry. The chart shows how it moved through this expiry cycle next to the price.',
    '<b>PCR</b> through the cycle shows whether put or call writers were adding positions as expiry came closer.',
    '<b>The record</b> checks past expiries: where max pain stood three sessions before expiry, and where price actually settled. It is a history, not a rule. Price often ignores max pain.',
    'Rebuilt from the exchange\'s daily F&amp;O files, so the history goes back about four months.']],
  global: ['Global &amp; Crypto', [
    '<b>World indices, crypto, metals, energy and currencies</b> with the last close and change. The line shows the last month.',
    '<b>Gold and silver in rupees</b> are converted from international prices at today\'s USD INR, without import duty or GST, so local prices run higher.']],
  screens: ['52 Week Highs and Lows', [
    '<b>A new 52 week high</b> means the stock traded at its highest price in a year at some point today. A new low is the opposite.',
    'Many highs and few lows usually means a healthy market. The reverse means selling is wide.']],
  screener: ['Screener', [
    '<b>Pick conditions, see every stock that meets them.</b> It filters, it does not rate or rank stocks as buys.',
    '<b>Cheaper than its sector</b> compares the P/E with the median P/E of listed companies in the same sector. Loss makers have no P/E and drop out of that filter.',
    '<b>Debt</b> is borrowings against shareholder money from the latest balance sheet. Banks and lenders are left out of debt filters because borrowing is their business.',
    'Micro caps are left out unless you tick them in, because they are thinly traded.']],
  journal: ['Trading journal', [
    '<b>The Excel journal</b> has four sheets: settings, a position sizer, the journal itself and a review that works out your real numbers.',
    '<b>The calculator</b> on this page sizes one trade from your capital, the share of it you are willing to lose, your entry and your stop.']],
  learn: ['Academy', ['Every concept used on this desk, in plain words.']]
};
const LEARN_ORDER = ['today', 'stock', 'compare', 'structure', 'livefo', 'fno', 'heat', 'rotation', 'pulse', 'flow', 'results', 'mine', 'track'];
function setExplain(tab) {
  if (!EXPLAIN[tab]) return;
  const [t, items] = EXPLAIN[tab];
  $('#explain').innerHTML = items.map(x => `<div>${x}</div>`).join('');
  $('#explain-btn').hidden = tab === 'learn';
}
$('#explain-btn').onclick = () => { const e = $('#explain'); e.hidden = !e.hidden; };

/* ---------- symbol bar ---------- */
function symbar(tab, chips, withExp) {
  const bar = $('#symbar'); bar.hidden = false;
  $('#chips').innerHTML = chips.map(s => `<button class="chip ${s === st.sym[tab] ? 'on' : ''}" data-sym="${s}">${s}</button>`).join('');
  $('#chips').onclick = e => { const b = e.target.closest('[data-sym]'); if (!b) return; goTab(tab, b.dataset.sym); };
  const inp = $('#sym-in'); inp.value = ''; inp.placeholder = 'Any F&O symbol';
  inp.onchange = () => { const v = inp.value.trim().toUpperCase(); if (v) goTab(tab, v); };
  $('#exp-sel').hidden = !withExp;
}
function fillExp(tab, exps, cur) {
  const sel = $('#exp-sel');
  const lbl = e => /^\d{4}-\d\d-\d\d$/.test(e) ? `${fmtD(e)} ${e.slice(0, 4)}` : e;
  sel.innerHTML = (exps || []).map(e => `<option value="${e}" ${e === cur ? 'selected' : ''}>${lbl(e)}</option>`).join('');
  sel.onchange = () => { st.exp[tab] = sel.value; render(); };
}

/* ---------- tabs ---------- */
async function vPulse() {
  const d = await api('/api/pulse');
  stamp(d.ts, d.open);
  $('#headline').textContent = d.headline;
  const main = d.main.filter(m => !/FINANCIAL|NEXT 50/.test(m.name)).map(m => {
    const pos = m.high > m.low ? (m.last - m.low) / (m.high - m.low) * 100 : 50;
    const prev = m.high > m.low ? Math.max(0, Math.min(100, (m.prev - m.low) / (m.high - m.low) * 100)) : 50;
    const off = m.yh ? ((m.last / m.yh - 1) * 100) : null;
    return `<div class="card stat"><div class="k">${esc(m.name.replace('FINANCIAL SERVICES', 'FIN SERVICES'))}</div>
      <div class="v">${px(m.last)}</div><div class="d ${cls(m.chg)}">${sg(m.pts)} (${sg(m.chg)}%)</div>
      <div class="rangebar" title="Day range"><span style="left:0;width:${pos}%"></span><i style="left:calc(${pos}% - 1px)"></i><i style="left:${prev}%;background:var(--faint);width:2px" title="Previous close"></i></div>
      <div class="rangelbl"><span>${px(m.low)}</span><span>${px(m.high)}</span></div>
      ${off !== null ? `<div class="s">${off >= -0.5 ? 'At its 52 week high' : `${n(Math.abs(off), 1)}% below its 52 week high`}</div>` : ''}</div>`;
  }).join('');
  const b = d.breadth, tot = b.adv + b.dec + b.unch || 1;
  const breadth = `<div class="card stat" style="grid-column:1/-1"><div class="k">Nifty 500 breadth</div>
    <div class="v"><span class="up">${b.adv}</span> <span class="mut" style="font-size:16px">vs</span> <span class="dn">${b.dec}</span></div>
    <div class="breadth"><b style="width:${b.adv / tot * 100}%"></b><s style="width:${b.unch / tot * 100}%"></s><u style="width:${b.dec / tot * 100}%"></u></div>
    <div class="s">52 week highs <b class="up">${b.h52 ?? '–'}</b> · lows <b class="dn">${b.l52 ?? '–'}</b> (all NSE stocks, micro caps included)</div></div>`;
  const mv = (rows, t) => rows && rows.length ? `<table><thead><tr><th>Stock</th><th class="r">Price</th><th class="r">Change</th></tr></thead><tbody>${rows.map(r => `<tr><td>${symlink(r.sym)}</td><td class="r">${px(r.ltp)}</td><td class="r ${cls(r.chg)}">${sg(r.chg)}%</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No data</div>';
  view.innerHTML = `<div class="grid g3">${main}${breadth}</div>
    <div class="grid g2">${card('Nifty 50 gainers', mv(d.movers.gainers))}${card('Nifty 50 losers', mv(d.movers.loosers))}</div>`;
}

function fiiChart(hist) {
  if (!hist.length) return '<div class="empty">No history yet</div>';
  const W = 640, H = 230, pad = 34, max = Math.max(...hist.flatMap(h => [Math.abs(h.fii || 0), Math.abs(h.dii || 0)]), 1);
  const bw = (W - pad * 2) / hist.length, mid = H / 2 - 6, sc = (mid - 16) / max;
  let g = `<line x1="${pad}" x2="${W - 6}" y1="${mid}" y2="${mid}" stroke="${css('--line')}"/>`;
  hist.forEach((h, i) => {
    const x = pad + i * bw, w = Math.max(3, bw / 2 - 3);
    [['fii', css('--sc')], ['dii', css('--brand')]].forEach(([k, c], j) => {
      const v = h[k] || 0, hgt = Math.abs(v) * sc;
      g += `<rect x="${x + 2 + j * (w + 1)}" y="${v >= 0 ? mid - hgt : mid}" width="${w}" height="${Math.max(hgt, 1)}" rx="2" fill="${c}" data-tip="${h.date.slice(0, 6)}: ${k === 'fii' ? 'Foreign investors' : 'Indian institutions'} ${v >= 0 ? 'bought' : 'sold'} ₹${n(Math.abs(v))} cr more than they ${v >= 0 ? 'sold' : 'bought'}"/>`;
    });
    if (hist.length <= 12 || i % Math.ceil(hist.length / 10) === 0) g += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" style="font-size:10px">${h.date.slice(0, 6)}</text>`;
  });
  g += `<text x="2" y="16" style="font-size:10px">Bought</text><text x="2" y="${mid * 2 - 14}" style="font-size:10px">Sold</text>`;
  return `<div class="legend" style="margin-bottom:6px"><span><i style="background:var(--sc)"></i>Foreign investors (FII)</span><span><i style="background:var(--brand)"></i>Indian institutions (DII)</span></div>
    <div class="svgwrap"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg></div>`;
}
async function vFlow() {
  const d = await api('/api/flow');
  const last = d.fiidii[d.fiidii.length - 1] || {};
  const h = d.fiidii, sum = k => h.reduce((a, x) => a + (x[k] || 0), 0);
  const sf = sum('fii'), sd = sum('dii'), sells = h.filter(x => (x.fii || 0) < 0).length;
  const cr = x => '₹' + n(Math.abs(x)) + ' cr';
  const h5 = h.slice(-5), f5 = h5.reduce((a, x) => a + (x.fii || 0), 0);
  // the turn matters more than the month: lead with the last 5 sessions when foreigners changed direction
  $('#headline').textContent = (f5 > 0) !== (sf > 0) && h.length > 5
    ? `Foreign investors have turned ${f5 > 0 ? 'buyers' : 'sellers'}: ${f5 > 0 ? 'bought' : 'sold'} ${cr(f5)} net in the last 5 sessions, after net ${sf > 0 ? 'buying' : 'selling'} ${cr(sf)} over ${h.length}.`
    : sf < 0 && sd > 0 ? 'Indian money has been taking the shares foreign investors sold.' : sf > 0 && sd > 0 ? 'Foreign and Indian money have both been buying.' : sf > 0 ? 'Foreign money has been buying while Indian institutions sold.' : 'Foreign and Indian money have both been selling.';
  const did = (x, who) => `<div class="ff-t"><span>${who}</span><b class="${cls(x)}">${x >= 0 ? 'Bought' : 'Sold'} ${cr(x)}</b><em>more than they ${x >= 0 ? 'sold' : 'bought'}, ${esc((last.date || '').slice(0, 6))}</em></div>`;
  const story = sf < 0 && sd > 0 ? `Foreign investors sold ${cr(sf)} more than they bought over the last ${h.length} sessions, and Indian institutions bought ${cr(sd)}. So Indian money has been taking the shares foreigners sold.`
    : sf > 0 && sd > 0 ? `Both groups were net buyers over the last ${h.length} sessions: foreign investors ${cr(sf)}, Indian institutions ${cr(sd)}.`
      : sf > 0 ? `Foreign investors bought ${cr(sf)} more than they sold over the last ${h.length} sessions, while Indian institutions sold ${cr(sd)}.`
        : `Both groups sold more than they bought over the last ${h.length} sessions: foreign investors ${cr(sf)}, Indian institutions ${cr(sd)}.`;
  view.innerHTML = `<section class="ff-top">${did(last.fii || 0, 'Foreign investors (FII)')}${did(last.dii || 0, 'Indian institutions (DII)')}
      <div class="ff-t ff-s"><span>Last ${h.length} sessions</span><p>${esc(story)}</p>${h.length > 5 ? (() => { const w = h.slice(-5), f5 = w.reduce((a, x) => a + (x.fii || 0), 0), d5 = w.reduce((a, x) => a + (x.dii || 0), 0); return `<p class="mut" style="margin-top:6px">Last 5 sessions: foreign investors ${f5 >= 0 ? 'bought' : 'sold'} ${cr(f5)}, Indian institutions ${d5 >= 0 ? 'bought' : 'sold'} ${cr(d5)}.</p>`; })() : ''}</div></section>
    ${card('Who bought and who sold, each day', fiiChart(h) + `<p class="note2">Each pair of bars is one trading day. A bar above the line means that group bought more shares than it sold. Below the line, it sold more. Taller means more money. Foreign investors sold on ${sells} of the last ${h.length} sessions.</p>`, 'cash market')}
    ${card('Who are they, and why does it matter?', `<div class="ff-w"><p><b>Foreign investors (FII)</b> are overseas funds. They are large enough to move big stocks, and they often sell when money leaves emerging markets.</p><p><b>Indian institutions (DII)</b> are Indian mutual funds, insurers and pension funds. Monthly SIPs give them a steady flow of money to invest.</p></div>`)}
    <p class="note2">Futures buildup and open interest are in <a href="#livefo">F&amp;O → Live F&amp;O</a>.</p>`;
}

async function getOptions(tab) {
  const sym = st.sym[tab], exp = st.exp[tab];
  const d = await api(`/api/options?tab=${tab}&sym=${encodeURIComponent(sym)}${exp ? '&exp=' + encodeURIComponent(exp) : ''}`);
  st.exp[tab] = d.expiry; fillExp(tab, d.expiries, d.expiry); stamp(d.ts, d.market_open);
  return d;
}
function oiBars(d, key, title) {
  const rows = d.rows.filter(r => Math.abs(r.k - d.spot) <= Math.abs(d.rows[1].k - d.rows[0].k) * 14 || false);
  const view_ = rows.length > 6 ? rows : d.rows;
  const near = view_.slice(Math.max(0, view_.findIndex(r => r.k >= d.spot) - 12), view_.findIndex(r => r.k >= d.spot) + 13);
  const W = 640, H = 240, pad = 40, val = (r, s) => key === 'oi' ? r[s].oi : r[s].chg;
  const max = Math.max(...near.flatMap(r => [Math.abs(val(r, 'CE')), Math.abs(val(r, 'PE'))]), 1);
  const base = key === 'oi' ? H - 30 : (H - 30) / 2 + 6, sc = key === 'oi' ? (H - 50) / max : ((H - 30) / 2 - 14) / max;
  const bw = (W - pad) / near.length, w = Math.max(2, bw / 2 - 2);
  let g = `<line x1="${pad}" x2="${W}" y1="${base}" y2="${base}" stroke="${css('--line')}"/>`;
  near.forEach((r, i) => {
    const x = pad + i * bw;
    [['PE', css('--up')], ['CE', css('--dn')]].forEach(([s, c], j) => {
      const v = val(r, s), h = Math.abs(v) * sc;
      g += `<rect x="${x + 1 + j * (w + 1)}" y="${v >= 0 ? base - h : base}" width="${w}" height="${Math.max(h, .5)}" rx="1.5" fill="${c}" data-tip="${px(r.k)} ${s === 'CE' ? 'Call' : 'Put'} ${key === 'oi' ? 'OI ' + n(v) : 'change ' + sg(v, 0)}"/>`;
    });
    if (i % 2 === 0) g += `<text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" style="font-size:9.5px">${px(r.k)}</text>`;
  });
  const si = near.findIndex(r => r.k >= d.spot);
  if (si > 0) { const k0 = near[si - 1].k, k1 = near[si].k, x = pad + (si - 1 + (d.spot - k0) / (k1 - k0)) * bw + bw / 2;
    g += `<line x1="${x}" x2="${x}" y1="8" y2="${H - 26}" stroke="${css('--ink')}" stroke-dasharray="4 4"/><text x="${x + 4}" y="16" style="font-size:10px;fill:var(--ink)">spot ${px(d.spot)}</text>`; }
  g += `<text x="2" y="14" style="font-size:9.5px">${compact(max)}</text>`;
  return card(title, `<div class="legend" style="margin-bottom:4px"><span><i style="background:var(--up)"></i>Puts</span><span><i style="background:var(--dn)"></i>Calls</span></div><div class="svgwrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:460px">${g}</svg></div>`);
}
function smile(d) {
  const pts = d.iv_smile.filter(p => p.ce || p.pe);
  if (pts.length < 3) return card('IV smile', '<div class="empty">Not enough strikes with IV</div>');
  const W = 400, H = 180, pad = 30, ks = pts.map(p => p.k), ivs = pts.map(p => p.k >= d.spot ? p.ce : p.pe).filter(Boolean);
  const kx = k => pad + (k - ks[0]) / (ks[ks.length - 1] - ks[0] || 1) * (W - pad - 6), lo = Math.min(...ivs), hi = Math.max(...ivs);
  const iy = v => H - 22 - (v - lo) / (hi - lo || 1) * (H - 40);
  const iv1 = p => p.k >= d.spot ? p.ce : p.pe, line = c => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${pts.filter(iv1).map(p => `${kx(p.k)},${iy(iv1(p))}`).join(' ')}"/>`;
  const sx = kx(d.spot);
  return card('IV smile', `<div class="legend" style="margin-bottom:4px"><span><i style="background:var(--accent)"></i>Puts below the price, calls above it</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%">${line(css('--accent'))}<line x1="${sx}" x2="${sx}" y1="8" y2="${H - 22}" stroke="${css('--ink')}" stroke-dasharray="3 4"/>
    <text x="2" y="14" style="font-size:9.5px">${n(hi, 1)}%</text><text x="2" y="${H - 24}" style="font-size:9.5px">${n(lo, 1)}%</text>
    <text x="${pad}" y="${H - 6}" style="font-size:9.5px">${px(ks[0])}</text><text x="${W - 6}" y="${H - 6}" text-anchor="end" style="font-size:9.5px">${px(ks[ks.length - 1])}</text></svg>`, 'implied volatility by strike');
}
async function vOptions() {
  symbar('options', IDX_CHIPS, true);
  const d = await getOptions('options');
  $('#headline').textContent = `${d.sym}: ${d.headline}`;
  const mpd = (d.max_pain / d.spot - 1) * 100;
  view.innerHTML = `<div class="grid g4">
    ${stat('Spot', px(d.spot), `ATM ${px(d.atm)}`, `${d.expiry} · ${d.dte} days left`)}
    ${stat('Put call ratio', n(d.pcr, 2), d.pcr_chg ? `New positions today: ${n(d.pcr_chg, 2)} puts per call` : '', d.pcr > 1.1 ? 'More puts written than calls' : d.pcr < 0.8 ? 'More calls written than puts' : 'Balanced')}
    ${stat('Max pain', px(d.max_pain), `${sg(mpd)}% from spot`, '', cls(mpd))}
    ${stat('Priced move', '±' + pts(d.straddle), `${px(d.spot - d.straddle)} to ${px(d.spot + d.straddle)}`, `ATM IV ${n(d.atm_iv, 1)}% · straddle price`)}
    ${stat('Floor', px(d.floor), 'Most put OI below spot', `Biggest put wall ${px(d.put_wall)}`)}
    ${stat('Ceiling', px(d.ceiling), 'Most call OI above spot', `Biggest call wall ${px(d.call_wall)}`)}
    ${stat('Total put OI', compact(d.pe_oi), `${sg(d.pe_chg, 0)} today`, '', cls(d.pe_chg))}
    ${stat('Total call OI', compact(d.ce_oi), `${sg(d.ce_chg, 0)} today`, '', cls(d.ce_chg))}</div>
    <div class="grid g2">${oiBars(d, 'oi', 'Open interest by strike')}${oiBars(d, 'chg', 'Change in open interest today')}</div>
    <div class="grid g-main">${card('What the chain says', `<div class="notes">${d.notes.map(x => `<div>${esc(x)}</div>`).join('')}</div>`)}${smile(d)}</div>`;
}

function butterfly(d) {
  const i0 = d.rows.findIndex(r => r.k >= d.spot), rows = d.rows.slice(Math.max(0, i0 - 13), i0 + 13).reverse();
  const W = 760, rh = 19, H = rows.length * rh + 46, mid = W / 2, half = mid - 44;
  const max = Math.max(...rows.flatMap(r => [r.CE.oi, r.PE.oi]), 1);
  let g = `<text x="${mid - 52}" y="14" text-anchor="end" style="font-size:10.5px">◀ PUT OI (writers = floor)</text><text x="${mid + 52}" y="14" style="font-size:10.5px">CALL OI (writers = ceiling) ▶</text>`;
  rows.forEach((r, i) => {
    const y = 26 + i * rh;
    [['PE', -1], ['CE', 1]].forEach(([s, dir]) => {
      const o = r[s], full = o.oi / max * half, part = Math.min(Math.abs(o.chg) / max * half, full || Math.abs(o.chg) / max * half);
      const c = bcol(o.b), x0 = dir < 0 ? mid - 40 - full : mid + 40, xp = dir < 0 ? mid - 40 - part : mid + 40;
      const tip = `${px(r.k)} ${s === 'CE' ? 'Call' : 'Put'} · OI ${n(o.oi)} · today ${sg(o.chg, 0)} · ${o.spd ? sg(o.spd, 1) + '/min · ' : ''}${(B[o.b] || B[''])[0]} · LTP ${n(o.ltp, 2)} · IV ${n(o.iv, 1)}%`;
      g += `<rect x="${x0}" y="${y}" width="${Math.max(full, 0)}" height="${rh - 5}" rx="3" fill="${o.b ? c : css('--faint')}" opacity=".28" data-tip="${tip}"/>`;
      if (part > 0.5) g += `<rect x="${xp}" y="${y}" width="${part}" height="${rh - 5}" rx="3" fill="${c}" data-tip="${tip}"/>`;
    });
    const isF = r.k === d.floor, isC = r.k === d.ceiling;
    g += `<text x="${mid}" y="${y + 11}" text-anchor="middle" style="font-size:11px;${isF || isC ? 'font-weight:700;fill:var(--ink)' : ''}">${px(r.k)}</text>`;
    if (isF) g += `<text x="6" y="${y + 11}" style="font-size:10px;fill:var(--up)">floor ▸</text>`;
    if (isC) g += `<text x="${W - 6}" y="${y + 11}" text-anchor="end" style="font-size:10px;fill:var(--dn)">◂ ceiling</text>`;
  });
  const ks = rows.map(r => r.k), j = ks.findIndex(k => k <= d.spot);
  if (j > 0) { const y = 26 + (j - 1 + (ks[j - 1] - d.spot) / (ks[j - 1] - ks[j])) * rh + rh / 2;
    g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${css('--accent')}" stroke-dasharray="5 4"/><text x="${W - 4}" y="${y - 4}" text-anchor="end" style="font-size:10.5px;fill:var(--accent)">spot ${px(d.spot)}</text>`; }
  return `<div class="legend" style="margin-bottom:8px">${['long_buildup', 'short_buildup', 'short_covering', 'long_unwinding'].map(b => `<span><i style="background:${bcol(b)}"></i>${B[b][0]}</span>`).join('')}<span class="mut">faint = total OI · solid = changed today</span></div>
    <div class="svgwrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:560px">${g}</svg></div>`;
}
// the speed is live, between snapshots; the label is the strike's whole day, so say both and never let them contradict
const hotWord = h => { const kind = Object.keys(B).find(k => B[k][0] === h.b), w = h.side === 'PE' ? 'Put' : 'Call';
  const day = { short_buildup: 'writing', long_buildup: 'buying', short_covering: 'writers exiting', long_unwinding: 'buyers exiting' }[kind];
  return `${w} OI ${h.spd > 0 ? 'rising' : 'falling'} now${day ? ` · ${day} over the day` : ''}`; };
async function vOIFlow() {
  symbar('oiflow', IDX_CHIPS, true);
  const d = await getOptions('oiflow');
  { const w = (d.notes || []).find(x => /writ|added|cut|closing|building/i.test(x)); $('#headline').textContent = `${d.sym}: where option positions changed today${w ? '. ' + w : ''}`; }
  const m = d.momentum, ml = (m >= 40 ? 'Put writing leads' : m >= 15 ? 'Put writing ahead' : m <= -40 ? 'Call writing leads' : m <= -15 ? 'Call writing ahead' : 'Mixed') + ' near the price';
  const hot = d.hot.length ? `<table><thead><tr><th>Strike</th><th>What is happening</th><th class="r">/min</th></tr></thead><tbody>${d.hot.map(h => `<tr><td class="num">${px(h.k)} ${h.side}</td><td>${esc(hotWord(h))}</td><td class="r ${cls(h.spd)}">${sg(h.spd, 1)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No change yet</div>';
  view.innerHTML = `<div class="grid g-main">${card('OI flow by strike', butterfly(d), `${d.expiry}`)}
    <div class="grid">${card('Who is more active', gauge(m, -100, 100, ml, '−100 call writers · +100 put writers'))}
    ${stat('Speed near spot', n(d.near_speed) + ' <span style="font-size:13px" class="mut">contracts/min</span>', d.speed_live ? 'Live, between snapshots' : 'Session average', d.speed_live ? `${d.snapshots} snapshots this session` : 'Live speed starts when the market opens')}
    ${card('What the flow says', `<div class="notes">${d.notes.filter(x => /writ|added|cut|closing|building|OI|open interest|unwind|cover/i.test(x) && !$('#headline').textContent.includes(x)).slice(0, 4).map(x => `<div>${esc(x)}</div>`).join('') || '<div class="mut">The full reading is on Option Pulse.</div>'}</div><p class="note2"><a href="#options">Full options reading on Option Pulse →</a></p>`)}
    ${card('Hot strikes', hot, 'fastest OI change')}</div></div>`;
}

async function vLiquidity() {
  symbar('liquidity', IDX_CHIPS, true);
  const sym = st.sym.liquidity;
  const [d, c] = await Promise.all([getOptions('liquidity'), api(`/api/candles?sym=${encodeURIComponent(sym)}&tf=${st.tf}`)]);
  $('#headline').textContent = d.floor && d.ceiling ? `${sym} ${px(d.spot)}: between the put floor at ${px(d.floor)} and the call ceiling at ${px(d.ceiling)}` : `${sym}: ${d.headline}`;
  const lines = [['Ceiling', d.ceiling, '--dn', 0], ['Next ceiling', d.next_ceiling ?? d.call_wall, '--dn', 2], ['Max pain', d.max_pain, '--accent', 1], ['Floor', d.floor, '--up', 0], ['Next floor', d.next_floor ?? d.put_wall, '--up', 2],
    ['Range high', d.spot + d.straddle, '--faint', 1], ['Range low', d.spot - d.straddle, '--faint', 1]];
  const tfs = ['5m', '15m', '1h', '1d'].map(t => `<button class="${t === st.tf ? 'on' : ''}" data-tf="${t}">${t}</button>`).join('');
  view.innerHTML = `<div class="grid g-main">${card(`Price and option walls <span class="seg" id="tfseg" style="margin-left:8px">${tfs}</span>`, `<div class="chart" id="lw"></div>`, d.expiry)}
    <div class="grid">${card('Floors and ceilings', `<div class="walls">${lines.map(([k, v, col, ds]) => `<div><span><i style="background:var(${col});${ds ? 'opacity:.7' : ''}"></i>${k}</span><b class="num">${px(v)}</b></div>`).join('')}</div>`, `spot ${px(d.spot)}`)}
    ${card('Who is defending', `<div class="notes">${d.notes.filter(x => /floor|ceiling|wall|defend|support|resist/i.test(x) && !/writing today|covering|closing positions|contracts\)/i.test(x)).slice(0, 3).map(x => `<div>${esc(x)}</div>`).join('')}</div><p class="note2"><a href="#options">Full options reading on Option Pulse →</a></p>`)}</div></div>`;
  $('#tfseg').onclick = e => { const b = e.target.closest('[data-tf]'); if (b) { st.tf = b.dataset.tf; render(); } };
  if (!window.LightweightCharts) { $('#lw').innerHTML = '<div class="err">Chart library did not load. Check the internet connection.</div>'; return; }
  if (!c.candles.length) { $('#lw').innerHTML = '<div class="empty">No candles for this symbol</div>'; return; }
  chart = LightweightCharts.createChart($('#lw'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Montserrat, system-ui, 'Segoe UI', sans-serif" },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') },
    timeScale: { borderColor: css('--line'), timeVisible: st.tf !== '1d' }, crosshair: { mode: 0 } });
  const s = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
  const IST = 19800;
  s.setData(c.candles.map(x => ({ time: x.t + (st.tf === '1d' ? 0 : IST), open: x.o, high: x.h, low: x.l, close: x.c })));
  lines.forEach(([k, v, col, ds]) => s.createPriceLine({ price: v, color: css(col), lineWidth: k.startsWith('Next') || k === 'Max pain' ? 1 : 2, lineStyle: ds, axisLabelVisible: true, title: k }));
  chart.timeScale().fitContent();
}

function radarSvg(f) {
  const keys = Object.keys(f), N = keys.length, cx = 170, cy = 150, R = 110;
  const pt = (i, v) => { const a = -Math.PI / 2 + i / N * Math.PI * 2, r = (v + 10) / 20 * R; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let g = '';
  [-10, -5, 0, 5, 10].forEach(v => g += `<polygon points="${keys.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="${css(v === 0 ? '--faint' : '--line')}" ${v === 0 ? 'stroke-dasharray="3 3"' : ''}/>`);
  keys.forEach((k, i) => { const [x, y] = pt(i, 10), [lx, ly] = pt(i, 13.6);
    g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${css('--line')}"/><text x="${lx}" y="${ly + 3}" text-anchor="middle" style="font-size:10.5px">${esc(k)}</text>`; });
  const poly = keys.map((k, i) => pt(i, f[k]).join(',')).join(' ');
  const avg = keys.reduce((a, k) => a + f[k], 0) / N, col = css(avg >= 0 ? '--up' : '--dn');
  g += `<polygon points="${poly}" fill="${col}" fill-opacity=".22" stroke="${col}" stroke-width="2"/>`;
  keys.forEach((k, i) => { const [x, y] = pt(i, f[k]); g += `<circle cx="${x}" cy="${y}" r="3.5" fill="${col}" data-tip="${esc(k)} ${f[k] > 0 ? '+' : ''}${f[k]}"/>`; });
  return `<svg viewBox="0 0 340 300" width="100%" style="max-width:420px;display:block;margin:0 auto" role="img" aria-label="Factor radar">${g}</svg>`;
}
async function vRadar() {
  symbar('radar', STK_CHIPS, false);
  const d = await api(`/api/radar?sym=${encodeURIComponent(st.sym.radar)}`);
  $('#headline').textContent = `${d.sym} ${px(d.last)} (${sg(d.chg)}%). ${d.summary}`;
  const r = d.range, w = r.hi - r.lo, pos = w ? (d.last - r.lo) / w * 100 : 50;
  const facts = Object.entries(d.factors).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r ${cls(v)}">${v > 0 ? '+' : ''}${n(v, 1)}</td><td style="width:45%"><div style="position:relative;height:8px;background:var(--soft);border-radius:4px"><span style="position:absolute;top:0;height:8px;border-radius:4px;background:var(${v >= 0 ? '--up' : '--dn'});${v >= 0 ? 'left:50%' : 'right:50%'};width:${Math.abs(v) * 5}%"></span></div></td></tr>`).join('');
  const o = d.opt;
  view.innerHTML = `<div class="grid g3">${card('Factor radar', radarSvg(d.factors), '−10 weak · +10 strong')}
    ${card('Setup reading', gauge(d.score, -10, 10, d.label, 'Describes today, not a forecast'))}
    <div class="grid">${card('Expected range', `<div class="num" style="font-size:20px;font-weight:600">${px(r.lo)} – ${px(r.hi)}</div>
      <div class="rangebar"><span style="left:0;width:${pos}%"></span><i style="left:calc(${pos}% - 1px)"></i></div>
      <div class="rangelbl"><span>low</span><span>now ${px(d.last)}</span><span>high</span></div>
      <div class="s mut" style="font-size:12.5px;margin-top:6px">${r.iv ? `From option IV ${n(r.iv, 1)}% to ${esc(r.by)}` : `From recent movement, over ${esc(r.by)}`}</div>`)}
      ${card('Last six months', spark(d.spark, 300, 70))}</div></div>
    <div class="grid g2">${card('Readings', `<table><tbody>${facts}</tbody></table>`)}
    ${card('Key numbers', `<table><tbody>
      <tr><td>RSI 14</td><td class="r">${n(d.rsi, 1)}</td></tr><tr><td>20 / 50 / 200 day average</td><td class="r">${px(d.ema20)} / ${px(d.ema50)} / ${px(d.ema200)}</td></tr>
      <tr><td>20 day VWAP</td><td class="r">${px(d.vwap20)}</td></tr><tr><td>20 day range</td><td class="r">${px(d.lo20)} – ${px(d.hi20)}</td></tr>
      <tr><td>ATR 14</td><td class="r">${px(d.atr)} (${n(d.atr_pct, 2)}%)</td></tr><tr><td>Realised volatility, 20 day</td><td class="r">${n(d.rv20, 1)}%</td></tr>
      ${o ? `<tr><td>Option floor / ceiling</td><td class="r">${px(o.floor)} / ${px(o.ceiling)}</td></tr><tr><td>PCR · Max pain</td><td class="r">${n(o.pcr, 2)} · ${px(o.max_pain)}</td></tr>
      <tr><td>IV vs realised</td><td class="r ${cls(-(d.iv_vs_rv || 0))}">${d.iv_vs_rv > 0 ? 'Options pricing more movement' : 'Options pricing less movement'} (${sg(d.iv_vs_rv, 1)} pts)</td></tr>` : ''}
    </tbody></table>`)}</div>`;
}

async function vCalm() {
  const d = await api('/api/calm');
  $('#headline').textContent = d.headline || 'Building the calm map…';
  const P = d.points; if (!P.length) { view.innerHTML = '<div class="empty">Still building, this takes about a minute the first time.</div>'; return; }
  const q95 = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length * .95)] || 1; };
  const xm = Math.ceil(q95(P.map(p => p.rv)) / 10) * 10, ym = Math.ceil(q95(P.map(p => p.range)) / 5) * 5;
  const W = 760, H = 420, pad = 44, tm = Math.max(...P.map(p => p.turn));
  const X = v => pad + Math.min(v, xm) / xm * (W - pad - 14), Y = v => H - 34 - Math.min(v, ym) / ym * (H - 60);
  const col = { before: css('--lu'), after: css('--sc'), none: css('--faint') };
  let g = '';
  for (let i = 0; i <= 4; i++) { const xv = xm * i / 4, yv = ym * i / 4;
    g += `<line x1="${X(xv)}" x2="${X(xv)}" y1="18" y2="${H - 34}" stroke="${css('--grid')}"/><text x="${X(xv)}" y="${H - 18}" text-anchor="middle" style="font-size:10px">${n(xv, 0)}%</text>
    <line x1="${pad}" x2="${W - 14}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="${css('--grid')}"/><text x="${pad - 6}" y="${Y(yv) + 3}" text-anchor="end" style="font-size:10px">${n(yv, 0)}%</text>`; }
  g += `<text x="${W - 14}" y="${H - 2}" text-anchor="end" style="font-size:10.5px">daily moves, annualised (20 day realised vol) →</text><text x="${pad}" y="12" style="font-size:10.5px">↑ 20 day range as % of price</text>`;
  [...P].reverse().forEach(p => { const r = 3 + Math.sqrt(p.turn / tm) * 14;
    g += `<circle cx="${X(p.rv)}" cy="${Y(p.range)}" r="${r}" fill="${col[p.status]}" fill-opacity=".55" stroke="${col[p.status]}" data-tip="${p.sym} · vol ${p.rv}% · range ${p.range}% · ${p.results ? 'results ' + p.results : 'no results date'} · 20d ${sg(p.chg20, 1)}%"/>`; });
  const placed = [];
  P.slice(0, 12).forEach(p => { const x = X(p.rv) + 8, y = Y(p.range) - 6;
    if (placed.some(([a, b]) => Math.abs(a - x) < 70 && Math.abs(b - y) < 13)) return;
    placed.push([x, y]); g += `<text x="${x}" y="${y}" style="font-size:10.5px;font-weight:600;fill:var(--ink);paint-order:stroke;stroke:var(--card);stroke-width:3px">${p.sym}</text>`; });
  const tbl = `<table><thead><tr><th>Stock</th><th class="r" title="Daily moves, annualised">Usual move a year</th><th class="r" title="High to low over 20 sessions">20 day range</th><th>Results</th></tr></thead><tbody>${P.slice(0, 14).map(p => `<tr><td>${symlink(p.sym)}</td><td class="r">${n(p.rv, 1)}%</td><td class="r">${n(p.range, 1)}%</td><td>${p.results ? `<span class="pill ${p.status === 'before' ? 'p-lu' : 'p-sc'}">${p.results}</span>` : '<span class="mut">–</span>'}</td></tr>`).join('')}</tbody></table>`;
  view.innerHTML = `<div class="grid g-main">${card('Calm map, all F&amp;O stocks', `<div class="legend" style="margin-bottom:6px"><span><i style="background:var(--lu)"></i>Results before ${esc(d.expiry || 'expiry')}</span><span><i style="background:var(--sc)"></i>Results after expiry</span><span><i style="background:var(--faint)"></i>No date announced</span><span class="mut">size = traded value</span></div><div class="svgwrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:560px">${g}</svg></div>`)}
    ${card('Quietest 14', `<div class="tw">${tbl}</div>`)}</div>`;
}

async function vGlobal() {
  const d = await api('/api/global');
  const by = g => d.items.filter(i => i.grp === g);
  const btc = d.items.find(i => i.t === 'BTC-USD'), gold = d.items.find(i => i.t === 'GC=F'), us = d.items.find(i => i.t === '^GSPC');
  $('#headline').textContent = `S&P 500 ${us ? sg(us.chg) + '%' : ''}, Bitcoin ${btc ? '$' + n(btc.last, 0) + ' (' + sg(btc.chg) + '%)' : ''}, gold ${gold ? '$' + n(gold.last, 0) + ', about ₹' + n(gold.inr) + ' per 10g' : ''}.`;
  const tile = i => `<div class="gi"><div class="n">${esc(i.name)}</div><div class="v">${i.grp === 'crypto' || i.grp === 'metal' || i.grp === 'energy' ? '$' : ''}${n(i.last, i.last < 20 ? 2 : i.last < 1000 ? 2 : 0)}</div>
    <div class="num ${cls(i.chg)}" style="font-size:12.5px">${sg(i.chg)}%${i.inr ? ` · ₹${n(i.inr)}${i.t === 'GC=F' ? '/10g' : '/kg'}` : ''}</div>${spark(i.spark, 160, 34)}</div>`;
  const grp = (t, g) => by(g).length ? card(t, `<div class="glob">${by(g).map(tile).join('')}</div>`) : '';
  view.innerHTML = grp('United States', 'us') + `<p class="note2">The % is the latest day. The small line shows about the last month, so the two can point different ways.</p><div class="grid g2">${grp('Europe', 'eu')}${grp('Asia', 'asia')}</div>` + grp('Currency and yields', 'fx') + `<div class="grid g2">${grp('Metals', 'metal')}${grp('Energy', 'energy')}</div>` + grp('Crypto', 'crypto');
}

const SCR_DEF = { cap: ['Large', 'Mid', 'Small'], g: '', val: '', debt: '', trend: '', near: '', roce: '', res: false, micro: false, sort: 'm' };
const SCR_PRESETS = [
  ['High return on capital, low debt', { roce: '15', debt: 'low' }],
  ['Uptrend, near its 52 week high', { trend: 'up', near: 'hi' }],
  ['Cheaper than its sector, profitable', { val: 'cheap', roce: '10' }],
  ['Near its 52 week low', { near: 'lo' }],
  ['Results out this week', { res: true }]];
async function vScreener() {
  const d = await api('/api/screener');
  stamp(d.ts);
  const f = st.scr = st.scr || JSON.parse(JSON.stringify(SCR_DEF));
  const keep = r => {
    if (!(f.cap.includes(r.c) || (f.micro && r.c === 'Micro'))) return false;
    if (f.g && r.g !== f.g) return false;
    if (f.val === 'cheap' && !(r.pe && r.spe && r.pe < r.spe * 0.85)) return false;
    if (f.val === 'rich' && !(r.pe && r.spe && r.pe > r.spe * 1.15)) return false;
    if (f.debt === 'low' && (r.bank || r.de == null || r.de > 0.5)) return false;
    if (f.debt === 'none' && (r.bank || r.de == null || r.de > 0.1)) return false;
    if (f.debt === 'high' && (r.bank || r.de == null || r.de < 1)) return false;
    if (f.trend && r.t !== f.trend) return false;
    if (f.near === 'hi' && !(r.hi != null && r.hi >= -5)) return false;
    if (f.near === 'lo' && !(r.lo != null && r.lo <= 5)) return false;
    if (f.roce && !(r.roce != null && r.roce >= +f.roce)) return false;
    if (f.res && !r.res) return false;
    return true;
  };
  const sorts = { m: (a, b) => b.m - a.m, p: (a, b) => b.p - a.p, r3: (a, b) => (b.r3 ?? -999) - (a.r3 ?? -999), pe: (a, b) => (a.pe ?? 1e9) - (b.pe ?? 1e9), roce: (a, b) => (b.roce ?? -999) - (a.roce ?? -999) };
  const hits = d.rows.filter(keep).sort(sorts[f.sort] || sorts.m);
  $('#headline').textContent = `${n(hits.length)} of ${n(d.rows.length)} listed stocks meet these conditions.`;
  const sel = (k, opts) => `<select data-f="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(f[k]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const tr = { up: 'Uptrend', dn: 'Downtrend', flat: 'Sideways' };
  const deTxt = r => r.bank ? '<span class="mut">lender</span>' : r.de == null ? '–' : `<span class="${r.de >= 1 ? 'dn' : ''}">${n(r.de, 2)}</span>`;
  const shown = hits.slice(0, st.scrAll ? 400 : 60);
  view.innerHTML = `<section class="card scr-f">
      <div class="scr-pre"><span class="k">Start from</span>${SCR_PRESETS.map(([t], i) => `<button class="chip" data-pre="${i}">${t}</button>`).join('')}<button class="chip" id="scr-reset">Clear all</button></div>
      <div class="scr-grid">
        <label><span>Size</span><div class="scr-caps">${['Large', 'Mid', 'Small'].map(c => `<button class="${f.cap.includes(c) ? 'on' : ''}" data-cap="${c}">${c}</button>`).join('')}<button class="${f.micro ? 'on' : ''}" data-cap="Micro">Micro</button></div></label>
        <label><span>Sector</span>${sel('g', [['', 'Any sector'], ...d.sectors.map(g => [g, g])])}</label>
        <label><span>Valuation</span>${sel('val', [['', 'Any'], ['cheap', 'Cheaper than its sector'], ['rich', 'Richer than its sector']])}</label>
        <label><span>Return on capital</span>${sel('roce', [['', 'Any'], ['10', '10% or more'], ['15', '15% or more'], ['20', '20% or more']])}</label>
        <label><span>Debt</span>${sel('debt', [['', 'Any'], ['none', 'Almost none'], ['low', 'Low'], ['high', 'High']])}</label>
        <label><span>Trend</span>${sel('trend', [['', 'Any'], ['up', 'Uptrend'], ['flat', 'Sideways'], ['dn', 'Downtrend']])}</label>
        <label><span>52 week range</span>${sel('near', [['', 'Anywhere'], ['hi', 'Within 5% of the high'], ['lo', 'Within 5% of the low']])}</label>
        <label class="scr-ck"><input type="checkbox" data-f="res" ${f.res ? 'checked' : ''}><span>Results out in the last 7 days</span></label>
      </div></section>
    ${card(`${n(hits.length)} stocks`, hits.length ? `<div class="tw"><table class="scr-t"><thead><tr><th>Stock</th><th>Sector</th>${[['m', 'Size'], ['p', 'Today'], ['r3', '3 months'], ['pe', 'P/E'], ['', 'Sector P/E'], ['roce', 'ROCE'], ['', 'Debt to equity'], ['', 'Trend']].map(([k, t]) => `<th class="r${k ? ' sortable' + (f.sort === k ? ' on' : '') : ''}" ${k ? `data-sort="${k}"` : ''}>${t}</th>`).join('')}</tr></thead><tbody>
      ${shown.map(r => `<tr class="sc-r" data-stock="${esc(r.s)}"><td><b>${esc(r.s)}</b><small>${esc(r.n)}</small></td><td class="mut">${esc(r.g)}</td><td class="r mut">${esc(r.c)}</td>
        <td class="r num ${cls(r.p)}">${sg(r.p)}%</td><td class="r num ${cls(r.r3)}">${r.r3 == null ? '–' : sg(r.r3, 1) + '%'}</td><td class="r num">${r.pe ? n(r.pe, 1) : '<span class="mut">–</span>'}</td>
        <td class="r num mut">${r.spe ? n(r.spe, 1) : '–'}</td><td class="r num">${r.roce == null ? '–' : n(r.roce, 1) + '%'}</td><td class="r num">${deTxt(r)}</td><td class="r ${r.t === 'up' ? 'up' : r.t === 'dn' ? 'dn' : 'mut'}">${tr[r.t] || '–'}</td></tr>`).join('')}</tbody></table></div>
      ${hits.length > shown.length ? `<button class="wbtn more" id="scr-all">Show ${st.scrAll ? '' : 'up to 400'}</button>` : ''}` : '<div class="empty">No stock meets all of these. Loosen one condition.</div>', 'click a heading to sort · tap a stock to open it')}
    <p class="note2">A filter on reported numbers, not a list of stocks to buy. Figures come from the latest filings and the last close, so they can lag a fresh result.</p>`;
  const re = () => render(true);
  view.querySelectorAll('[data-f]').forEach(el => { el.onchange = () => { f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; re(); }; });
  view.querySelectorAll('[data-cap]').forEach(b => { b.onclick = () => { const c = b.dataset.cap; if (c === 'Micro') f.micro = !f.micro; else f.cap = f.cap.includes(c) ? f.cap.filter(x => x !== c) : [...f.cap, c]; re(); }; });
  view.querySelectorAll('[data-sort]').forEach(h => { h.onclick = () => { f.sort = h.dataset.sort; re(); }; });
  view.querySelectorAll('[data-pre]').forEach(b => { b.onclick = () => { st.scr = { ...JSON.parse(JSON.stringify(SCR_DEF)), ...SCR_PRESETS[+b.dataset.pre][1] }; re(); }; });
  $('#scr-reset').onclick = () => { st.scr = JSON.parse(JSON.stringify(SCR_DEF)); re(); };
  const al = $('#scr-all'); if (al) al.onclick = () => { st.scrAll = true; re(); };
}

/* ---------- in-app journal: trades live in this browser only ---------- */
// declared as functions and reading storage directly: the first page can render before the alert helpers further down exist
function tLoad() { try { return JSON.parse(localStorage.getItem('72s-trades')) || []; } catch (e) { return []; } }
function tSave(v) { try { localStorage.setItem('72s-trades', JSON.stringify(v)); } catch (e) {} }
const tPnl = t => t.exit == null || t.exit === '' ? null : (t.side === 'short' ? t.entry - t.exit : t.exit - t.entry) * t.qty;
const tR = t => { const p = tPnl(t); return p == null || !t.stop || t.stop === t.entry ? null : p / (Math.abs(t.entry - t.stop) * t.qty); };
function journalApp() {
  const T = tLoad().sort((a, b) => (b.date || '').localeCompare(a.date || '')), closed = T.filter(t => tPnl(t) != null);
  const pn = closed.map(tPnl), wins = pn.filter(x => x > 0), net = pn.reduce((a, x) => a + x, 0);
  const rs = closed.map(tR).filter(x => x != null), exp = rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null;
  const plan = k => closed.filter(t => t.plan === k).reduce((a, t) => a + tPnl(t), 0);
  const month = st.jMonth || new Date().toISOString().slice(0, 7), [yy, mm] = month.split('-').map(Number);
  const days = new Date(yy, mm, 0).getDate(), first = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
  const byDay = {}; closed.forEach(t => { if ((t.date || '').startsWith(month)) byDay[t.date] = (byDay[t.date] || 0) + tPnl(t); });
  const cal = `<div class="jc-h"><button class="jc-nav" data-jm="-1">‹</button><b>${new Date(yy, mm - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b><button class="jc-nav" data-jm="1">›</button></div>
    <div class="jc">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span class="jc-d">${x}</span>`).join('')}${'<span></span>'.repeat(first)}${Array.from({ length: days }, (_, i) => {
      const k = `${month}-${String(i + 1).padStart(2, '0')}`, v = byDay[k];
      return `<span class="jc-c${v == null ? '' : v >= 0 ? ' up' : ' dn'}"><i>${i + 1}</i>${v == null ? '' : `<b class="num">${v >= 0 ? '+' : '−'}₹${n(Math.abs(v))}</b>`}</span>`; }).join('')}</div>`;
  const eq = (() => { const xs = closed.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')); let c = 0; const pts = xs.map(t => (c += tPnl(t)));
    if (pts.length < 2) return '<p class="mut sc-none">The equity curve appears after two closed trades.</p>';
    const W = 520, H = 120, lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), y = v => H - 8 - (v - lo) / ((hi - lo) || 1) * (H - 16), x = i => i / (pts.length - 1) * W;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="${css('--line')}"/><polyline fill="none" stroke="${css(c >= 0 ? '--up' : '--dn')}" stroke-width="2" points="${pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/></svg>`; })();
  const rs_ = v => `${v >= 0 ? '+' : '−'}₹${n(Math.abs(v))}`;
  const stat = (k, v, cl = '') => `<div class="jx"><span>${k}</span><b class="num ${cl}">${v}</b></div>`;
  const rows = T.slice(0, 50).map(t => { const p = tPnl(t), r = tR(t);
    return `<tr><td class="num">${esc(t.date || '')}</td><td><b>${esc(t.sym)}</b></td><td>${t.side === 'short' ? 'Short' : 'Long'}</td><td class="r num">${n(t.qty)}</td><td class="r num">${px(t.entry)}</td><td class="r num">${t.exit == null || t.exit === '' ? '<span class="mut">open</span>' : px(t.exit)}</td>
      <td class="r num ${p == null ? '' : cls(p)}">${p == null ? '–' : `${p >= 0 ? '+' : '−'}₹${n(Math.abs(p))}`}</td><td class="r num">${r == null ? '–' : `${r >= 0 ? '+' : '−'}${n(Math.abs(r), 1)}R`}</td><td class="mut">${esc(t.setup || '')}</td><td><button class="jt-x" data-jdel="${esc(t.id)}" aria-label="Delete trade">×</button></td></tr>`; }).join('');
  const sel = (id, opts) => `<select id="${id}">${opts.map(o => `<option>${o}</option>`).join('')}</select>`;
  return `<section class="card jn"><h3>Your journal<small>saved in this browser only · ${T.length} trade${T.length === 1 ? '' : 's'}</small></h3>
    <form class="jf" id="jf">
      <label>Date<input id="jf-d" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
      <label>Stock<input id="jf-s" list="stock-list" placeholder="RELIANCE" required autocomplete="off"></label>
      <label>Side${sel('jf-side', ['Long', 'Short'])}</label>
      <label>Quantity<input id="jf-q" type="number" min="1" step="1" required></label>
      <label>Entry, ₹<input id="jf-e" type="number" step="any" required></label>
      <label>Exit, ₹<input id="jf-x" type="number" step="any" placeholder="blank if open"></label>
      <label>Stop, ₹<input id="jf-sl" type="number" step="any" placeholder="for R multiple"></label>
      <label>Setup${sel('jf-setup', ['Breakout', 'Order block', 'Results', 'Options', 'Trend', 'Other'])}</label>
      <label>Mood${sel('jf-mood', ['Calm', 'FOMO', 'Bored', 'Revenge', 'Confident'])}</label>
      <label>Plan followed?${sel('jf-plan', ['Yes', 'No'])}</label>
      <label class="jf-n">Notes<input id="jf-note" maxlength="200" placeholder="why you took it, what you learned"></label>
      <button type="submit">Add trade</button></form>
    ${T.length ? `<div class="jxs">${stat('Closed trades', n(closed.length))}${stat('Win rate', closed.length ? n(wins.length / closed.length * 100) + '%' : '–')}${stat('Net P&amp;L', closed.length ? `${net >= 0 ? '+' : '−'}₹${n(Math.abs(net))}` : '–', closed.length ? cls(net) : '')}
      ${stat('Expectancy', exp == null ? '–' : `${exp >= 0 ? '+' : '−'}${n(Math.abs(exp), 2)}R per trade`, exp == null ? '' : cls(exp))}${stat('Biggest loss', pn.length && Math.min(...pn) < 0 ? `−₹${n(Math.abs(Math.min(...pn)))}` : '–', 'dn')}
      ${stat('Plan followed vs not', closed.length ? `${rs_(plan('Yes'))} vs ${rs_(plan('No'))}` : '–')}</div>
    <div class="jg"><div><h4 class="sc-h">P&amp;L calendar</h4>${cal}</div><div><h4 class="sc-h">Equity curve</h4>${eq}</div></div>
    <div class="tw"><table class="jt"><thead><tr><th>Date</th><th>Stock</th><th>Side</th><th class="r">Qty</th><th class="r">Entry</th><th class="r">Exit</th><th class="r">P&amp;L</th><th class="r">R</th><th>Setup</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="mut sc-none">Your first trade starts the P&amp;L calendar, win rate and equity curve.</p>'}
    <p class="note2">Trades never leave this browser. Clearing browser data deletes them, so keep the Excel journal too if you want a copy. <button class="lf-more" id="jf-csv" type="button">Export as CSV</button></p></section>`;
}
function journalWire() {
  const f = $('#jf'); if (!f) return;
  f.onsubmit = e => { e.preventDefault(); const v = id => $(id).value.trim(), num = id => v(id) === '' ? null : parseFloat(v(id));
    const t = { id: Date.now().toString(36), date: v('#jf-d'), sym: v('#jf-s').toUpperCase(), side: v('#jf-side').toLowerCase(), qty: num('#jf-q'), entry: num('#jf-e'), exit: num('#jf-x'), stop: num('#jf-sl'),
      setup: v('#jf-setup'), mood: v('#jf-mood'), plan: v('#jf-plan'), note: v('#jf-note') };
    if (!t.sym || !(t.qty > 0) || !(t.entry > 0)) return;
    tSave([...tLoad(), t]); render(true); };
  view.querySelectorAll('[data-jdel]').forEach(b => { b.onclick = () => { tSave(tLoad().filter(t => t.id !== b.dataset.jdel)); render(true); }; });
  view.querySelectorAll('[data-jm]').forEach(b => { b.onclick = () => { const [y, m] = (st.jMonth || new Date().toISOString().slice(0, 7)).split('-').map(Number), d = new Date(y, m - 1 + (+b.dataset.jm), 1);
    st.jMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render(true); }; });
  const c = $('#jf-csv'); if (c) c.onclick = () => { const T = tLoad(), head = ['date', 'sym', 'side', 'qty', 'entry', 'exit', 'stop', 'setup', 'mood', 'plan', 'note'];
    const csv = [head.join(','), ...T.map(t => head.map(k => `"${String(t[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = '72street-journal.csv'; a.click(); };
}
function vJournal() {
  $('#headline').textContent = 'A free trading journal that shows where your money actually goes.';
  loadSearch();
  const saved = (() => { try { return JSON.parse(localStorage.getItem('72s-sizer') || '{}'); } catch (e) { return {}; } })();
  const f = (id, lbl, v, hint) => `<label class="jz-f"><span>${lbl}</span><input id="${id}" type="number" inputmode="decimal" step="any" value="${v ?? ''}">${hint ? `<em>${hint}</em>` : ''}</label>`;
  view.innerHTML = `${journalApp()}<section class="jz-top">
      <div class="card jz-pitch"><h3>Most traders do not lose on stock picking</h3>
        <p>They lose on position size, on moving the stop, and on the trade taken out of boredom. The journal above and this Excel version make all three visible.</p>
        <ol class="jz-steps">
          <li><b>Settings.</b> Your capital and how much you are willing to lose on one trade. Set it once.</li>
          <li><b>Position sizer.</b> Entry and stop in, number of shares out, with what you lose if the stop is hit.</li>
          <li><b>Journal.</b> Log each trade. Quantity, planned reward to risk, profit and R multiple fill in by themselves.</li>
          <li><b>Review.</b> Your real numbers: expectancy, biggest loss, oversized trades, and profit split by setup, by mood and by whether you followed your plan.</li></ol>
        <a class="jz-dl" href="72Street_Trading_Journal.xlsx" download>Download the journal (Excel, free)</a>
        <p class="note2">Works in Excel, Google Sheets and WPS. Your trades stay in your own file. No sign up needed.</p></div>
      <div class="card jz-calc"><h3>Position size calculator <small>try it here</small></h3>
        <div class="jz-in">${f('jz-cap', 'Trading capital, ₹', saved.cap ?? 500000)}${f('jz-risk', 'Risk per trade, % of capital', saved.risk ?? 1, '1% is a common starting point')}
          ${f('jz-en', 'Entry price, ₹', saved.en ?? '')}${f('jz-sl', 'Stop loss, ₹', saved.sl ?? '')}${f('jz-tg', 'Target, ₹ (optional)', saved.tg ?? '')}</div>
        <div class="jz-out" id="jz-out"></div>
        <p class="note2">Your numbers stay in this browser. This is a calculator for your own plan, not a suggestion of what to trade.</p></div>
    </section>
    <section class="card"><h3>Why a journal works</h3><div class="jz-why">
      <div><b>R multiple</b><p>Profit or loss divided by the amount you risked. A +2R trade made twice what you were ready to lose. It lets you compare a ₹500 stock with a ₹5,000 one.</p></div>
      <div><b>Expectancy</b><p>What an average trade earns you, in R. Above zero means your method makes money over many trades, even with more losers than winners.</p></div>
      <div><b>Plan followed?</b><p>The Review sheet splits profit by whether you stuck to your plan. For most traders the gap between the two is the single biggest lesson.</p></div></div></section>
    ${appBridge()}`;
  const calc = () => {
    const v = id => parseFloat($(id).value), cap = v('#jz-cap'), risk = v('#jz-risk'), en = v('#jz-en'), sl = v('#jz-sl'), tg = v('#jz-tg');
    try { localStorage.setItem('72s-sizer', JSON.stringify({ cap, risk, en, sl, tg })); } catch (e) {}
    const out = $('#jz-out');
    if (!(cap > 0 && risk > 0 && en > 0 && sl > 0) || en === sl) { out.innerHTML = '<p class="mut">Enter an entry and a stop loss to see how many shares fit your risk.</p>'; return; }
    const per = Math.abs(en - sl), budget = cap * risk / 100, qty = Math.floor(budget / per), cost = qty * en, side = en > sl ? 'long' : 'short';
    const capQ = Math.floor(cap / en), capped = qty > capQ, q = capped ? capQ : qty;
    const rr = tg > 0 ? (side === 'long' ? (tg - en) : (en - tg)) / per : null;
    out.innerHTML = `<div class="jz-big"><span>Shares</span><b class="num">${n(q)}</b></div>
      <div class="jz-row"><span>Money needed</span><b class="num">₹${n(q * en)}</b></div>
      <div class="jz-row"><span>Loss if the stop is hit</span><b class="num dn">₹${n(q * per)}</b></div>
      ${rr != null ? `<div class="jz-row"><span>Gain if the target is hit</span><b class="num up">₹${n(q * per * rr)}</b></div><div class="jz-row"><span>Reward to risk</span><b class="num">${n(rr, 2)} to 1</b></div>` : ''}
      ${capped ? `<p class="jz-warn">Your capital covers only ${n(capQ)} shares at this price, fewer than your risk allows.</p>` : ''}
      ${q * en > cap * 0.25 && !capped ? `<p class="jz-warn">This one trade would use ${n(q * en / cap * 100, 0)}% of your capital. A tight stop makes the size large.</p>` : ''}
      <p class="mut" style="font-size:12.5px">${side === 'long' ? 'Buying' : 'Short selling'}: ₹${n(per, 2)} at risk on each share, ₹${n(budget)} at risk in total.</p>`;
  };
  view.querySelectorAll('.jz-in input').forEach(i => { i.oninput = calc; });
  calc();
  journalWire();
}

async function vScreens() {
  const d = await api('/api/screens');
  $('#headline').textContent = `Leaving out micro caps, ${d.highs_n} companies hit a new 52 week high today and ${d.lows_n} a new low.`;
  const bySec = rows => { const m = {}; rows.forEach(r => { if (r.g) m[r.g] = (m[r.g] || 0) + 1; }); return Object.entries(m).filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3); };
  const cl = (rows, w) => { const s = bySec(rows); return s.length ? `${w} cluster in ${s.map(([g, k]) => `${esc(g)} (${k})`).join(', ')}.` : ''; };
  const clus = [cl(d.highs, 'Highs'), cl(d.lows, 'Lows')].filter(Boolean).join(' ');
  const tb = rows => rows.length ? `<table><thead><tr><th>Stock</th><th>Sector</th><th>Size</th><th class="r">Price</th><th class="r">Today</th></tr></thead><tbody>${rows.map(r => `<tr class="sc-r" data-stock="${esc(r.sym)}"><td><b>${esc(r.sym)}</b><small>${esc(r.name)}</small></td><td class="mut">${esc(r.g || '')}</td><td class="mut">${esc(r.cap)}</td><td class="r num">${px(r.ltp)}</td><td class="r num ${cls(r.chg)}">${sg(r.chg)}%</td></tr>`).join('')}</tbody></table>` : '<div class="empty">None today</div>';
  view.innerHTML = `${clus ? `<p class="sc-clus">${clus} When one sector keeps showing up, the move is about the sector, not one company.</p>` : ''}<div class="grid g2">${card('New 52 week highs', `<div class="tw">${tb(d.highs)}</div>`, 'largest first')}${card('New 52 week lows', `<div class="tw">${tb(d.lows)}</div>`, 'largest first')}</div>
    <p class="note2">Large, mid and small caps. Micro caps are left out because they are thinly traded. What the data shows, not a recommendation.</p>`;
}

function vLearn() {
  $('#headline').textContent = 'Every idea on this desk, in plain words.';
  const gloss = [['VIX', 'India VIX measures how much movement the options market expects in Nifty over the next 30 days. Rising VIX means traders are paying more for protection.'],
    ['Open interest', 'The number of option or futures contracts still open. Price tells you where the market is. Open interest tells you how many people are committed to it.'],
    ['Option writer', 'The seller of an option. Writers collect the premium and want the price to stay away from their strike, so the strikes they crowd into act as support or resistance.'],
    ['Straddle', 'Buying the call and put at the same strike. Its price is the market\'s estimate of how far the stock will move by expiry, in either direction.'],
    ['Implied volatility', 'The volatility the option price implies. When IV is above realised volatility, options are pricing more movement than the stock has actually shown.'],
    ['Realised volatility', 'How much the price has actually moved, from daily closes, expressed as a yearly percentage so it can be compared with IV.']];
  view.innerHTML = `<div class="grid g2 learn">${Object.entries(EXPLAIN).filter(([k]) => k !== 'learn' && k !== 'radar').sort(([a], [b]) => (LEARN_ORDER.indexOf(a) + 1 || 99) - (LEARN_ORDER.indexOf(b) + 1 || 99)).map(([k, [t, items]]) => `<div class="card"><h4>${t}</h4>${items.map(x => `<p>${x}</p>`).join('')}<p><a href="#${k}">Open ${t} →</a></p></div>`).join('')}
    ${gloss.map(([t, x]) => `<div class="card"><h4>${t}</h4><p>${x}</p></div>`).join('')}</div>`;
}

function expBar(c) {
  if (!c.priced) return '';
  const e = c.priced, rx = c.reaction;
  const span = Math.max(e * 2.2, Math.abs(rx ?? 0) * 1.15, 2);     // half-width of the scale, in %
  const pos = v => 50 + Math.max(-50, Math.min(50, v / span * 50));
  const word = rx == null ? 'Reaction comes next session'
    : Math.abs(rx) > e * 1.5 ? `Moved ${(Math.abs(rx) / e).toFixed(1)}× what options expected`
    : Math.abs(rx) > e ? 'A bit more than options expected' : 'Inside what options expected';
  return `<div class="xbar"><div class="xb-h"><span>Options expected <b class="num">±${n(e, 1)}%</b></span><span class="${rx == null ? 'mut' : Math.abs(rx) > e ? 'hot' : ''}">${word}</span></div>
    <div class="xb-t"><i class="xb-band" style="left:${pos(-e)}%;width:${pos(e) - pos(-e)}%"></i><i class="xb-mid" style="left:50%"></i>
    ${rx != null ? `<i class="xb-m ${cls(rx)}" style="left:${pos(rx)}%"><b class="num">${sg(rx, 1)}%</b></i>` : ''}</div></div>`;
}
function resCard(c) {
  const t = c.reaction;
  return `<div class="rcard">
    <div class="rc-h" data-stock="${esc(c.sym)}"><div><b>${esc(c.name)}</b><span>${esc(c.sym)}${c.industry ? ' · ' + esc(c.industry) : ''}</span></div>
      ${t != null ? `<div class="rc-rx ${cls(t)}"><b class="num">${sg(t, 1)}%</b><span>${esc(c.reaction_day || '')}</span></div>` : '<div class="rc-rx mut"><span>Market reaction next session</span></div>'}</div>
    <div class="rc-n"><div><span>${c.lender ? 'Income' : 'Sales'} YoY</span><b class="num ${cls(c.sales_yoy)}">${c.sales_yoy == null ? '–' : sg(c.sales_yoy, 0) + '%'}</b></div>
      <div><span>Profit YoY</span><b class="num ${cls(c.profit_yoy)}">${c.profit_yoy == null ? '–' : sg(c.profit_yoy, 0) + '%'}</b></div>
      <div><span>Profit QoQ</span><b class="num ${cls(c.profit_qoq)}">${c.profit_qoq == null ? '–' : sg(c.profit_qoq, 0) + '%'}</b></div>
      <div><span>Net profit, ₹ cr</span><b class="num ${(c.profit || 0) < 0 ? 'dn' : ''}">${c.profit == null ? '–' : (c.profit < 0 ? '−' : '') + n(Math.abs(c.profit))}</b></div></div>
    ${expBar(c)}
    <ul class="m-ch">${(c.read || []).map(l => `<li class="t-${l.tone}">${esc(l.text)}</li>`).join('')}</ul>
    <div class="rc-f"><span>${esc(c.quarter || '')} results · filed ${esc(c.filed)}</span><button class="share" data-share="${esc(c.sym)}">Share card</button></div></div>`;
}
document.addEventListener('click', e => {
  const f = e.target.closest('[data-capf]');
  const m = e.target.closest('#repmore');
  if (!f && !m) return;
  const cards = st.repCards || []; const g = $('#repgrid'); if (!g) return;
  if (f) { document.querySelectorAll('[data-capf]').forEach(b => b.classList.toggle('on', b === f)); st.capf = f.dataset.capf; }
  const list = cards.filter(c => !st.capf || st.capf === 'All' || c.cap === st.capf);
  const all = !!m || list.length <= 24;
  g.innerHTML = list.slice(0, all ? list.length : 24).map(resCard).join('') || '<div class="empty">None in this group yet.</div>';
  const mb = $('#repmore'); if (mb) { mb.hidden = all; mb.textContent = `Show all ${list.length}`; }
});
async function vResults() {
  st.capf = 'All';
  let rep = null;
  try { rep = await api('/api/reported'); } catch (e) {}
  const caps = ['All', 'Large', 'Mid', 'Small', 'Micro'];
  if (rep && rep.cards) { const rk = { Large: 0, Mid: 1, Small: 2, Micro: 3 }; rep.cards.sort((a, b) => (rk[a.cap] ?? 4) - (rk[b.cap] ?? 4) || (b.filed_iso > a.filed_iso ? 1 : -1)); }
  const repHtml = rep ? (rep.cards.length ? `<h2 class="sec-h" id="sec-just">Just reported <small>${esc(rep.headline)}</small></h2><p class="note2"><a href="#" id="to-coming">Jump to who reports next →</a></p>
    <div class="chips capf">${caps.map(k => `<button class="chip ${k === 'All' ? 'on' : ''}" data-capf="${k}">${k === 'All' ? 'All' : k + ' cap'} <i>${k === 'All' ? rep.cards.length : rep.cards.filter(c => c.cap === k).length}</i></button>`).join('')}</div>
    <div class="rcards" id="repgrid">${rep.cards.slice(0, 24).map(resCard).join('')}</div>${rep.cards.length > 24 ? `<button class="wbtn more" id="repmore">Show all ${rep.cards.length}</button>` : ''}`
    : `<div class="card empty">${esc(rep.headline)}</div>`) : '';
  st.repCards = rep ? rep.cards : [];
  const d = await api('/api/results');
  $('#headline').textContent = d.headline;
  if (!d.rows.length) { view.innerHTML = repHtml + `<div class="card empty">${d.building ? 'Building, this view refreshes itself in a minute.' : 'Nothing scheduled.'}</div>`; return; }
  const mx = Math.max(...d.rows.map(r => r.move_pct));
  const byDay = {};
  d.rows.forEach(r => (byDay[r.iso] = byDay[r.iso] || []).push(r));
  const top = [...d.rows].filter(r => r.premium).sort((a, b) => b.premium - a.premium).slice(0, 4);
  const rowsHtml = Object.entries(byDay).map(([iso, rs]) => `<tr><td colspan="7" style="background:var(--soft);font-weight:600;font-size:12.5px">${rs[0].dow} ${rs[0].date} · ${rs.length} ${rs.length > 1 ? 'companies' : 'company'}</td></tr>` +
    rs.sort((a, b) => b.move_pct - a.move_pct).map(r => `<tr><td>${symlink(r.sym, 'options')}<div style="font-size:11.5px;color:var(--mut);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.company)}</div></td>
      <td class="r">${px(r.spot)}</td>
      <td style="min-width:150px"><div style="display:flex;align-items:center;gap:8px"><span style="flex:1;height:8px;background:var(--soft);border-radius:4px;position:relative"><span style="position:absolute;inset:0 auto 0 0;width:${r.move_pct / mx * 100}%;background:var(--accent);border-radius:4px"></span></span><b class="num">±${n(r.move_pct, 1)}%</b></div></td>
      <td class="r">${px(r.lo)} – ${px(r.hi)}</td><td class="r">${r.usual_pct ? '±' + n(r.usual_pct, 1) + '%' : '–'}</td>
      <td class="r">${r.premium ? `<span class="pill ${r.premium >= 2 ? 'p-lu' : 'p-sc'}">${n(r.premium, 1)}x</span>` : '–'}</td><td class="r mut">${esc(r.expiry.slice(0, 6))}</td></tr>`).join('')).join('');
  setTimeout(() => { const j = $('#to-coming'); if (j) j.onclick = e => { e.preventDefault(); $('#sec-coming').scrollIntoView({ behavior: 'smooth' }); }; }, 0);
  view.innerHTML = repHtml + `<h2 class="sec-h" id="sec-coming">Coming up <small>${esc(d.headline)}</small></h2><div id="read-slot"></div><div class="grid g4">${top.map(r => stat(`${r.sym} · ${r.dow} ${r.date}`, '±' + n(r.move_pct, 1) + '%', `${n(r.premium, 1)}x its usual move`, `Priced range ${px(r.lo)} – ${px(r.hi)}`)).join('')}</div>
    ${card('Results and priced moves', `<div class="tw"><table><thead><tr><th>Company</th><th class="r">Price</th><th>Priced move</th><th class="r">Priced range</th><th class="r">Usual</th><th class="r">Event premium</th><th class="r">Expiry</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`, 'tap a symbol for its option chain')}`;
}

function lineChart(series, opts) {
  const W = 760, H = opts.h || 260, pl = 54, pr = 14, pt = 14, pb = 28;
  const all = series.flatMap(s => s.pts.map(p => p.v)).filter(v => v != null);
  if (!all.length) return '<div class="empty">No data</div>';
  let lo = Math.min(...all), hi = Math.max(...all); const padv = (hi - lo) * .08 || 1; const pos0 = lo >= 0; lo -= padv; hi += padv; if (pos0 && lo < 0) lo = 0;
  const N = Math.max(...series.map(s => s.pts.length)), X = i => pl + i / Math.max(N - 1, 1) * (W - pl - pr), Y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css('--grid')}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end" style="font-size:9px">${opts.fmt ? opts.fmt(v) : px(v)}</text>`; }
  if (opts.ref != null && opts.ref > lo && opts.ref < hi) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(opts.ref)}" y2="${Y(opts.ref)}" stroke="${css('--faint')}" stroke-dasharray="4 4"/>`;
  const lbl = series[0].pts; const step = Math.ceil(lbl.length / 8);
  lbl.forEach((p, i) => { if (i % step === 0 || i === lbl.length - 1) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" style="font-size:9px">${opts.lab ? opts.lab(p.d) : p.d.slice(5).split('-').reverse().join('/')}</text>`; });
  series.forEach(s => { const pts = s.pts.map((p, i) => p.v == null ? null : `${X(i)},${Y(p.v)}`).filter(Boolean).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${s.c}" stroke-width="${s.w || 2}" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    s.pts.forEach((p, i) => { if (p.v != null) g += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="7" fill="transparent" data-tip="${p.d} · ${s.name} ${opts.fmt ? opts.fmt(p.v) : px(p.v)}"/>`; });
    const lp = s.pts[s.pts.length - 1]; if (lp && lp.v != null) g += `<circle cx="${X(s.pts.length - 1)}" cy="${Y(lp.v)}" r="3.5" fill="${s.c}"/>`; });
  return `<div class="legend" style="margin-bottom:6px">${series.map(s => `<span><i style="background:${s.c}"></i>${s.name}</span>`).join('')}</div><div class="svgwrap"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg></div>`;
}

async function vExpiry() {
  symbar('expiry', ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'INFY'], true);
  const sym = st.sym.expiry, exp = st.exp.expiry;
  const d = await api(`/api/expiry?sym=${encodeURIComponent(sym)}${exp ? '&exp=' + exp : ''}`);
  st.exp.expiry = d.current;
  fillExp('expiry', d.expiries.includes(d.current) ? d.expiries : [d.current, ...d.expiries], d.current);
  $('#headline').textContent = d.headline;
  const c = d.cycle, f = d.first, l = d.last, dm = s => s.slice(5).split('-').reverse().join('/');
  const mpChart = lineChart([{ name: 'Spot', c: css('--ink'), pts: c.map(p => ({ d: p.date, v: p.spot })) }, { name: 'Max pain', c: css('--accent'), dash: true, pts: c.map(p => ({ d: p.date, v: p.mp })) }], {});
  const pcrChart = lineChart([{ name: 'PCR, this expiry', c: css('--brand'), pts: c.map(p => ({ d: p.date, v: p.pcr })) }], { h: 200, ref: 1, fmt: v => n(v, 2) });
  const oiChart = lineChart([{ name: 'Put OI', c: css('--up'), pts: c.map(p => ({ d: p.date, v: p.pe })) }, { name: 'Call OI', c: css('--dn'), pts: c.map(p => ({ d: p.date, v: p.ce })) }], { h: 200, fmt: v => compact(v) });
  const rec = d.record.length ? `<table><thead><tr><th>Expiry</th><th class="r">Max pain 3 sessions before</th><th class="r">Settled at</th><th class="r">Gap</th></tr></thead><tbody>${[...d.record].reverse().map(r => `<tr><td class="num">${fmtD(r.expiry)} ${r.expiry.slice(0, 4)}</td><td class="r">${px(r.mp_before)}</td><td class="r">${px(r.settle)}</td><td class="r"><span class="pill ${Math.abs(r.gap_pct) <= 1 ? 'p-lb' : 'p-lu'}">${sg(r.gap_pct)}%</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Not enough past expiries yet</div>';
  view.innerHTML = `<div class="grid g4">${stat('Max pain', px(l.mp), `${sg((l.mp / l.spot - 1) * 100)}% from spot`, `Started the cycle at ${px(f.mp)}`)}
    ${stat('PCR', n(l.pcr, 2), `${sg(l.pcr - f.pcr, 2)} since ${dm(f.date)}`, l.pcr > 1 ? 'More puts than calls open' : 'More calls than puts open', cls(l.pcr - f.pcr))}
    ${stat('Straddle', l.straddle ? px(l.straddle) : '–', l.straddle ? `±${n(l.straddle / l.spot * 100, 2)}% priced` : '', 'At-the-money call plus put, at close')}
    ${stat('Open interest', compact(l.ce + l.pe), `Puts ${compact(l.pe)} · Calls ${compact(l.ce)}`, `${c.length} sessions into this cycle`)}</div>
    ${card(`Spot and max pain, ${fmtD(d.current)} expiry`, mpChart)}
    <div class="grid g2">${card('PCR through the cycle', pcrChart, 'dashed line = 1')}${card('Open interest building', oiChart)}</div>
    ${card('Max pain record', `<div class="tw">${rec}</div>`, 'where max pain stood vs where price settled')}`;
}

/* ---------- search ---------- */
let SEARCH = null;
async function loadSearch() {
  if (SEARCH) return SEARCH;
  try { SEARCH = (await api('/api/search')).items; } catch (e) { SEARCH = []; }
  const dl = $('#stock-list');
  if (dl) dl.innerHTML = SEARCH.map(x => `<option value="${x.s}">${esc(x.n)}</option>`).join('');
  return SEARCH;
}
function resolveSym(v) {
  v = (v || '').trim(); if (!v) return null;
  const up = v.toUpperCase(), list = SEARCH || [];
  const exact = list.find(x => x.s === up); if (exact) return exact.s;
  const byName = list.find(x => x.n.toUpperCase().startsWith(up)) || list.find(x => x.n.toUpperCase().includes(up));
  const was = list.find(x => (x.was || []).some(w => w.toUpperCase().includes(up)));
  return byName ? byName.s : was ? was.s : up;
}
const RKEY = '72s-recent';
function getRecent() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch (e) { return []; } }
function addRecent(sym) { if (!sym) return; try { localStorage.setItem(RKEY, JSON.stringify([sym, ...getRecent().filter(x => x !== sym)].slice(0, 8))); } catch (e) {} }
function goTab(tab, sym) {
  st.sym[tab] = sym; st.exp[tab] = null;
  const h = `#${tab}/${encodeURIComponent(sym)}`;
  if (location.hash === h) render(); else location.hash = h;
}
function openStock(sym) { goTab('stock', sym); }
function searchBox(big, val = '') {
  return `<form class="sbox ${big ? 'big' : ''}" id="sform" role="search"><input id="sq" list="stock-list" value="${esc(val)}" placeholder="Search any stock, for example Reliance or HDFCBANK" autocomplete="off" aria-label="Search any stock"><button type="submit">Search</button></form>`;
}
function wireSearch() {
  const f = $('#sform'); if (!f) return;
  f.onsubmit = e => { e.preventDefault(); const s = resolveSym($('#sq').value); if (s) openStock(s); };
  loadSearch();
}
const POPULAR = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'LT', 'BHARTIARTL', 'TMPV', 'ETERNAL', 'BAJFINANCE'];

/* ---------- Today ---------- */
async function vToday() {
  const d = await api('/api/today');
  stamp(d.ts, d.open);
  const b = d.breadth, tot = b.adv + b.dec || 1;
  const num = (k, m, extra = '') => `<div class="tnum"><span>${k}</span><b class="num">${px(m.last)}</b><i class="num ${cls(m.chg)}">${sg(m.chg)}%</i>${extra}</div>`;
  const lv = l => `<div class="lvl"><div class="lvl-h"><b>${l.name}</b><span class="num">${px(l.spot)}</span></div>
    <div class="lvl-bar"><span class="f">Floor <b class="num">${px(l.floor)}</b></span><span class="c">Ceiling <b class="num">${px(l.ceiling)}</b></span></div>
    <p>Put writers defend ${px(l.floor)} and call writers defend ${px(l.ceiling)}. A close outside either level means that side's writers were overrun. Options price about ±${pts(l.move)} points by ${esc(l.expiry.slice(0, 6))}.</p></div>`;
  const up = d.upcoming.length ? d.upcoming.map(r => `<button class="up-chip" data-stock="${r.sym}"><b>${r.sym}</b><span>${relDay(r.iso, r.dow + ' ' + r.date)}</span><i class="num">±${n(r.move_pct, 1)}%</i></button>`).join('') : '<div class="empty">No F&amp;O results in the next two sessions.</div>';
  const heroPop = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ETERNAL', 'TMPV'];
  const useRecent = getRecent().length >= 3;
  view.innerHTML = `<section class="mstrip t-${d.tone}">
      <div class="ms-state ${d.state.length > 8 ? 'long' : ''}"><span class="k">The market${d.open ? ' right now' : ' at the last close'}</span><b>${esc(d.state)}</b><p>${esc(d.line)}</p></div>
      ${[['Nifty 50', d.nifty], ['Bank Nifty', d.bank], ['India VIX', d.vix]].map(([k, m]) => `<div class="ms-n"><span>${k}</span><b class="num">${px(m.last)}</b><i class="num ${cls(m.chg)}">${sg(m.chg)}%</i></div>`).join('')}
      <div class="ms-n"><span>Stocks up vs down</span><b class="num"><span class="up">${b.adv}</span> / <span class="dn">${b.dec}</span></b><i class="breadth"><b style="width:${b.adv / tot * 100}%"></b><u style="width:${b.dec / tot * 100}%"></u></i></div>
    </section>
    ${focusBlock(d.focus, d.focus_stamp)}
    <div id="rep-slot"></div>
    ${appBridge()}`;
  wireSearch();
  try {
    const rep = await api('/api/reported');
    if (rep.cards && rep.cards.length) {
      st.repCards = rep.cards;
      const big = c => c.cap === 'Large' || c.cap === 'Mid' || !c.cap;
      const byMove = (a, b) => Math.abs(b.reaction ?? 0) - Math.abs(a.reaction ?? 0) || (b.filed_iso > a.filed_iso ? 1 : -1);
      const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const pick = rep.cards.filter(c => big(c) && c.filed_iso >= wk).sort(byMove).slice(0, 4);
      const line = c => {
        const prof = (c.profit || 0) < 0 ? `Loss ₹${n(Math.abs(c.profit))} cr` : c.profit_yoy == null ? ((c.profit_prev || 0) < 0 ? 'Back to profit' : '') : `Profit ${sg(c.profit_yoy, 0)}%`;
        const surprise = c.reaction != null && c.priced ? (Math.abs(c.reaction) > 1.5 * c.priced ? `${(Math.abs(c.reaction) / c.priced).toFixed(1)}× what options expected` : Math.abs(c.reaction) > c.priced ? 'a bit more than expected' : 'about as expected') : '';
        return `<button class="rline" data-stock="${esc(c.sym)}"><b>${esc(c.name)}</b><span>${esc(prof)}</span>
          <span class="rx ${c.reaction == null ? 'mut' : cls(c.reaction)}">${c.reaction == null ? 'reaction next session' : sg(c.reaction, 1) + '%'}</span><span class="mut">${esc(surprise)}</span></button>`;
      };
      view.querySelector('#rep-slot').insertAdjacentHTML('afterend', `<section><h2 class="sec-h">Results just out <small>How the market took this week's biggest results · <a href="#results">all ${rep.cards.length} →</a></small></h2>
        <div class="card rlines">${pick.map(line).join('')}</div></section>`);
    }
  } catch (e) {}
  const secBit = s => `<a href="#heat"><span>${esc(s.name)}</span><i class="num ${cls(s.chg)}">${sg(s.chg, 1)}%</i></a>`;
  view.querySelector('.mstrip').insertAdjacentHTML('afterend', `<section class="tq">
    <div class="tq-s"><span class="k" title="NSE sector indices">NSE sector indices</span>${(d.leaders || []).map(secBit).join('')}${(d.laggards || []).slice().reverse().map(secBit).join('')}<a class="tq-all" href="#heat">Heatmap →</a></div>
    <div class="pop-row"><span>${useRecent ? 'Recent' : 'Popular'}</span>${(useRecent ? getRecent() : heroPop).map(s => `<button class="chip" data-stock="${esc(s)}">${esc(s)}</button>`).join('')}<a class="tq-l" href="#compare">Compare</a><a class="tq-l" href="#results">Results</a></div></section>`);
  if (d.brief && d.brief.length) view.querySelector('.mstrip').insertAdjacentHTML('afterend', `<section class="wline"><span class="k">${d.open ? 'Today' : 'Next session'}</span>${d.brief.map(b => `<div><b>${esc(b.k)}</b><span>${esc(b.t)}</span></div>`).join('')}</section>`);
  const wl = getWatch();
  let rowsNow = [];
  if (wl.length) {
    try { const w = await api('/api/watch?syms=' + encodeURIComponent(wl.join(',')));
      rowsNow = w.rows;
      const order = { dn: 0, warn: 1, up: 2, neutral: 3 };
      const items = w.rows.filter(r => (r.changes || []).length).map(r => ({ ...r.changes.slice().sort((a, b) => order[a.tone] - order[b.tone] || a.rank - b.rank)[0], sym: r.sym }))
        .sort((a, b) => order[a.tone] - order[b.tone] || a.rank - b.rank).slice(0, 5);
      (view.querySelector('.wline') || view.querySelector('.mstrip')).insertAdjacentHTML('afterend', `<a class="card minetease" href="#mine"><div><span class="k">Your watchlist</span><b>${esc(w.headline)}</b></div>
        <ul class="m-ch">${items.length ? items.map(c => `<li class="t-${c.tone}"><b>${esc(c.sym)}</b> ${esc(c.text)}</li>`).join('') : '<li class="t-quiet">Nothing unusual on your list.</li>'}</ul><span class="go">Open →</span></a>`); } catch (e) {}
  } else {
    view.querySelector('.tq').insertAdjacentHTML('beforeend', `<a class="mut own-tip" href="#mine">Own stocks? Add them to a Watchlist and see only what changed →</a>`);
  }
  sinceVisit(d, rowsNow);
}
/* what moved since this browser last looked. Kept in the browser, nothing is sent anywhere */
function sinceVisit(d, rows) {
  const KEY = '72s-seen', now = Date.now();
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  const hours = seen ? (now - seen.t) / 36e5 : 0;
  const px0 = {}; rows.forEach(r => { if (r.last) px0[r.sym] = r.last; });
  if (seen && hours >= 3 && seen.nifty && d.nifty.last) {
    const nm = (d.nifty.last / seen.nifty - 1) * 100;
    const moves = rows.filter(r => r.last && seen.px && seen.px[r.sym]).map(r => ({ sym: r.sym, m: (r.last / seen.px[r.sym] - 1) * 100 })).sort((a, b) => b.m - a.m);
    const when = new Date(seen.t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    const bits = [`Nifty <b class="num ${cls(nm)}">${sg(nm)}%</b>`];
    if (seen.state && seen.state !== d.state) bits.push(`mood went from ${esc(seen.state)} to <b>${esc(d.state)}</b>`);
    if (moves.length) { const a = moves[0], z = moves[moves.length - 1]; bits.push(`${esc(a.sym)} <b class="num ${cls(a.m)}">${sg(a.m, 1)}%</b>`); if (moves.length > 1) bits.push(`${esc(z.sym)} <b class="num ${cls(z.m)}">${sg(z.m, 1)}%</b>`); }
    (view.querySelector('.wline') || view.querySelector('.mstrip')).insertAdjacentHTML('afterend', `<section class="since"><span class="k">Aapke jaane ke baad <i>(since ${esc(when)})</i></span><p>${bits.join(' · ')}</p></section>`);
  }
  if (!seen || hours >= 3) { try { localStorage.setItem(KEY, JSON.stringify({ t: now, nifty: d.nifty.last, state: d.state, px: px0 })); } catch (e) {} }
}
function focusBlock(rows, stamp) {
  if (!rows || !rows.length) return '';
  const tag = { up: 'Signals up', dn: 'Signals down', warn: 'Mixed' };
  const first = s => { const m = String(s).match(/^.*?[.!?](\s|$)/); return (m ? m[0] : s).trim(); };
  return `<section class="focus"><h2 class="sec-h">Stocks in focus <small>${stamp ? `<span class="fstamp ${stamp.live ? 'live' : ''}">${esc(stamp.text)}</span> · ` : ''}where the most signals agree · <a href="#track">how past readings did →</a></small></h2>
    <div class="fcards">${rows.slice(0, 6).map(r => `<div class="fcard t-${r.tone}">
      <div class="fc-h" data-stock="${esc(r.sym)}"><div><b>${esc(r.sym)}${r.cap && r.cap !== 'Large' ? ` <em class="capt">${esc(r.cap)} cap</em>` : ''}</b><span>${esc(r.name)}</span></div><div class="fc-p"><b class="num">${px(r.last)}</b><i class="num ${cls(r.chg)}">${sg(r.chg)}%</i></div></div>
      <div class="fc-t"><span class="lean">${tag[r.tone]}</span>${esc(r.title)}</div>
      <p class="fc-one">${esc(first(r.why[0]))}</p>
      <details><summary>Why?</summary><ul>${r.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details></div>`).join('')}</div>
    ${rows.length > 3 ? `<button class="wbtn fmore" onclick="this.previousElementSibling.classList.add('all');this.remove()">Show ${Math.min(rows.length, 6) - 3} more</button>` : ''}
    <p class="note2">What the data shows, not a recommendation to buy or sell.</p></section>`;
}
function relDay(iso, fallback) {
  if (!iso) return fallback;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(iso + 'T00:00:00') - d0) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : fallback;
}
function appBridge() {
  return `<div class="bridge"><div><b>This is the data. The desk's view is in the app.</b><p>Calls from SEBI registered analysts with entry, stop, target and horizon, plus alerts when your levels break.</p></div><a class="btn-y" href="#">Get the 72 Street app</a></div>`;
}

/* ---------- Stock ---------- */
function deskBox(c, sym) {
  if (!c) return '';
  const buy = c.action === 'BUY', mid = (c.entry_low + c.entry_high) / 2;
  const pctFrom = v => `${sg((v / mid - 1) * 100, 1)}%`;
  const rr = Math.abs(c.target1 - mid) / Math.abs(mid - c.stop);
  return `<div class="desk ${buy ? 'buy' : 'sell'}">${c.sample ? '<div class="sample">SAMPLE · NOT A REAL CALL</div>' : ''}
    <div class="desk-top"><span class="k">72 Street desk view</span><span class="act">${esc(c.action)}</span><span class="mut">${esc(c.horizon)} · published ${esc(c.published)}${c.expires ? ' · closes ' + esc(c.expires) : ''}${c.analyst ? ' · ' + esc(c.analyst) : ''}</span></div>
    <div class="desk-grid">
      <div><span>Entry</span><b class="num">${px(c.entry_low)} – ${px(c.entry_high)}</b></div>
      <div><span>Stop loss</span><b class="num dn">${px(c.stop)}</b><i>${pctFrom(c.stop)}${c.level ? ' · under ' + esc(c.level) : ''}</i></div>
      <div><span>Target 1</span><b class="num up">${px(c.target1)}</b><i>${pctFrom(c.target1)}</i></div>
      ${c.target2 ? `<div><span>Target 2</span><b class="num up">${px(c.target2)}</b><i>${pctFrom(c.target2)}</i></div>` : ''}
      <div><span>Risk reward to T1</span><b class="num">1 : ${n(rr, 2)}</b></div></div>
    <p class="why"><b>Why:</b> ${esc(c.reason)}</p>
    <p class="disc">Research analyst holding in this stock: ${esc(c.analyst_holding || 'No')}. This call closes at the end of its horizon whatever the price. 72 Street, SEBI Registered Research Analyst, INH000029722. Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors. Investment in securities market are subject to market risks. Read all the related documents carefully before investing.</p></div>`;
}
function qBars(q) {
  if (!q.periods.length) return '<div class="empty">No quarterly data</div>';
  const W = 640, H = 220, pad = 46, N = q.periods.length, mx = Math.max(...q.sales.map(Math.abs), 1), mp = Math.max(...q.profit.map(v => Math.abs(v || 0)), 1);
  const bw = (W - pad) / N; let g = '';
  q.periods.forEach((p, i) => {
    const x = pad + i * bw, hs = (q.sales[i] || 0) / mx * (H - 60), hp = Math.abs(q.profit[i] || 0) / mp * (H - 60);
    g += `<rect x="${x + 4}" y="${H - 30 - hs}" width="${bw / 2 - 5}" height="${hs}" rx="2" fill="${css('--line')}" data-tip="${p} sales ₹${n(q.sales[i])} cr"/>`;
    g += `<rect x="${x + bw / 2}" y="${H - 30 - hp}" width="${bw / 2 - 5}" height="${hp}" rx="2" fill="${(q.profit[i] || 0) >= 0 ? css('--up') : css('--dn')}" data-tip="${p} net profit ₹${n(q.profit[i])} cr"/>`;
    g += `<text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" style="font-size:10px">${p.replace(' 20', " '")}</text>`;
  });
  return `<div class="legend" style="margin-bottom:6px"><span><i style="background:var(--line)"></i>Sales</span><span><i style="background:var(--up)"></i>Net profit</span><span class="mut">each scaled to its own maximum</span></div><div class="svgwrap"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg></div>`;
}
function ownChart(o) {
  const rows = o.rows, per = o.periods; if (!per.length) return '<div class="empty">No shareholding data</div>';
  const S = [['Promoters', '--ink'], ['FIIs', '--accent'], ['DIIs', '--brand'], ['Public', '--faint']].filter(([k]) => rows[k]);
  const lc = lineChart(S.map(([k, c]) => ({ name: k, c: css(c), pts: per.map((p, i) => ({ d: p, v: rows[k][i] })) })), { h: 230, fmt: v => n(v, 1) + '%', lab: p => p.replace(' 20', " '") });
  const last = per.length - 1, tbl = `<table style="margin-top:8px"><thead><tr><th>Holder</th><th class="r">${esc(per[last])}</th><th class="r">Last quarter</th><th class="r">Last year</th></tr></thead><tbody>${S.map(([k]) => { const v = rows[k]; const q1 = v[last] - v[last - 1], y1 = last >= 4 ? v[last] - v[last - 4] : null;
    return `<tr><td>${k}</td><td class="r">${n(v[last], 2)}%</td><td class="r ${cls(q1)}">${sg(q1, 2)}</td><td class="r ${cls(y1)}">${y1 === null ? '–' : sg(y1, 2)}</td></tr>`; }).join('')}</tbody></table>`;
  return lc + tbl;
}
const wAvg = v => { const t = v.reduce((a, r) => a + (r.m || 0), 0); return t ? v.reduce((a, r) => a + r.p * (r.m || 0), 0) / t : v.reduce((a, r) => a + r.p, 0) / (v.length || 1); };
async function vStocksHome() {
  await loadSearch();
  const d = await api('/api/heatmap');
  stamp(d.ts, d.open);
  const lm = d.rows.filter(r => r.c === 'Large' || r.c === 'Mid');
  const byP = [...lm].sort((a, b) => b.p - a.p), top = [...d.rows].sort((a, b) => b.m - a.m).slice(0, 8);
  const row = r => `<button class="sh-r" data-stock="${esc(r.s)}"><div><b>${esc(r.s)}</b><span>${esc(r.n)}</span></div><i class="num">${r.l == null ? '–' : px(r.l)}</i><em class="num ${cls(r.p)}">${sg(r.p)}%</em></button>`;
  const g = {};
  d.rows.forEach(r => { (g[r.g] = g[r.g] || []).push(r); });
  const secs = Object.entries(g).filter(([, v]) => v.length >= 3).map(([k, v]) => ({ k, n: v.length, c: wAvg(v) })).sort((a, b) => b.c - a.c);
  const rec = getRecent();
  const list = (t, rows, s) => `<section class="card"><h3>${t}<small>${s}</small></h3><div class="sh-l">${rows.map(row).join('')}</div></section>`;
  view.innerHTML = `<section class="sh-top"><h2>Find any stock</h2><p>${n(d.rows.length)} companies, each on one page in plain language.</p>${searchBox(true)}
      ${rec.length ? `<div class="pop-row"><span>Recent</span>${rec.map(s => `<button class="chip" data-stock="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</section>
    <div class="grid g3">${list('Largest companies', top, 'by market value')}${list('Biggest rises', byP.slice(0, 8), 'large and mid caps, today')}${list('Biggest falls', byP.slice(-8).reverse(), 'large and mid caps, today')}</div>
    <section><h2 class="sec-h">Browse by sector <small>strongest first, weighted by company size</small></h2><div class="sh-secs">${secs.map(s => `<a href="#heat/${encodeURIComponent(s.k)}"><b>${esc(s.k)}</b><span>${s.n} stocks</span><i class="num ${cls(s.c)}">${sg(s.c, 1)}%</i></a>`).join('')}</div></section>
    <p class="note2">What the data shows, not a recommendation.</p>`;
  wireSearch();
}
async function vStock() {
  sIntra = false;
  if (st.stockHome) return vStocksHome();
  await loadSearch();
  const sym = st.sym.stock || 'RELIANCE';
  const d = await api(`/api/stock?sym=${encodeURIComponent(sym)}`);
  st.lastStock = d;
  const pr = d.profile || {}, p = d.price;
  $('#headline').textContent = '';
  if (pr.name) setTitle(`${pr.name} (${sym}): price, results, valuation`);
  const gl = (d.glance || []).map(g => `<div class="gl t-${g.tone}"${g.why ? ` title="${esc(g.why)}"` : ''}><span>${esc(g.k)}</span><b>${esc(g.v)}</b>${g.why ? `<i class="gl-why">${esc(g.why)}</i>` : ''}</div>`).join('');
  const m = d.mine || {}, pe = d.peer || {};
  const vrow = (k, a, b, hi, unit = '') => a == null ? '' : `<tr><td>${k}</td><td class="r">${n(a, 2)}${unit}</td><td class="r">${b == null ? '–' : n(b, 2) + unit}</td><td>${b == null ? '' : (() => { if (!b || a === b) return '<span class="mut">In line</span>'; const g = a / b - 1; if (Math.abs(g) <= .15) return '<span class="mut">In line</span>'; const good = hi ? g > 0 : g < 0; return `<span class="${good ? 'up' : 'dn'}">${hi ? (g > 0 ? 'Higher' : 'Lower') : (g < 0 ? 'Cheaper' : 'Richer')}</span>`; })()}</td></tr>`;
  const val = d.has_fund ? `<table><thead><tr><th>Measure</th><th class="r">${esc(sym)}</th><th class="r">Peer median</th><th>Read</th></tr></thead><tbody>
    ${vrow('P/E', m.pe, pe.pe, false)}${vrow('Price to book', m.pb, pe.pb, false)}${vrow('ROE', m.roe, pe.roe, true, '%')}${d.lender ? '' : vrow('ROCE', m.roce, pe.roce, true, '%')}${vrow('Dividend yield', m.dy, pe.dy, true, '%')}</tbody></table>
    <p class="note2">${(m.nm || []).length ? `${esc(m.nm.join(' and '))} left out: the source figures look unreliable. ` : ''}${pe.n ? `Peer median: ${pe.n} companies in ${esc(pr.peer_scope || 'its industry')}. ` : 'No fair peer group, so no median is shown. '}${d.sales_cagr5 != null ? `Five year growth: sales ${n(d.sales_cagr5, 0)}% a year${d.profit_cagr5 != null ? `, profit ${n(d.profit_cagr5, 0)}% a year` : ''}.` : ''}</p>` : '<div class="empty">No fundamentals on file for this stock.</div>';
  const peers = d.peers && d.peers.length ? `<table><thead><tr><th>Peer</th><th class="r">M cap, ₹ cr</th><th class="r">P/E</th>${d.lender ? '' : '<th class="r">ROCE</th>'}<th class="r">Qtr profit</th></tr></thead><tbody>${d.peers.map(x => `<tr><td><span class="symlink" data-stock="${x.sym}">${esc(x.name || x.sym)}</span></td><td class="r">${n(x.mcap)}</td><td class="r">${x.pe ? n(x.pe, 1) : '<span class="mut">loss</span>'}</td>${d.lender ? '' : `<td class="r">${x.roce == null ? '–' : n(x.roce, 1) + '%'}</td>`}<td class="r ${cls(x.pvar)}">${x.pvar == null ? '–' : sg(x.pvar, 0) + '%'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No peers found</div>';
  const o = d.opt, t = d.tech;
  const optCard = o ? card('Options', `<div class="walls">
      <div><span>Floor, most put writing</span><b class="num">${px(o.floor)}</b></div><div><span>Ceiling, most call writing</span><b class="num">${px(o.ceiling)}</b></div>
      <div><span>Priced move by ${esc(o.expiry.slice(0, 6))}</span><b class="num">±${pts(o.straddle)}</b></div><div><span>PCR · Max pain</span><b class="num">${n(o.pcr, 2)} · ${px(o.max_pain)}</b></div></div>
      <p class="note2"><a href="#fno/${esc(sym)}">Open the full F&amp;O page →</a></p>`, 'F&amp;O stock') : '';
  const ch = d.chart;
  const fname = { structure: 'Price structure', ema_stack: 'Moving averages', momentum: 'Momentum', weekly: 'Weekly trend', volume: 'Volume', volatility: 'Volatility' };
  const techCard = ch ? card('Chart strength', `<div class="cs-top"><b class="num cs-${ch.band.toLowerCase()}">${ch.score}</b><div><span class="cs-band cs-${ch.band.toLowerCase()}">${esc(ch.band)}</span><span class="mut">out of 100</span></div></div>
      <div class="cs-f">${Object.entries(ch.factors).map(([k, v]) => `<div><span>${fname[k] || k}</span><i><u style="width:${v / 5 * 100}%" class="${v >= 4 ? 'g' : v <= 2 ? 'r' : ''}"></u></i><b class="num">${n(v, 1)}/5</b></div>`).join('')}</div>
      <p class="note2">${esc(ch.text)} This describes how the chart looks today; it is not a forecast. <a href="#track">How it is being tested →</a></p>`, '0 to 100, from six parts of the chart')
    : t ? card('Chart readings', `${radarSvg(t.factors)}<p class="note2">${esc(t.summary)}</p>`) : '';
  const pt = d.pattern;
  const patCard = pt ? card('Chart pattern', `<div class="walls"><div><span>${esc(pt.pattern)}</span><b class="${pt.direction === 'bullish' ? 'up' : 'dn'}">${pt.direction === 'bullish' ? 'Upward shape' : 'Downward shape'}</b></div>
      <div><span>Status</span><b>${esc(pt.status)}</b></div><div><span>How this pattern tested</span><b>${esc(pt.reliability)}</b></div></div><p class="note2">${esc(pt.trigger)}</p>`) : '';
  const peerBlock = `${card('Peers', peers + (pr.peer_note ? `<p class="note2">${esc(pr.peer_note)}</p>` : ''), esc(pr.peer_scope || ''))}`;
  const resBlock = d.result_card ? `<div class="rcards one">${resCard(d.result_card)}</div>` : '';
  view.innerHTML = `    <section class="shead"><div><h2>${esc(pr.name || sym)}</h2><div class="tags"><span class="pill p-sc">${esc(sym)}</span>${(d.industry && d.industry.length) || pr.sector_name ? `<span class="pill">${esc(d.industry && d.industry.length ? d.industry[d.industry.length - 1] : pr.sector_name)}</span>` : ''}${pr.tier ? `<span class="pill">${esc(pr.tier)}</span>` : ''}${d.fno ? '<span class="pill p-lu">F&amp;O</span>' : ''}</div></div>
      ${p ? `<div class="sprice"><div class="sbtns">${watchBtn(sym)}<button class="wbtn" data-compare="${esc(sym)}">Compare</button><button class="wbtn" data-sharestock="1">Share</button></div><b class="num">₹${px(p.last)}</b><i class="num ${cls(p.chg)}">${sg(p.chg)}%</i><span>52 week ${px(p.lo52)} – ${px(p.hi52)} · as of ${esc(p.asof)}</span></div>` : ''}</section>
    ${d.summary ? `<p class="ssum t-${d.summary.tone}">${esc(d.summary.text)}</p>` : ''}
    <div class="glance gx-tiles">${p ? [[p.r1m, '1 month'], [p.r1y, '1 year']].filter(([v]) => v != null).map(([v, k]) => `<div class="gl t-${v >= 0 ? 'up' : 'dn'}"><span>${k}</span><b class="num">${sg(v, 1)}%</b></div>`).join('')
      + (p.hi52 ? `<div class="gl t-neutral"><span>from 52 week high</span><b class="num">${sg((p.last / p.hi52 - 1) * 100, 1)}%</b></div>` : '') : ''}${gl}</div>
    ${keyLevels(d, d.opt)}
    ${deskBox(d.call, sym)}
    <div class="st-top solo">${card(`Price <span class="seg" id="px-seg" style="margin-left:8px"><button class="on" data-r="y">${d.price_break ? 'Since ' + esc(d.price_break.date) : '12 months'}</button><button data-r="5">5 days</button><button data-r="1">Today</button></span>${d.structure ? `<button class="st-tog${sOn() ? ' on' : ''}" id="st-tog" title="Show swing points, breaks, sweeps and order blocks">Structure</button>` : ''}`, `${sOn() && d.structure ? sChips(S_MAIN) : ''}<div class="chart" id="lw"></div>${sOn() && d.structure ? `<p class="note2" id="st-note">Point at a marker or a shaded band to read what happened that day. Sweeps, breaks and swing points are on the <a href="#structure/${encodeURIComponent(sym)}">Price Structure page</a>.</p>` : ''}${rets(d.candles)}` + (d.price_break ? `<p class="note2">The price jumped from ₹${px(d.price_break.from)} to ₹${px(d.price_break.to)} overnight on ${esc(d.price_break.date)}. That is a demerger, split or bonus, not a real move, so the chart and returns start after it.</p>` : ''), o ? 'lines: option floor and ceiling' : '')}</div>
    ${sOn() && d.structure ? `<div class="grid">${structCard(d.structure, sym, false, d.chart)}</div>` : ''}
    <div id="read-slot"></div>
    <div class="grid g2">${resBlock}${card('Valuation and quality against peers', val)}${resBlock ? '' : peerBlock}</div>
    <div id="extra-slot"></div><div id="filings-slot"></div>
    <details class="st-more"${st.stMore ? ' open' : ''}><summary>More on ${esc(sym)}: chart strength, quarters, ownership, peers${optCard ? ', options' : ''}${patCard ? ', pattern' : ''}</summary>
      <div class="grid g2">${card(`Last eight quarters${d.latest_q ? ', latest ' + esc(d.latest_q) : ''}`, qBars(d.quarters || { periods: [] }), 'sales and net profit, ₹ crore')}${card('Who owns it', ownChart(d.own || { periods: [], rows: {} }), 'big money in and out, by quarter')}</div>
      <div class="grid g3">${techCard}${resBlock ? peerBlock : ''}${optCard}${patCard}</div></details>
    <p class="note2">Fundamentals and shareholding from company filings, collected ${esc(d.fetched || '')}. Prices delayed. Readings describe the data and are not a recommendation.</p>
    ${appBridge()}`;
  { const sm = view.querySelector('.st-more'); if (sm) sm.ontoggle = e => { st.stMore = e.target.open; }; }
  extraCards(sym); filingsCard(sym);
  wireSearch();
  if (window.LightweightCharts && d.candles && d.candles.length) {
    chart = LightweightCharts.createChart($('#lw'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Montserrat, system-ui, 'Segoe UI', sans-serif" },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') }, timeScale: { borderColor: css('--line') } });
    const s = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
    s.setData(d.candles.map(x => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));
    const sma = (N, color) => { if (d.candles.length <= N) return; const out = []; let sum = 0;
      d.candles.forEach((x, i) => { sum += x.c; if (i >= N) sum -= d.candles[i - N].c; if (i >= N - 1) out.push({ time: x.t, value: sum / N }); });
      chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(out); };
    const lightT = document.documentElement.getAttribute('data-theme') === 'light' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: light)').matches);
    const sView = sOn() && d.structure;
    if (!sView) { sma(50, css('--accent')); sma(200, lightT ? '#B07F00' : css('--brand')); }
    api(`/api/candles?sym=${encodeURIComponent(sym)}&tf=1d`).then(c => { if (!chart || st.sym.stock !== sym) return;
      const from = d.candles[0].t, v = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      v.setData(c.candles.filter(x => x.t >= from && x.v).map(x => ({ time: x.t, value: x.v, color: css(x.c >= x.o ? '--up' : '--dn') + '55' }))); }).catch(() => {});
    if (o) { s.createPriceLine({ price: o.floor, color: css('--up'), lineWidth: 2, lineStyle: 0, title: 'Floor' }); s.createPriceLine({ price: o.ceiling, color: css('--dn'), lineWidth: 2, lineStyle: 0, title: 'Ceiling' }); }
    if (d.call && !d.call.sample) { s.createPriceLine({ price: d.call.stop, color: css('--dn'), lineStyle: 2, title: 'Desk stop' }); s.createPriceLine({ price: d.call.target1, color: css('--up'), lineStyle: 2, title: 'Desk target' }); }
    if (sOn() && d.structure) drawStructure(chart, s, d.structure, S_MAIN);     // the stock page offers order blocks, BoS and CHoCH; the rest are on the Price Structure page
    { const tg = $('#st-tog'); if (tg) tg.onclick = () => { sSet(!sOn()); render(true); }; }
    chart.timeScale().fitContent();
    if (sView) sZoom(chart, d.candles.length);
    if (sView) { const lg = view.querySelector('.px-leg'); if (lg) lg.hidden = true; }
    const opts = { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Montserrat, system-ui, 'Segoe UI', sans-serif" },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') }, timeScale: { borderColor: css('--line'), timeVisible: true } };
    const seg = $('#px-seg');
    if (seg) seg.onclick = async e => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      if (b.dataset.r === 'y') { st.pxRange = null; render(true); return; }
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      let cs = []; try { cs = (await api(`/api/candles?sym=${encodeURIComponent(sym)}&tf=5m`)).candles; } catch (e2) {}
      if (!$('#lw') || st.sym.stock !== sym) return;
      if (b.dataset.r === '1' && cs.length) { const day = new Date((cs[cs.length - 1].t + 19800) * 1000).getUTCDate(); cs = cs.filter(x => new Date((x.t + 19800) * 1000).getUTCDate() === day); }
      if (chart) { chart.remove(); chart = null; }
      if (!cs.length) { $('#lw').innerHTML = '<div class="empty">No intraday prices for this stock.</div>'; return; }
      $('#lw').innerHTML = '';
      chart = LightweightCharts.createChart($('#lw'), opts);
      chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') })
        .setData(cs.map(x => ({ time: x.t + 19800, open: x.o, high: x.h, low: x.l, close: x.c })));
      chart.timeScale().fitContent();
    };
  }
}

function rets(cs) {
  if (!cs || cs.length < 6) return '';
  const last = cs[cs.length - 1].c, ago = (k, lbl) => cs.length > k ? `<span>${lbl} <b class="num ${cls(last / cs[cs.length - 1 - k].c - 1)}">${sg((last / cs[cs.length - 1 - k].c - 1) * 100, 1)}%</b></span>` : '';
  return `<div class="px-rets">${ago(5, '1 week')}${ago(21, '1 month')}${ago(63, '3 months')}${ago(126, '6 months')}${cs.length > 250 ? ago(250, '1 year') : ''}<span class="px-leg"><i style="background:var(--accent)"></i>50 day average <i class="px-200"></i>200 day average</span></div>`;
}
async function filingsCard(sym) {
  let f; try { f = await api(`/api/filings?sym=${encodeURIComponent(sym)}`); } catch (e) { return; }
  const slot = $('#filings-slot'); if (!slot || st.sym.stock !== sym) return;
  const rows = f.rows || [];
  const KEY = new Set(['Order win', 'Acquisition', 'Merger', 'Credit rating', 'Buyback', 'Bonus', 'Split', 'Clarifies news', 'Leadership change', 'Big holder change', 'Pledge', 'Fund raising', 'Legal', 'Tax matter']);
  const line = r => `<div class="fl-r${KEY.has(r.kind) ? ' key' : ''}"><span class="fl-d num">${esc(r.when)}</span><span class="fl-k">${esc(r.kind)}</span><p>${r.plain ? '<span class="mut">Details are in the filing.</span>' : esc(r.text)}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">Open filing →</a>` : ''}</p></div>`;
  slot.outerHTML = card('What the company told the exchange', rows.length
    ? `<div class="fl">${rows.slice(0, 6).map(line).join('')}</div>${rows.length > 6 ? `<details class="fl-more"><summary>${rows.length - 6} more</summary><div class="fl">${rows.slice(6).map(line).join('')}</div></details>` : ''}<p class="note2">Official announcements to NSE in the last 45 days, as the company wrote them. Routine paperwork is left out. Not news coverage and not our view.</p>`
    : '<div class="empty">No announcements beyond routine paperwork in the last 45 days.</div>', 'last 45 days, from NSE');
}
async function extraCards(sym) {
  let x; try { x = await api(`/api/extra?sym=${encodeURIComponent(sym)}`); } catch (e) { return; }
  const slot = $('#extra-slot'); if (!slot || st.sym.stock !== sym) return;
  const h = x.health, ph = x.pe, cards = [];
  if (h) {
    const row = (k, v, w, c) => `<tr><td>${k}</td><td class="r num">${v}</td><td class="${c || 'mut'}">${w}</td></tr>`;
    const rows = [];
    if (h.lender) rows.push(`<tr><td colspan="3" class="mut">Banks and lenders borrow as their business, so debt ratios do not apply.</td></tr>`);
    if (h.neg_worth) rows.push(row('Debt to equity', '–', 'Negative net worth', 'dn'));
    else if (h.de != null) rows.push(row('Debt to equity', n(h.de, 2), h.de < .3 ? 'Low' : h.de < 1 ? 'Moderate' : 'High', h.de < .3 ? 'up' : h.de < 1 ? 'mut' : 'dn'));
    if (h.cover != null) rows.push(row('Interest cover', h.cover > 100 ? 'Over 100 times' : `${n(h.cover, 1)} times`, h.cover >= 5 ? 'Comfortable' : h.cover >= 2 ? 'Adequate' : 'Thin', h.cover >= 5 ? 'up' : h.cover >= 2 ? 'mut' : 'dn'));
    if (h.cash != null) rows.push(row('Profit turning into cash, 3 years', h.cash > 200 ? 'Over 200%' : `${n(h.cash, 0)}%`, h.cash >= 80 ? 'Strong' : h.cash >= 50 ? 'Fair' : 'Weak', h.cash >= 80 ? 'up' : h.cash >= 50 ? 'mut' : 'dn'));
    if (h.promoter != null) rows.push(row('Promoter holding', `${n(h.promoter, 1)}%`, h.promoter_chg == null ? '' : `${sg(h.promoter_chg, 1)} points in a year`, h.promoter_chg <= -1 ? 'dn' : 'mut'));
    const pl = x.pledge;
    if (pl) rows.push(row('Promoter shares pledged', `${n(pl.pledged, 1)}%`, pl.pledged === 0 ? 'None disclosed' : pl.pledged < 10 ? 'Low' : pl.pledged < 40 ? 'Watch' : 'High', pl.pledged === 0 ? 'up' : pl.pledged < 10 ? 'mut' : 'dn'));
    if (pl && pl.other > 0) rows.push(row('Other promoter encumbrance', `${n(pl.other, 1)}%`, pl.other < 10 ? 'Low' : pl.other < 40 ? 'Watch' : 'High', pl.other < 10 ? 'mut' : 'dn'));
    cards.push(card('Debt, cash and promoters', `<table><tbody>${rows.join('')}</tbody></table><p class="note2">From the latest filings${h.asof ? `, ${esc(h.asof)}` : ''}.${pl ? ` Pledge as a share of promoter holding, from the shareholding filing for ${esc(pl.date)}.` : ' Pledge data was not available for this company.'}</p>`));
  }
  if (ph) {
    const hi = Math.max(...ph.rows.map(r => r.pe), ph.now || 0), bar = (k, v, on) => `<div class="pe-h${on ? ' now' : ''}"><span>${k}</span><i><u style="width:${v / hi * 100}%"></u></i><b class="num">${n(v, 1)}</b></div>`;
    cards.push(card('P/E against its own history', `${ph.rows.map(r => bar(esc(r.y), r.pe)).join('')}${ph.now ? bar('Now', ph.now, true) : ''}
      <p class="note2">${ph.now ? `Now ${n(ph.now, 1)} against a median of ${n(ph.median, 1)} at past year ends. ${ph.now > ph.median * 1.15 ? 'Priced above its usual level.' : ph.now < ph.median * .85 ? 'Priced below its usual level.' : 'Close to its usual level.'} ` : ''}Year end price over that year's earnings, so treat it as approximate.</p>`, 'year end P/E'));
  }
  if (cards.length) slot.outerHTML = `<div class="grid g2">${cards.join('')}</div>`;
  const gl = view.querySelector('.glance');
  if (gl) {
    const add = (k, v, t) => gl.insertAdjacentHTML('beforeend', `<div class="gl t-${t}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`);
    const pl = x.pledge;
    if (pl && pl.pledged >= 10) add('Promoter pledge', `${n(pl.pledged, 0)}% of holding`, 'dn');
    else if (pl && pl.other >= 40) add('Promoter shares', `${n(pl.other, 0)}% encumbered`, 'dn');
    if (h && h.neg_worth) add('Debt', 'Negative net worth', 'dn'); else if (h && h.de >= 1) add('Debt', `High, ${n(h.de, 1)} times equity`, 'dn');
    if (ph && ph.now) { const noPeer = [...gl.querySelectorAll('.gl')].find(e => /No fair peer/.test(e.textContent));
      if (noPeer) { const hi = ph.now > ph.median * 1.15, lo = ph.now < ph.median * .85; noPeer.outerHTML = `<div class="gl t-${hi ? 'dn' : lo ? 'up' : 'neutral'}"><span>Valuation</span><b>${hi ? 'Above' : lo ? 'Below' : 'Near'} its own history</b></div>`; } }
  }
}

/* ---------- Watchlist (saved in this browser only) ---------- */
const WKEY = '72s-watch';
function getWatch() { try { return JSON.parse(localStorage.getItem(WKEY) || '[]'); } catch (e) { return st.watchMem || []; } }
function setWatch(l) { st.watchMem = l; try { localStorage.setItem(WKEY, JSON.stringify(l)); } catch (e) {} }
function addWatch(sym) { const l = getWatch(); if (!l.includes(sym)) { l.unshift(sym); setWatch(l.slice(0, 30)); } }
function removeWatch(sym) { setWatch(getWatch().filter(s => s !== sym)); }
const TOP10 = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'BHARTIARTL', 'TCS', 'INFY', 'SBIN', 'ITC', 'LT', 'BAJFINANCE'];

function mineRow(r) {
  if (r.error) return `<div class="mrow"><div class="m-id"><b>${esc(r.sym)}</b><span class="dn">${esc(r.error)}</span></div><button class="x" data-unwatch="${esc(r.sym)}" aria-label="Remove ${esc(r.sym)}">×</button></div>`;
  const ch = r.changes.length ? r.changes.map(c => `<li class="t-${c.tone}">${esc(c.text)}</li>`).join('') : '<li class="t-quiet">Nothing new. No results due, no level broken, no unusual move.</li>';
  const keep = ['Trend', 'Valuation'];
  const gl = r.glance.filter(g => keep.includes(g.k) || /results|quarter/i.test(g.k)).slice(0, 3)
    .map(g => `<span class="mg t-${g.tone}" title="${esc(g.k)}">${esc(g.v)}</span>`).join('');
  return `<div class="mrow ${r.changes.some(c => c.tone === 'dn' || c.tone === 'warn') ? 'flag' : ''}">
    <div class="m-id" data-stock="${esc(r.sym)}"><b>${esc(r.name)}</b><span>${esc(r.sym)}${r.industry ? ' · ' + esc(r.industry) : ''}</span></div>
    <div class="m-px"><b class="num">₹${px(r.last)}</b><i class="num ${cls(r.chg)}">${sg(r.chg)}%</i><span class="mut num">1M ${r.r1m == null ? '–' : sg(r.r1m, 1) + '%'}</span></div>
    <div class="m-sp">${spark(r.spark, 120, 34)}</div>
    <ul class="m-ch">${ch}</ul>
    <div class="m-gl">${gl}</div>
    <div class="m-act"><button class="bell" data-alert="${esc(r.sym)}" data-last="${r.last || ''}" title="Alerts for ${esc(r.sym)}" aria-label="Alerts for ${esc(r.sym)}">🔔<i>${alertCount(r.sym)}</i></button><button class="x" data-unwatch="${esc(r.sym)}" aria-label="Remove ${esc(r.sym)}">×</button></div></div>`;
}
async function vMine() {
  await loadSearch();
  if (st.wlImport && st.wlImport.length) {
    const inc = st.wlImport, have = getWatch(), fresh = inc.filter(s => !have.includes(s));
    view.innerHTML = `<section class="card wl-imp"><h3>A watchlist was shared with you</h3><p>${inc.length} stocks: ${inc.map(esc).join(', ')}</p>
      <div class="wl-btns"><button class="jz-dl" id="wl-add">${have.length ? `Add the ${fresh.length} new ones to my list` : 'Use this list'}</button>${have.length ? `<button class="wbtn" id="wl-rep">Replace my list with it</button>` : ''}<button class="wbtn" id="wl-no">No thanks</button></div>
      <p class="note2">Your list is saved in this browser. Nothing is sent anywhere.</p></section>`;
    const done = l => { setWatch(l); st.wlImport = null; history.replaceState(null, '', '#mine'); render(); };
    $('#wl-add').onclick = () => done([...have, ...fresh]);
    const r = $('#wl-rep'); if (r) r.onclick = () => done(inc.slice());
    $('#wl-no').onclick = () => { st.wlImport = null; history.replaceState(null, '', '#mine'); render(); };
    return;
  }
  const list = getWatch();
  const addForm = `<form class="sbox" id="wform"><input id="wq" list="stock-list" placeholder="Add a stock you own or follow" autocomplete="off" aria-label="Add a stock"><button type="submit">Add</button></form>`;
  if (!list.length) {
    view.innerHTML = `<section class="hero2"><h2>Your stocks, without the noise</h2>
      <p class="mut" style="max-width:60ch">Add the stocks you own or follow. Each one shows only what changed: results out, a level broken, a big move, institutions buying or selling. Saved in this browser, no login needed.</p>
      ${addForm}<div class="chips pop"><button class="chip on" id="add10">+ Add the Nifty top 10</button>${POPULAR.map(s => `<button class="chip" data-addw="${s}">+ ${s}</button>`).join('')}</div></section>`;
  } else {
    view.innerHTML = `<div class="mhead-row"><div class="headline-sm" id="mhead">Checking ${list.length} stocks…</div><div class="aw"><button class="wbtn" id="wl-copy" title="Open the same list on your phone or another computer">Copy link to this list</button>${alertsBtn()}</div></div>${addForm}<div class="mlist" id="mlist">${'<div class="skel" style="height:86px"></div>'.repeat(Math.min(list.length, 4))}</div>`;
    const d = await api('/api/watch?syms=' + encodeURIComponent(list.join(',')));
    $('#mhead').textContent = d.headline;
    const rows = d.rows.slice().sort((a, b) => (b.changes || []).filter(c => c.tone !== 'up' && c.tone !== 'neutral').length - (a.changes || []).filter(c => c.tone !== 'up' && c.tone !== 'neutral').length);
    $('#mlist').innerHTML = rows.map(mineRow).join('') + `<p class="note2">Saved in this browser only. Prices delayed. Each line describes the data and is not a recommendation.</p>`;
  }
  const f = $('#wform'); if (f) f.onsubmit = e => { e.preventDefault(); const s = resolveSym($('#wq').value); if (s) { addWatch(s); render(); } };
  const cp = $('#wl-copy');
  if (cp) cp.onclick = async () => { const url = `${location.origin}${location.pathname}#mine/${getWatch().join(',')}`;
    try { await navigator.clipboard.writeText(url); cp.textContent = 'Link copied'; } catch (e) { window.prompt('Copy this link', url); } setTimeout(() => { cp.textContent = 'Copy link to this list'; }, 2500); };
  const a10 = $('#add10'); if (a10) a10.onclick = () => { TOP10.slice().reverse().forEach(addWatch); render(); };
}
document.addEventListener('click', e => {
  const u = e.target.closest('[data-unwatch]'); if (u) { e.stopPropagation(); removeWatch(u.dataset.unwatch); render(true); return; }
  const a = e.target.closest('[data-addw]'); if (a) { addWatch(a.dataset.addw); render(); return; }
  const t = e.target.closest('[data-togglew]'); if (t) { const s = t.dataset.togglew; getWatch().includes(s) ? removeWatch(s) : addWatch(s); t.outerHTML = watchBtn(s); }
}, true);
function watchBtn(sym) { const on = getWatch().includes(sym); return `<button class="wbtn ${on ? 'on' : ''}" data-togglew="${esc(sym)}">${on ? '✓ In Watchlist' : '+ Add to Watchlist'}</button>`; }

/* ---------- share as image (1080 x 1350, drawn on canvas, no library) ---------- */
function wrapText(ctx, text, x, y, maxW, lh, maxLines = 4) {
  const words = String(text).split(' '); let line = '', lines = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lh; lines++; line = w;
      if (lines >= maxLines - 1) { const rest = words.slice(words.indexOf(w)).join(' '); let t = rest; while (ctx.measureText(t + '…').width > maxW && t.length) t = t.slice(0, -1); ctx.fillText(t.length < rest.length ? t + '…' : rest, x, y); return y + lh; }
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}
const LOGO = new Image(); LOGO.src = 'brand/72street-wide-yellow.svg';
function drawCard(o) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), P = { bg: '#F6F5F1', ink: '#16161B', mut: '#615F57', soft: '#ECE9E1', up: '#1F7A4D', dn: '#B83A2E', warn: '#C27A12', y: '#FDD405' };
  const tone = t => t === 'up' ? P.up : t === 'dn' ? P.dn : t === 'warn' ? P.warn : '#6A55E0';
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  x.fillStyle = P.ink; x.fillRect(0, 0, W, 120);
  if (LOGO.complete && LOGO.naturalWidth) x.drawImage(LOGO, 64, 22, 76 * LOGO.naturalWidth / LOGO.naturalHeight, 76);
  else { x.fillStyle = P.y; x.font = '600 40px "Gobold", sans-serif'; x.fillText('72 STREET', 64, 76); }
  x.fillStyle = '#A8AAB0'; x.font = '500 28px "Montserrat", sans-serif'; x.textAlign = 'right'; x.fillText(o.kicker, W - 64, 74); x.textAlign = 'left';
  x.fillStyle = P.ink; x.font = '700 64px "Montserrat", sans-serif';
  let y = wrapText(x, o.title, 64, 230, W - 128, 74, 2);
  x.fillStyle = P.mut; x.font = '400 32px "Montserrat", sans-serif'; y = wrapText(x, o.sub, 64, y + 4, W - 128, 42, 2);
  if (o.big) { x.font = '600 120px "Gobold", sans-serif'; x.fillStyle = tone(o.big.tone); x.fillText(o.big.v, 64, y + 120); x.font = '500 30px "Montserrat", sans-serif'; x.fillStyle = P.mut; x.fillText(o.big.k, 64, y + 170); y += 210; }
  const tiles = o.tiles.slice(0, 4), tw = (W - 128 - 3 * 20) / 4;
  tiles.forEach((t, i) => { const tx = 64 + i * (tw + 20); x.fillStyle = P.soft; x.beginPath(); x.roundRect(tx, y + 20, tw, 150, 18); x.fill();
    x.fillStyle = P.mut; x.font = '500 24px "Montserrat", sans-serif'; wrapText(x, t.k, tx + 20, y + 62, tw - 40, 28, 2);
    x.fillStyle = tone(t.tone); let fs = 38; x.font = `600 ${fs}px "Gobold", sans-serif`; while (x.measureText(t.v).width > tw - 40 && fs > 20) { fs -= 2; x.font = `600 ${fs}px "Gobold", sans-serif`; } x.fillText(t.v, tx + 20, y + 148); });
  y += 230;
  x.font = '400 34px "Montserrat", sans-serif';
  for (const l of o.lines.slice(0, 4)) { x.fillStyle = tone(l.tone); x.beginPath(); x.arc(76, y - 11, 9, 0, Math.PI * 2); x.fill(); x.fillStyle = P.ink; y = wrapText(x, l.text, 104, y, W - 168, 46, 3) + 18; if (y > H - 230) break; }
  x.fillStyle = P.ink; x.fillRect(0, H - 170, W, 170);
  x.fillStyle = '#FFFFFF'; x.font = '600 28px "Montserrat", sans-serif'; x.fillText('72 Street · SEBI Registered Research Analyst · INH000029722', 64, H - 112);
  x.fillStyle = '#A8AAB0'; x.font = '400 22px "Montserrat", sans-serif';
  wrapText(x, 'For education. Not a recommendation. Investment in securities market are subject to market risks. Read all the related documents carefully before investing.', 64, H - 72, W - 128, 30, 2);
  return c;
}
async function shareCanvas(c, name) {
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], name, { type: 'image/png' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) {}
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function shareResult(sym) {
  const c = (st.repCards || []).find(x => x.sym === sym) || (st.lastStock && st.lastStock.result_card && st.lastStock.result_card.sym === sym ? st.lastStock.result_card : null); if (!c) return;
  const t = (v, d = 0) => v == null ? '–' : sg(v, d) + '%';
  const canvas = drawCard({ kicker: `${c.quarter || ''} results`, title: c.name, sub: `${c.sym}${c.industry ? ' · ' + c.industry : ''} · filed ${c.filed}`,
    big: c.reaction != null ? { v: sg(c.reaction, 1) + '%', k: `Stock move on ${c.reaction_day}, first session after results`, tone: c.reaction >= 0 ? 'up' : 'dn' } : null,
    tiles: [{ k: (c.lender ? 'Income' : 'Sales') + ' vs last year', v: t(c.sales_yoy), tone: (c.sales_yoy || 0) >= 0 ? 'up' : 'dn' }, { k: 'Profit vs last year', v: t(c.profit_yoy), tone: (c.profit_yoy || 0) >= 0 ? 'up' : 'dn' },
      { k: 'Profit vs last quarter', v: t(c.profit_qoq), tone: (c.profit_qoq || 0) >= 0 ? 'up' : 'dn' }, { k: 'Net profit, ₹ cr', v: n(c.profit), tone: 'neutral' }],
    lines: c.read || [] });
  shareCanvas(canvas, `72street-${c.sym}-results.png`);
}
function shareStock() {
  const d = st.lastStock; if (!d) return;
  const p = d.price || {};
  const canvas = drawCard({ kicker: 'At a glance', title: (d.profile || {}).name || d.sym, sub: `${d.sym}${(d.profile || {}).peer_scope ? ' · peers: ' + d.profile.peer_scope : ''} · as of ${p.asof || ''}`,
    big: p.last ? { v: '₹' + px(p.last), k: `${sg(p.chg)}% last session · ${p.r1y == null ? '' : sg(p.r1y, 1) + '% over a year'}`, tone: (p.chg || 0) >= 0 ? 'up' : 'dn' } : null,
    tiles: (d.glance || []).slice(0, 4).map(g => ({ k: g.k, v: g.v.length > 12 ? g.v.replace(' than peers', '').replace('Profit ', '') : g.v, tone: g.tone })),
    lines: (d.read || []).slice(1, 5) });
  shareCanvas(canvas, `72street-${d.sym}.png`);
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-share]'); if (s) { e.preventDefault(); e.stopPropagation(); shareResult(s.dataset.share); return; }
  const k = e.target.closest('[data-sharestock]'); if (k) { e.preventDefault(); shareStock(); }
}, true);

/* ---------- Compare ---------- */
async function vCompare() {
  await loadSearch();
  const [a, b] = st.cmp || [st.sym.stock || 'HDFCBANK', 'ICICIBANK'];
  st.cmp = [a, b];
  const form = `<form class="cform" id="cform"><input id="ca" list="stock-list" value="${esc(a)}" aria-label="First stock"><span class="vs">vs</span><input id="cb" list="stock-list" value="${esc(b)}" aria-label="Second stock"><button type="submit">Compare</button></form>`;
  view.innerHTML = `<section class="hero2"><h2>Compare two stocks</h2>${form}</section><div class="skel"></div>`;
  const d = await api(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const A = d.a, Bk = d.b;
  await Promise.all([A, Bk].map(async x => { try { x.xtra = await api(`/api/extra?sym=${encodeURIComponent(x.sym)}`); } catch (e) { x.xtra = {}; } }));
  const v = (x, k, f) => { const y = k(x); return y == null ? '–' : f(y); };
  const rows = [
    ['Price', x => (x.price || {}).last, y => '₹' + px(y)],
    ['Last session', x => (x.price || {}).chg, y => `<span class="${cls(y)}">${sg(y)}%</span>`],
    ['One year', x => (x.price || {}).r1y, y => `<span class="${cls(y)}">${sg(y, 1)}%</span>`],
    ['Market value, ₹ cr', x => (x.profile || {}).mcap, y => n(y)],
    ['P/E', x => (x.mine || {}).pe, y => n(y, 1)],
    ['Peer median P/E', x => (x.peer || {}).pe, y => n(y, 1)],
    ['ROE', x => (x.mine || {}).roe, y => n(y, 1) + '%'],
    ['ROCE', x => (x.mine || {}).roce, y => n(y, 1) + '%'],
    ['Dividend yield', x => (x.mine || {}).dy, y => n(y, 2) + '%'],
    ['Latest quarter', x => x.latest_q, y => esc(y)],
    ['Sales vs last year', x => x.sales_yoy, y => `<span class="${cls(y)}">${sg(y, 0)}%</span>`],
    ['Profit vs last year', x => x.profit_yoy, y => `<span class="${cls(y)}">${sg(y, 0)}%</span>`],
    ['Sales growth, 5 yr a year', x => x.sales_cagr5, y => n(y, 0) + '%'],
    ['Profit growth, 5 yr a year', x => x.profit_cagr5, y => n(y, 0) + '%'],
    ['Debt to equity', x => { const h = (x.xtra || {}).health; return !h ? null : h.lender ? 'Lender' : h.neg_worth ? 'Negative net worth' : h.de; }, y => typeof y === 'number' ? `<span class="${y >= 1 ? 'dn' : ''}">${n(y, 2)}</span>` : esc(y)],
    ['Promoter shares pledged', x => ((x.xtra || {}).pledge || {}).pledged, y => `<span class="${y >= 10 ? 'dn' : ''}">${n(y, 1)}%</span>`],
    ['P/E against own history', x => { const p = (x.xtra || {}).pe; return p && p.now ? `${n(p.now, 1)} vs usual ${n(p.median, 1)}` : null; }, y => y],
    ['Chart strength', x => x.chart ? `${x.chart.score} · ${x.chart.band}` : null, y => esc(y)],
    ['RSI', x => (x.tech || {}).rsi, y => n(y, 0)],
    ['Option floor / ceiling', x => x.opt ? `${px(x.opt.floor)} / ${px(x.opt.ceiling)}` : null, y => y]];
  const head = x => `<th class="cmp-h" data-stock="${esc(x.sym)}"><b>${esc((x.profile || {}).name || x.sym)}</b><span>${esc(x.sym)} · ${esc((x.profile || {}).peer_scope || '')}</span></th>`;
  const gl = x => `<div class="glance mini">${(x.glance || []).map(g => `<div class="gl t-${g.tone}"><span>${esc(g.k)}</span><b>${esc(g.v)}</b></div>`).join('')}</div>`;
  view.innerHTML = `<section class="hero2"><h2>${esc(A.sym)} vs ${esc(Bk.sym)}</h2>${form}</section>
    ${scorecard(d.verdict, A.sym, Bk.sym)}
    <div class="grid g2">${card(esc(A.sym) + ' at a glance', gl(A))}${card(esc(Bk.sym) + ' at a glance', gl(Bk))}</div>
    ${card('Side by side', `<div class="tw"><table class="cmp"><thead><tr><th></th>${head(A)}${head(Bk)}</tr></thead><tbody>${rows.map(([k, f, fmt]) => `<tr><td>${k}</td><td class="r">${v(A, f, fmt)}</td><td class="r">${v(Bk, f, fmt)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${appBridge()}`;
  bindCmp();
}
function scorecard(v, a, b) {
  if (!v || !v.rows.length) return '';
  const cell = (r, side) => `<td class="${r.edge === side ? 'win' : ''}">${esc(r[side])}${r.edge === side ? ' <span class="edge">edge</span>' : ''}</td>`;
  const wn = v.winner === 'a' ? a : v.winner === 'b' ? b : null;
  return `<section class="card vcard"><div class="v-top">
      <div class="v-score"><div><b class="${v.winner === 'a' ? 'lead' : ''}">${v.a}</b><span>${esc(a)}</span></div><i>–</i><div><b class="${v.winner === 'b' ? 'lead' : ''}">${v.b}</b><span>${esc(b)}</span></div></div>
      <div class="v-txt"><span class="k">${wn ? 'On the numbers, ' + esc(wn) + ' comes out ahead' : 'On the numbers, no clear winner'}</span><p>${esc(v.bottom)}</p></div></div>
    <p class="v-basis ${v.same ? '' : 'warn'}">${esc(v.basis)}</p>
    <div class="tw"><table class="vtab"><thead><tr><th>Measure</th><th>${esc(a)}</th><th>${esc(b)}</th><th>How to read it</th></tr></thead><tbody>
      ${v.rows.map(r => `<tr><td><b>${esc(r.measure)}</b><small class="vwhy">${esc(r.why)}</small></td>${cell(r, 'a')}${cell(r, 'b')}<td class="mut">${esc(r.why)}</td></tr>`).join('')}</tbody></table></div>
    <p class="note2">This scores past and present numbers, not the future, and it is not a recommendation to buy or sell either stock. A measure is left unscored when the numbers would mislead.</p></section>`;
}
function bindCmp() {
  const f = $('#cform'); if (!f) return;
  f.onsubmit = e => { e.preventDefault(); const a = resolveSym($('#ca').value), b = resolveSym($('#cb').value); if (a && b) { st.cmp = [a, b]; render(); } };
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-compare]'); if (!c) return; e.preventDefault();
  st.cmp = [c.dataset.compare, (st.lastStock && st.lastStock.peers && st.lastStock.peers[0] && st.lastStock.peers[0].sym) || 'ICICIBANK'];
  if (location.hash === '#compare') render(); else location.hash = 'compare';
}, true);

/* ---------- tap to explain ---------- */
const GLOSS = [
  [/order block/i, 'The last candle that moved the other way just before price broke a swing high or low. The term comes from Smart Money Concepts. It marks a chart shape, not proof of who traded.'],
  [/change of character|\bCHoCH\b/i, 'A close beyond the last swing high or low against the direction the swings were going, for example a close above the last swing high after a run of lower highs and lower lows.'],
  [/break of structure|\bBoS\b/, 'A close beyond the last swing high or low in the direction the swings were already going, for example a close above the last swing high during higher highs and higher lows.'],
  [/liquidity sweep|\bsweep/i, 'Price pokes past an obvious high or low and closes back inside it on the same candle.'],
  [/swing high|swing low/i, 'A swing high is a candle whose high is above the three candles on each side of it. A swing low is the mirror image.'],
  [/\bP\/E\b/, 'Price to earnings: how many rupees the market pays for one rupee of yearly profit. Higher usually means more growth is expected.'],
  [/\bPCR\b|put call ratio/i, 'Put call ratio: open puts divided by open calls. Above 1 means more put writers, who profit if the price holds up.'],
  [/\bROCE\b/, 'Return on capital employed: yearly operating profit as a share of all the money (debt and equity) in the business.'],
  [/\bROE\b/, 'Return on equity: yearly profit as a share of shareholders\' money in the business.'],
  [/max pain/i, 'The strike where option buyers as a group would lose the most at expiry.'],
  [/\bVIX\b/, 'India VIX: how much movement the options market expects in Nifty over the next 30 days. Higher means more fear.'],
  [/\bIV\b|implied vol/i, 'Implied volatility: the yearly movement that option prices imply. Compare it with realised volatility, the movement that actually happened.'],
  [/straddle|priced move/i, 'The price of the at-the-money call plus put. Roughly how far the options market expects the stock to travel by expiry, either way.'],
  [/\bfloor\b/i, 'The strike below the price where put writers hold the most positions. They lose if price falls through it, so they tend to defend it.'],
  [/\bceiling\b/i, 'The strike above the price where call writers hold the most positions. They lose if price rises through it, so they tend to defend it.'],
  [/\bYoY\b|vs last year|on last year/i, 'Compared with the same quarter a year earlier, which removes seasonal swings.'],
  [/\bQoQ\b|last quarter/i, 'Compared with the quarter just before.'],
  [/big money|institutions|\bFIIs?\b|\bDIIs?\b/i, 'Foreign (FII) and domestic (DII) institutions such as funds and insurers. Their holding changes come from quarterly shareholding filings.'],
  [/dividend yield/i, 'Yearly dividend as a share of the share price.'],
  [/price to book/i, 'Share price divided by book value per share, the accounting value of what shareholders own.'],
  [/\bRSI\b/, 'Relative strength index, 0 to 100. Above 70 the stock has run up hard, below 30 it has fallen hard.'],
  [/open interest|\bOI\b/, 'The number of futures or option contracts still open. Price tells you where the market is; open interest tells you how many people are committed.'],
  [/long buildup/i, 'Price up and open interest up: new buyers coming in.'],
  [/short buildup/i, 'Price down and open interest up: new sellers coming in.'],
  [/short covering/i, 'Price up and open interest down: sellers closing their positions.'],
  [/long unwinding/i, 'Price down and open interest down: buyers closing their positions.'],
  [/event premium/i, 'The move options price for the result, divided by the stock\'s normal move over the same days.'],
  [/net margin/i, 'Net profit as a share of sales.']];
function decorate() {
  view.querySelectorAll('.gl span, .stat .k, th, .card h3, .rc-n span, .tnum span, .walls span, .desk-grid span, table.cmp td:first-child').forEach(el => {
    if (el.dataset.tip || el.closest('[data-tip]')) return;
    const t = el.textContent; const hit = GLOSS.find(([re]) => re.test(t));
    if (hit) { el.dataset.tip = hit[1]; el.classList.add('term'); }
  });
}
let tipTimer = null;
document.addEventListener('click', e => {
  const t = e.target.closest('.term'); if (!t) return;
  const r = t.getBoundingClientRect(), tip = $('#tip');
  tip.textContent = t.dataset.tip; tip.hidden = false;
  tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + 'px'; tip.style.top = (r.bottom + 8) + 'px';
  clearTimeout(tipTimer); tipTimer = setTimeout(() => tip.hidden = true, 5000);
});

/* ---------- Live F&O: every F&O stock's day so far ---------- */
let lfTimer = null, lfPlay = null;
function lfFlash(d) {
  // a stock new to the top 3 of either one-way list since the last refresh: flash its tile, and check alerts now rather than in 3 minutes
  const top = new Set([...(d.bull || []).slice(0, 3), ...(d.bear || []).slice(0, 3)].map(r => r.sym));
  const seen = st.lfTop;
  st.lfTop = top;
  if (!seen || !d.open) return;
  const fresh = [...top].filter(x => !seen.has(x));
  fresh.forEach(sym => { const el = view.querySelector(`.lf-tile[data-lf="${CSS.escape(sym)}"]`); if (el) el.classList.add('lf-new'); });
  if (fresh.length && mAlerts().oneway) checkMarket();
}
const xUsual = s => s ? `${n(Math.abs(s), 1)}×` : '–';
function fmtSess(s) { try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch (e) { return s; } }
function lfSpark(p, chg, w = 160, h = 44) {
  const pts = (p || []).map((v, i) => [i, v]).filter(x => x[1] != null);
  if (pts.length < 2) return '';
  const vals = pts.map(x => x[1]), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), r = hi - lo || 1;
  const X = i => (i / 74 * w).toFixed(1), Y = v => (h - 3 - (v - lo) / r * (h - 6)).toFixed(1);
  const line = pts.map(([i, v]) => `${X(i)},${Y(v)}`).join(' ');
  const c = chg >= 0 ? 'var(--up)' : 'var(--dn)';
  const area = `${X(pts[0][0])},${Y(0)} ${line} ${X(pts[pts.length - 1][0])},${Y(0)}`;
  return `<svg class="lf-sp" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${area}" style="fill:${c};opacity:.14"/>
    <line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--faint);stroke-dasharray:2 3;stroke-width:1" vector-effect="non-scaling-stroke"/>
    <polyline points="${line}" style="fill:none;stroke:${c};stroke-width:1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function lfTile(r, p, big) {
  const vw = r.vwap ? (r.last >= r.vwap ? '<span class="lf-chip up" data-tip="VWAP: the average price paid today, weighted by volume">Above avg price</span>' : '<span class="lf-chip dn" data-tip="VWAP: the average price paid today, weighted by volume">Below avg price</span>') : '';
  return `<button class="lf-tile ${r.chg >= 0 ? 't-up' : 't-dn'}${big ? ' big' : ''}" data-lf="${esc(r.sym)}">
    <div class="lf-th"><b>${esc(r.sym)}</b><i class="num ${cls(r.chg)}" data-tip="Change on the day, from the previous close">${sg(r.chg)}%</i></div>
    <div class="lf-ts"><span>${esc(r.sector)}</span>${r.from_open != null ? `<em class="num ${cls(r.from_open)}">${sg(r.from_open)}% from open</em>` : ''}</div>
    ${lfSpark(p, r.chg)}
    <div class="lf-tf"><span class="lf-chip lf-x2" data-tip="Move from the open as a multiple of its usual high to low range">${xUsual(r.score)} usual range</span>${r.oi_kind ? pill(r.oi_kind) : '<span class="lf-chip">Futures quiet</span>'}${vw}</div></button>`;
}
function lfMoving(d) {
  const rows = d.oi_now || [];
  const bc = d.buildup || {};
  const counts = `<div class="lf-bc">${['long_buildup', 'short_buildup', 'short_covering', 'long_unwinding'].map(k => `<button class="${st.lfKind === k ? 'on' : ''}" data-kind="${k}">${pill(k)}<b class="num">${bc[k] ?? 0}</b><span>stocks today · ${st.lfKind === k ? 'hide' : 'see list'}</span></button>`).join('')}</div>${st.lfKind ? `<div class="tw lf-kind"><table><thead><tr><th>Stock</th><th>Sector</th><th class="r">Day</th><th class="r">Futures OI</th></tr></thead><tbody>${((d.bu || {})[st.lfKind] || []).map(r => `<tr class="sc-r" data-lf="${esc(r.sym)}"><td><b>${esc(r.sym)}</b></td><td class="mut">${esc(r.sector)}</td><td class="r num ${cls(r.chg)}">${sg(r.chg)}%</td><td class="r num">${sg(r.oi_pchg, 1)}%</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  const body = rows.length ? `<div class="lf-mv">${rows.map(r => `<button class="lf-mvr" data-lf="${esc(r.sym)}"><b>${esc(r.sym)}</b>${pill(r.kind)}
      <span class="num"><em>OI</em> ${sg(r.oi)}%</span><span class="num ${cls(r.px)}"><em>Price</em> ${sg(r.px)}%</span><small class="num">${compact(Math.abs(r.contracts))} contracts ${r.contracts >= 0 ? 'added' : 'closed'}</small></button>`).join('')}</div>`
    : `<div class="empty">${d.open ? 'This fills in once futures OI has been read twice today, about 10 minutes after 9:15.' : 'Shows during market hours: where futures positions changed most in the last 30 minutes.'}</div>`;
  const span = rows.length ? `last ${rows[0].mins} minutes` : 'last 30 minutes';
  return `<section class="card lf-mvcard"><h3>Futures positioning<small>all expiries added</small></h3>${counts}
    <h3 class="lf-h2">Moving now<small>${span}</small></h3>${body}
    ${rows.length ? '<p class="note2">OI up with price up is fresh buying. OI up with price down is fresh selling.</p>' : ''}</section>`;
}
async function structNow(slot) {
  if (!slot) return;
  let d; try { d = await api('/api/structure_now'); } catch (e) { slot.innerHTML = ''; return; }
  if (!slot.isConnected) return;
  if (!d.stocks) { slot.innerHTML = card('Structure now', '<div class="empty">Fills in once the first 5-minute candles of the day are in.</div>'); return; }
  const tag = e => e.kind === 'Break' ? (e.dir === 'up' ? 'Above swing high' : 'Below swing low') : `${e.kind} ${e.dir === 'up' ? 'up' : 'down'}`;     // the brand font has no arrow glyphs
  const go = sym => `href="#structure/${encodeURIComponent(sym)}" data-s5="1"`;
  const feed = d.feed.slice(0, 14).map(e => `<a class="sn-r" ${go(e.sym)}><span class="sn-t num">${istHM(e.t)}</span><b>${esc(e.sym)}</b><span class="se-tag ${e.dir === 'up' ? 'up' : 'dn'}">${tag(e)}</span><i class="num ${cls(e.chg)}">${e.chg == null ? '' : sg(e.chg) + '%'}</i></a>`).join('');
  const at = d.at_ob.slice(0, 10).map(x => `<a class="sn-r" ${go(x.sym)}><span class="sn-t"><i class="sb-sw ${x.dir === 'up' ? 'up' : 'dn'}"></i></span><b>${esc(x.sym)}</b><span class="mut">₹${px(x.bot)}–${px(x.top)} · before a move ${x.dir === 'up' ? 'up' : 'down'}</span><i class="num ${cls(x.chg)}">${x.chg == null ? '' : sg(x.chg) + '%'}</i></a>`).join('');
  slot.innerHTML = card(`Structure now<small>5-minute candles · ${d.stocks} F&amp;O stocks · to ${esc(d.last_bar || '')}</small>`,
    `<div class="sn-2"><div><h4 class="sc-h">Breaks today, latest first</h4>${feed || '<p class="mut sc-none">No break of structure or change of character yet today.</p>'}</div>
     <div><h4 class="sc-h">In an order block right now</h4>${at || '<p class="mut sc-none">No F&amp;O stock is inside one of today&#39;s order blocks right now.</p>'}</div></div>
     <p class="note2">${d.shape.up} stocks making higher highs and higher lows on 5-minute candles, ${d.shape.down} lower highs and lower lows. These describe what price did. Not a recommendation, an entry, a stop or a target. Tap a stock for its 5-minute chart.</p>`);
  slot.querySelectorAll('[data-s5]').forEach(a => { a.onclick = () => { st.sTf = '5m'; }; });
}
/* ---------- accounts: a member's watchlist, journal and alerts follow them between devices ---------- */
var acct = { user: null, ready: false, prev: null, pushed: {} };
function acctKeys() { return { watch: ['72s-watch', []], journal: ['72s-trades', []], alerts: ['72s-alerts', {}], malerts: ['72s-malerts', {}] }; }
function lsRaw(k, dflt) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; } catch (e) { return dflt; } }
async function acctBoot(force) {
  if (acct.ready && !force) return acct.user;
  try { const r = await fetch('/api/me?touch=1', { cache: 'no-store', credentials: 'same-origin' }); acct.user = (await r.json()).user; } catch (e) { acct.user = null; }
  acct.ready = true;
  if (acct.user) { acct.prev = acct.user.last_seen; acctMerge(acct.user.state || {}); }
  acctPaint();
  return acct.user;
}
function acctMerge(sv) {
  // what this browser has and what the account has, put together: lists are joined, settings keep this browser's choice
  for (const [name, [key, dflt]] of Object.entries(acctKeys())) {
    const lv = lsRaw(key, dflt), s2 = sv[name];
    let v = lv;
    if (Array.isArray(dflt) && Array.isArray(s2)) v = name === 'watch' ? [...new Set([...lv, ...s2])] : [...lv, ...s2.filter(x => !lv.some(y => y && x && y.id && y.id === x.id))];
    else if (!Array.isArray(dflt) && s2 && typeof s2 === 'object') v = { ...s2, ...lv };
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
    if (name === 'watch') st.watchMem = v;
  }
  acctPush(true);
}
function acctPush(force) {
  if (!acct.user) return;
  const body = {}; let any = false;
  for (const [name, [key, dflt]] of Object.entries(acctKeys())) { const v = JSON.stringify(lsRaw(key, dflt)); if (force || acct.pushed[name] !== v) { body[name] = JSON.parse(v); acct.pushed[name] = v; any = true; } }
  if (any) fetch('/api/me/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true }).catch(() => {});
}
setInterval(() => acctPush(false), 8000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') acctPush(false); });
function acctPaint() {
  const b = $('#acct-btn'); if (!b) return;
  if (acct.user) { const nm = acct.user.name || acct.user.email; b.innerHTML = `<i>${esc(nm.slice(0, 1).toUpperCase())}</i><span>${esc(nm.split(/[ @]/)[0].slice(0, 14))}</span>`; b.title = `Logged in as ${acct.user.email}`; }
  else { b.innerHTML = '<span>Log in</span>'; b.title = 'Log in to keep your list on every device'; }
}
async function acctPost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}
function loginView() {
  const up = st.acctMode === 'up';
  view.innerHTML = `<div class="tm-auth">
    <section class="tm-pitch"><span class="k">Free 72 Street account</span><h2>Your stocks, on every device</h2>
      <ul><li><b>One list everywhere.</b> Your watchlist and trading journal on your laptop and your phone.</li>
        <li><b>New since your last visit.</b> My Feed remembers what you have already seen, on any device.</li>
        <li><b>Alerts that follow you.</b> Your alert settings travel with your account.</li></ul>
      <p class="note2">Everything else on the site is open without an account. Free. Describes market data. Not a recommendation to buy or sell.</p></section>
    <form class="card tm-form" id="tm-form" novalidate>
      <div class="seg" id="tm-mode"><button type="button" class="${up ? '' : 'on'}" data-m="in">Log in</button><button type="button" class="${up ? 'on' : ''}" data-m="up">Create account</button></div>
      ${up ? '<label for="tm-name">Name<input id="tm-name" autocomplete="name" maxlength="40"></label>' : ''}
      <label for="tm-email">Email<input id="tm-email" type="email" autocomplete="email" required></label>
      <label for="tm-pw">Password<input id="tm-pw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="8" required></label>
      <p class="tm-err" id="tm-err" role="alert" hidden></p>
      <button class="tm-go" type="submit">${up ? 'Create account' : 'Log in'}</button>
      ${up ? '<p class="note2">At least 8 characters. Kept only as a one-way hash, never in plain text.</p>' : ''}
    </form></div>`;
  $('#tm-mode').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { st.acctMode = b.dataset.m; loginView(); } };
  $('#tm-form').onsubmit = async e => {
    e.preventDefault(); const err = $('#tm-err'); err.hidden = true;
    const body = { email: $('#tm-email').value.trim(), password: $('#tm-pw').value };
    if (up) body.name = $('#tm-name').value.trim();
    try {
      const j = await acctPost(up ? '/api/auth/signup' : '/api/auth/login', body);
      acct.user = j.user; acct.prev = j.user.last_seen; acct.ready = true;
      fetch('/api/me?touch=1', { credentials: 'same-origin' }).catch(() => {});
      acctMerge(j.user.state || {}); acctPaint(); location.hash = '#feed';
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}
const istDay = t => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
var tmTimer = null;
function tmChips(r) {
  const c = [];
  if (r.vwap && r.last) c.push(`<span class="lf-chip ${r.last >= r.vwap ? 'up' : 'dn'}">${r.last >= r.vwap ? 'Above' : 'Below'} VWAP</span>`);
  if (r.score && Math.abs(r.score) >= 1) c.push(`<span class="lf-chip lf-x2">One way ${r.score > 0 ? 'up' : 'down'} · ${xUsual(r.score)}</span>`);
  if (r.oi_kind) c.push(pill(r.oi_kind));
  return c.join('');
}
function tmEvText(e) {
  if (e.kind === 'Join') return `joined One-way moves ${e.dir === 'up' ? 'up' : 'down'}`;
  if (e.kind === 'Break') return e.dir === 'up' ? 'closed above its swing high' : 'closed below its swing low';
  return `${e.kind === 'BoS' ? 'break of structure' : 'change of character'} ${e.dir === 'up' ? 'up' : 'down'}`;
}
// account page: log in, or (when logged in) who you are and a way out. The old Terminal page is retired.
async function vLogin() {
  await acctBoot();
  if (!acct.user) return loginView();
  const u = acct.user, n_w = getWatch().length;
  view.innerHTML = `<section class="card tm-me-card"><span class="k">Your account</span><h2>${esc(u.name || u.email)}</h2>
    <p class="mut">Logged in as ${esc(u.email)}${u.since ? ` · member since ${esc(u.since)}` : ''}. Your watchlist (${n_w} stock${n_w === 1 ? '' : 's'}), journal and alert settings are saved to this account.</p>
    <p><a class="explain-btn" href="#feed" style="text-decoration:none">Open My Feed</a> <a class="chip" href="#mine">Watchlist</a> <a class="chip" href="#journal">Journal</a></p>
    <button class="chip" id="acct-out">Log out</button></section>`;
  $('#acct-out').onclick = async () => { try { await acctPost('/api/auth/logout', {}); } catch (e) {} acct.user = null; acctPaint(); render(); };
}
async function vTerminal() {
  await acctBoot();
  if (!acct.user) return loginView();
  const list = getWatch(), mine = new Set(list);
  const d = await api('/api/terminal?syms=' + encodeURIComponent(list.join(',')));
  if (d.empty) { view.innerHTML = '<div class="empty">The terminal fills in from 9:15 on a trading day.</div>'; return; }
  const W = d.watch || [];
  const pool = [...W, ...d.bull, ...d.bear];
  if (!st.tmSel || !pool.some(r => r.sym === st.tmSel)) st.tmSel = (W.find(r => r.fno) || W[0] || d.bull[0] || d.bear[0] || {}).sym;
  const since = acct.prev && istDay(acct.prev) === d.session ? acct.prev : null;
  const fresh = e => since && e.t > since;
  const evMine = d.events.filter(e => mine.has(e.sym));
  const nifty = (d.idx || []).find(x => x.sym === 'NIFTY');
  const moved = W.filter(r => r.chg != null && Math.abs(r.chg) >= 1.5);
  const newMine = evMine.filter(fresh), newAll = d.events.filter(fresh);
  const digest = [
    nifty ? `Nifty ${sg(nifty.chg)}%` : null,
    W.length ? `${moved.length} of your ${W.length} stocks moved 1.5% or more` : null,
    since ? `${newMine.length} new event${newMine.length === 1 ? '' : 's'} in your stocks, ${newAll.length} across F&amp;O` : `${evMine.length} event${evMine.length === 1 ? '' : 's'} in your stocks today`,
    `${d.up} F&amp;O stocks up, ${d.down} down`].filter(Boolean).join(' · ');
  const strip = (d.idx || []).map(x => `<div class="tm-ix"><span>${esc(x.name)}</span><b class="num">${px(x.last)}</b><i class="num ${x.sym === 'INDIAVIX' ? 'mut' : cls(x.chg)}">${sg(x.chg)}%</i><div class="tm-sp">${spark(x.path.filter(v => v != null), 90, 22, x.sym === 'INDIAVIX' ? css('--mut') : null)}</div></div>`).join('');
  const tot = (d.up + d.down) || 1;
  const wrow = (r, suggest) => `<div class="tm-w${r.sym === st.tmSel ? ' on' : ''}" tabindex="0" role="button" data-tsel="${esc(r.sym)}">
      <div class="tm-wh"><b>${esc(r.sym)}</b><i class="num ${cls(r.chg)}">${r.chg == null ? '–' : sg(r.chg) + '%'}</i></div>
      <div class="tm-wm"><span class="num">${r.last == null ? '' : '₹' + px(r.last)}</span><div class="tm-sp">${r.path ? spark(r.path.filter(v => v != null), 80, 20) : ''}</div></div>
      ${r.fno === false ? `<div class="tm-wc"><span class="mut">${esc(r.line || 'Cash only, no F&O data')}</span></div>` : `<div class="tm-wc">${tmChips(r)}</div>`}
      ${suggest ? `<button class="tm-add1" data-tadd="${esc(r.sym)}" aria-label="Add ${esc(r.sym)} to your list">+ Add</button>` : `<button class="tm-x" data-trm="${esc(r.sym)}" aria-label="Remove ${esc(r.sym)} from your list" title="Remove">×</button>`}</div>`;
  const left = W.length ? W.map(r => wrow(r)).join('')
    : `<p class="mut tm-empty">Add the stocks you follow. Until then, here are the F&amp;O stocks moving most steadily one way today. These are not picks.</p>${[...d.bull.slice(0, 4), ...d.bear.slice(0, 4)].map(r => wrow(r, true)).join('')}`;
  const evRow = e => `<div class="tm-ev${fresh(e) ? ' new' : ''}" role="button" tabindex="0" data-tsel="${esc(e.sym)}"><span class="num tm-t">${istHM(e.t)}</span><b>${esc(e.sym)}</b><span class="tm-et">${tmEvText(e)}</span><i class="num ${cls(e.chg)}">${e.chg == null ? '' : sg(e.chg) + '%'}</i></div>`;
  const evAll = st.tmEvAll;
  const evList = (evAll ? d.events : evMine).slice(0, 40);
  const mover = r => `<div class="tm-mv" role="button" tabindex="0" data-tsel="${esc(r.sym)}"><b>${esc(r.sym)}</b><span class="mut">${xUsual(r.score)}</span><i class="num ${cls(r.chg)}">${sg(r.chg)}%</i>${mine.has(r.sym) ? '<em>on your list</em>' : `<button class="tm-add1" data-tadd="${esc(r.sym)}" aria-label="Add ${esc(r.sym)}">+</button>`}</div>`;
  view.innerHTML = `<div class="tm">
    <section class="tm-top">
      <div class="tm-ixs">${strip || '<span class="mut">Index prices appear when the live feed runs.</span>'}</div>
      <div class="tm-br"><div><b class="up num">${d.up}</b> up <b class="dn num">${d.down}</b> down</div><div class="lf-ratio"><b style="width:${d.up / tot * 100}%"></b><u style="width:${d.down / tot * 100}%"></u></div>
        <span class="lf-live">${d.open ? `<i></i>Live · to ${esc(d.last_bar || '')}` : `Session of ${fmtSess(d.session)}`}</span></div>
      <div class="tm-me"><span>${esc(acct.user.name || acct.user.email)}</span><button id="tm-out" class="tm-link">Log out</button></div>
    </section>
    <p class="tm-dg"><b>${since ? `Since you last looked at ${istHM(since)}` : 'Today so far'}:</b> ${digest}.</p>
    <div class="tm-grid">
      <aside class="tm-col tm-left"><div class="tm-h"><h3>Your list</h3><span class="mut">${W.length ? `${W.length} stocks` : 'empty'}</span></div>
        <form id="tm-addf" class="tm-addf"><input id="tm-addq" list="sym-list" placeholder="Add a stock, e.g. SBIN" autocomplete="off" aria-label="Add a stock to your list"><button>Add</button></form>
        <div class="tm-ws">${left}</div>
        <p class="tm-keys">Keys: <kbd>j</kbd> <kbd>k</kbd> move · <kbd>Enter</kbd> full view · <kbd>a</kbd> add · <kbd>/</kbd> search anything</p></aside>
      <section class="tm-col tm-mid" id="tm-stock"><div class="skel" style="height:420px"></div></section>
      <aside class="tm-col tm-right">
        <div class="tm-h"><h3>What happened</h3><span class="seg" id="tm-evsw"><button class="${evAll ? '' : 'on'}" data-e="0">Your stocks</button><button class="${evAll ? 'on' : ''}" data-e="1">All F&amp;O</button></span></div>
        <div class="tm-evs">${evList.length ? evList.map(evRow).join('') : `<p class="mut tm-empty">${evAll ? 'Nothing yet today.' : 'Nothing in your stocks yet today. Breaks of structure and one-way moves show here as they happen.'}</p>`}</div>
        ${since ? '<p class="note2"><i class="tm-dot"></i> new since you last looked</p>' : ''}
        <div class="tm-h" style="margin-top:14px"><h3>Moving one way</h3><span class="mut">from the open</span></div>
        <div class="tm-mvs"><div>${d.bull.slice(0, 5).map(mover).join('') || '<p class="mut">None up yet.</p>'}</div><div>${d.bear.slice(0, 5).map(mover).join('') || '<p class="mut">None down yet.</p>'}</div></div>
      </aside></div>
    <p class="note2">What the data shows, not a recommendation to buy or sell. Events are on 5-minute candles. ${/upstox/i.test(d.source || '') ? 'Updates every 30 seconds.' : 'Prices are delayed.'}</p></div>`;
  // wiring
  const pickSym = sym => { st.tmSel = sym; view.querySelectorAll('.tm-w').forEach(x => x.classList.toggle('on', x.dataset.tsel === sym)); tmStock(sym); };
  view.querySelectorAll('[data-tsel]').forEach(el => { el.onclick = e => { if (e.target.closest('button')) return; pickSym(el.dataset.tsel); }; el.onkeydown = e => { if (e.key === 'Enter') pickSym(el.dataset.tsel); }; });
  view.querySelectorAll('[data-trm]').forEach(b => { b.onclick = () => { setWatch(getWatch().filter(x => x !== b.dataset.trm)); render(true); }; });
  view.querySelectorAll('[data-tadd]').forEach(b => { b.onclick = () => { const l = getWatch(); if (!l.includes(b.dataset.tadd)) setWatch([...l, b.dataset.tadd]); st.tmSel = b.dataset.tadd; render(true); }; });
  $('#tm-addf').onsubmit = e => { e.preventDefault(); const v = $('#tm-addq').value.trim().toUpperCase(); if (!/^[A-Z0-9&-]{1,20}$/.test(v)) return; const l = getWatch(); if (!l.includes(v)) setWatch([...l, v]); st.tmSel = v; render(true); };
  $('#tm-evsw').onclick = e => { const b = e.target.closest('[data-e]'); if (b) { st.tmEvAll = b.dataset.e === '1'; render(true); } };
  $('#tm-out').onclick = async () => { acctPush(true); try { await acctPost('/api/auth/logout', {}); } catch (e) {} acct.user = null; acctPaint(); render(); };
  if (st.tmSel) tmStock(st.tmSel);
  clearInterval(tmTimer);
  tmTimer = setInterval(() => { if (st.tab !== 'terminal') { clearInterval(tmTimer); return; } if (document.visibilityState === 'visible' && d.open && !(document.activeElement && document.activeElement.id === 'tm-addq')) render(true); }, 30000);
}
async function tmStock(sym) {
  const slot = $('#tm-stock'); if (!slot) return;
  const id = (tmStock.n = (tmStock.n || 0) + 1);
  let t; try { t = await api('/api/livefo?sym=' + encodeURIComponent(sym)); } catch (e) { t = { error: e.message }; }
  if (id !== tmStock.n || !slot.isConnected) return;
  const links = `<div class="tm-links"><a href="#fno/${encodeURIComponent(sym)}">Options and futures</a><a href="#structure/${encodeURIComponent(sym)}">Price structure</a><a href="#stock/${encodeURIComponent(sym)}">Company</a></div>`;
  if (t.error) { slot.innerHTML = `<div class="tm-sh"><h2>${esc(sym)}</h2></div><p class="mut">Not an F&amp;O stock, so there is no live chart here. The full stock page has its price, results and fundamentals.</p>${links}`; return; }
  const lv = [['Previous close', t.prev], ['Open', t.open], ['Day high', t.high], ['Day low', t.low], ['VWAP', t.vwap]];
  if (t.prof) { lv.push(['Most traded', t.prof.poc]); lv.push(['70% band top', t.prof.va[1]]); lv.push(['70% band bottom', t.prof.va[0]]); }
  const ladder = lv.filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  let placed = false;
  const lad = ladder.map(([k, v]) => { let h = ''; if (!placed && v < t.last) { placed = true; h = `<div class="tm-now"><span>Now</span><b class="num">₹${px(t.last)}</b></div>`; } return h + `<div class="tm-lv"><span>${k}</span><b class="num">₹${px(v)}</b><em class="num ${cls(t.last - v)}">${sg((t.last / v - 1) * 100)}%</em></div>`; }).join('') + (placed ? '' : `<div class="tm-now"><span>Now</span><b class="num">₹${px(t.last)}</b></div>`);
  const o = t.opt;
  const opt = o && (o.floor || o.ceiling) ? `<p class="tm-op"><b>Option writers, ${esc(o.expiry || '')} expiry:</b> most puts at ₹${px(o.floor)}, most calls at ₹${px(o.ceiling)}${o.pcr ? `, put call ratio ${n(o.pcr, 2)}` : ''}.</p>` : '';
  slot.innerHTML = `<div class="tm-sh"><div><h2>${esc(sym)}</h2><span class="mut">${esc(t.sector || '')}</span></div><div class="tm-px"><b class="num">₹${px(t.last)}</b><i class="num ${cls(t.chg)}">${sg(t.chg)}%</i></div></div>
    <p class="tm-line">${esc(t.line || '')}</p>
    <div class="tm-body"><div class="fn-chw tm-chw"><div class="chart" id="tm-ch"></div><canvas id="fn-vp" class="fn-vp" aria-hidden="true"></canvas></div>
      <div class="tm-ladder"><h4 class="sc-h">Today's levels</h4>${lad}</div></div>
    ${opt}
    <p class="note2">5-minute candles. Dotted line: VWAP. Bars on the right: volume at each price, the yellow one is the most traded. Levels describe today's trading; they are not entries, stops or targets.</p>
    ${links}`;
  if (window.LightweightCharts && t.bars && t.bars.length) {
    if (chart) { try { chart.remove(); } catch (e) {} chart = null; }
    const [y, mo2, dd] = t.session.split('-').map(Number), t0 = Date.UTC(y, mo2 - 1, dd, 9, 15) / 1000;
    chart = LightweightCharts.createChart($('#tm-ch'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Montserrat, system-ui, 'Segoe UI', sans-serif" },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: true, rightOffset: t.prof ? 18 : 4 }, crosshair: { mode: 0 }, handleScroll: false, handleScale: false });
    const cs = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
    cs.setData(t.bars.map(b => ({ time: t0 + b[0] * 300, open: b[1], high: b[2], low: b[3], close: b[4] })));
    const vw = chart.addLineSeries({ color: css('--sc'), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    vw.setData(t.bars.filter(b => b[5] != null).map(b => ({ time: t0 + b[0] * 300, value: b[5] })));
    if (t.prev) cs.createPriceLine({ price: t.prev, color: css('--faint'), lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Prev close' });
    if (t.prof) { const c0 = chart, drawVP = () => volProfile($('#fn-vp'), cs, c0, t.prof); requestAnimationFrame(() => requestAnimationFrame(drawVP));
      const ro = new ResizeObserver(() => { if (!$('#fn-vp')) { ro.disconnect(); return; } drawVP(); }); ro.observe($('#tm-ch')); }
  }
}
document.addEventListener('keydown', e => {
  if (st.tab !== 'terminal' || !acct.user || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
  const rows = [...view.querySelectorAll('.tm-w')]; if (!rows.length && e.key !== 'a') return;
  const i = rows.findIndex(r => r.classList.contains('on'));
  if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault(); const nx = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)))];
    if (nx) { nx.click(); nx.scrollIntoView({ block: 'nearest' }); }
  } else if (e.key === 'Enter' && i >= 0 && document.activeElement === document.body) { location.hash = 'fno/' + rows[i].dataset.tsel; }
  else if (e.key === 'a') { e.preventDefault(); const q = $('#tm-addq'); if (q) q.focus(); }
});
/* ---------- Live F&O, funnel view: every stock's day, narrowed to the strongest one-way moves ---------- */
const BU_TXT = { long_buildup: 'New buying in futures', short_buildup: 'New selling in futures', short_covering: 'Sellers exiting futures', long_unwinding: 'Buyers exiting futures' };
const BU_PRO = { long_buildup: 'Long build-up: price up and open interest up', short_buildup: 'Short build-up: price down and open interest up', short_covering: 'Short covering: price up and open interest down', long_unwinding: 'Long unwinding: price down and open interest down' };
const n_ = v => (Math.round(v * 10) / 10).toFixed(1);
function fnlSpaghetti(d, hot) {
  const W = 1000, H = 420, paths = d.paths || {}, keys = Object.keys(paths);
  const mags = []; keys.forEach(k => paths[k].forEach(v => { if (v != null) mags.push(Math.abs(v)); })); mags.sort((a, b) => a - b);
  let m = Math.max(1, mags[Math.floor(mags.length * 0.985)] || 1) * 1.1; const n = Math.max(...keys.map(k => paths[k].length), 2);     // scaled to the bulk of the market; the few big movers run off the edge
  const fp = st.fnlFocus && paths[st.fnlFocus]; if (fp) m = Math.max(m, ...fp.filter(v => v != null).map(v => Math.abs(v) * 1.08));     // ...unless the stock being followed is one of them
  const y = v => (H / 2 - Math.max(-m, Math.min(m, v)) / m * (H / 2 - 4)), x = i => i / (n - 1) * W;
  st.fnlSc = { W, H, m, n, y };
  const sec = d.sec_of || {};
  const line = (k, cls) => { const pts = paths[k].map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean); return pts.length > 1 ? `<polyline class="${cls}" data-s="${esc(k)}" data-c="${esc(sec[k] || '')}" points="${pts.join(' ')}"/>` : ''; };
  const last = k => { const a = paths[k].filter(v => v != null); return a.length ? a[a.length - 1] : 0; };
  const grid = [-m, -m / 2, 0, m / 2, m].map(v => `<line class="g${v === 0 ? ' z' : ''}" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  return `<div class="fnl-spw"><span class="fnl-ax t">+${n_(m)}%</span><span class="fnl-ax m">0%</span><span class="fnl-ax b">−${n_(m)}%</span><svg class="fnl-sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Every F&O stock's move through the day">${grid}
    <g class="bgl">${keys.map(k => line(k, last(k) >= 0 ? 'u' : 'd')).join('')}</g><g class="fgl"></g><line class="xh" x1="-10" x2="-10" y1="0" y2="${H}"/></svg><div class="fnl-endl" hidden></div><div class="fnl-tip" hidden></div><div class="fnl-tm" hidden></div></div>`;
}
function fnlRail(d) {
  const fl = (d.flow || []).slice().sort((a, b) => b.chg - a.chg);
  return `<div class="fnl-rail">${fl.map(s => `<button class="fnl-sec" data-sec="${esc(s.name)}" title="${esc(s.name)}: ${s.up} of ${s.n} up"><span>${esc(s.name)}</span><b class="${cls(s.chg)}">${sg(s.chg)}%</b></button>`).join('')}</div>`;
}
const fnlSpark = (arr, up, w = 70, h = 20) => { const a = (arr || []).filter(v => v != null); if (a.length < 2) return '';
  const lo = Math.min(...a), hi = Math.max(...a), r = hi - lo || 1;
  return `<svg class="fnl-mini ${up ? 'u' : 'd'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${a.map((v, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 2 - (v - lo) / r * (h - 4)).toFixed(1)}`).join(' ')}"/></svg>`; };
function fnlSmall(r, d, up) {
  return `<button class="fnl-s ${up ? 'u' : 'd'}" data-fsym="${esc(r.sym)}" title="Click to focus · ${esc(r.sector || '')}"><i>${String(r.rank).padStart(2, '0')}</i><b>${esc(r.sym)}</b><em class="num">${sg(r.chg)}%</em>${fnlSpark(d.paths[r.sym], up, 56, 14)}</button>`;
}
function fnlMid(r, d, up) {
  return `<button class="fnl-m ${up ? 'u' : 'd'}" data-fsym="${esc(r.sym)}" title="Click to focus"><div><b>${esc(r.sym)}</b><i>${String(r.rank).padStart(2, '0')}</i></div><em class="num">${sg(r.chg)}%</em>
    ${r.oi_kind && BU_TXT[r.oi_kind] ? `<span class="fnl-bu" title="${BU_PRO[r.oi_kind]}">${BU_TXT[r.oi_kind]}</span>` : '<span class="fnl-bu q" title="Futures open interest barely changed">Futures quiet</span>'}${fnlSpark(d.paths[r.sym], up, 120, 26)}<small class="num">₹${px(r.last)}</small></button>`;
}
function fnlBig(r, up, pre = '') {
  return `<div class="fnl-b ${up ? 'u' : 'd'}" data-fsym="${esc(r.sym)}" id="${pre}fb-${esc(r.sym)}"><div class="fnl-bh"><div><b class="symlink" data-stock="${esc(r.sym)}">${esc(r.sym)}</b><span>${esc(r.sector || '')}</span></div><i>${String(r.rank).padStart(2, '0')}</i></div>
    <div class="fnl-bp"><em class="num">${sg(r.chg)}%</em><span class="num">${r.last ? '₹' + px(r.last) : ''}${r.from_open != null ? `<small>${sg(r.from_open)}% from open</small>` : ''}</span></div>
    <div class="fnl-tags">${r.oi_kind && BU_TXT[r.oi_kind] ? `<span class="fnl-bu" title="${BU_PRO[r.oi_kind]}, ${sg(r.oi_pchg, 1)}%">${BU_TXT[r.oi_kind]}</span>` : '<span class="fnl-bu q" title="Futures open interest barely changed">Futures quiet</span>'}${r.vwap ? `<span class="fnl-bu q" title="VWAP: the average price paid today, weighted by volume">${r.last >= r.vwap ? 'Above' : 'Below'} today's average price ₹${px(r.vwap)}</span>` : ''}</div>
    <div class="fnl-ch" id="${pre}fc-${esc(r.sym)}"><div class="skel" style="height:96px"></div></div><div class="fnl-lv" id="${pre}fl-${esc(r.sym)}"></div></div>`;
}
// levels on today's 5-minute chart, described: the nearest order block in the direction of the move, the two nearest levels above and below
function fnlLevels(sym, up, x) {
  const S = x.structure || {}, c = x.candles || [];
  if (!c.length) return null;
  const istDay = t => new Date((t + 19800) * 1000).toISOString().slice(0, 10), dl = istDay(c[c.length - 1].t);
  const today = c.filter(k => istDay(k.t) === dl), prev = c.filter(k => istDay(k.t) < dl);
  const L = c[c.length - 1].c, lv = [];
  const add = (p, k) => { if (p && isFinite(p)) lv.push({ p, k }); };
  if (S.last_high) add(S.last_high.p, 'swing high'); if (S.last_low) add(S.last_low.p, 'swing low');
  if (today.length) { add(Math.max(...today.map(k => k.h)), "today's high"); add(Math.min(...today.map(k => k.l)), "today's low"); }
  if (prev.length) { add(Math.max(...prev.map(k => k.h)), "yesterday's high"); add(Math.min(...prev.map(k => k.l)), "yesterday's low"); }
  const uniq = a => a.filter((v, i) => !a.slice(0, i).some(w => Math.abs(w.p - v.p) / L < 0.0015));
  const above = uniq(lv.filter(v => v.p > L * 1.0005).sort((a, b) => a.p - b.p)).slice(0, 2), below = uniq(lv.filter(v => v.p < L * 0.9995).sort((a, b) => b.p - a.p)).slice(0, 2);
  const bl = (S.blocks || []).filter(b => up ? b.dir === 'up' && b.top < L : b.dir === 'dn' && b.bot > L).sort((a, b) => up ? b.top - a.top : a.bot - b.bot)[0];
  return { L, today, above, below, zone: bl };
}
function fnlChart(x, lv, up, W = 300, H = 96) {
  const k = lv.today.length ? lv.today : (x.candles || []).slice(-40);
  const _h = 0, hs = k.map(z => z.h), ls = k.map(z => z.l);
  const cHi = Math.max(...hs), cLo = Math.min(...ls), span = (cHi - cLo) || cHi * 0.01, reach = span * 0.45;
  const near = v => v <= cHi + reach && v >= cLo - reach;                  // levels far from today's range would squash the candles
  const marks = [...lv.above, ...lv.below].map(v => v.p).concat(lv.zone ? [lv.zone.top, lv.zone.bot] : []).filter(near);
  let hi = Math.max(cHi, ...marks), lo = Math.min(cLo, ...marks); const pad = (hi - lo) * 0.08 || 1; hi += pad; lo -= pad;
  const y = v => (H - (v - lo) / (hi - lo) * H).toFixed(1), bw = W / Math.max(k.length, 1);
  const zIn = lv.zone && near(lv.zone.top) && near(lv.zone.bot);
  const zone = zIn ? `<rect class="fz" x="0" width="${W}" y="${y(lv.zone.top)}" height="${Math.max(2, y(lv.zone.bot) - y(lv.zone.top))}"/>` : '';
  const labs = [];                                                       // labels at the right edge, pushed apart so they never sit on each other
  if (lv.zone) labs.push({ t: zIn ? 'Z1' : (lv.zone.top > cHi ? 'Z1 ↑' : 'Z1 ↓'), y: zIn ? +y(lv.zone.top) + 9 : (lv.zone.top > cHi ? 9 : H - 2), c: 'fzt', left: true });
  const lines = [];
  lv.above.forEach((v, i) => near(v.p) ? (lines.push(`<line class="fr" x1="0" x2="${W}" y1="${y(v.p)}" y2="${y(v.p)}"/>`), labs.push({ t: 'R' + (i + 1), y: +y(v.p) - 2, c: 'frt' })) : labs.push({ t: `R${i + 1} ↑`, y: 9, c: 'frt' }));
  lv.below.forEach((v, i) => near(v.p) ? (lines.push(`<line class="fs" x1="0" x2="${W}" y1="${y(v.p)}" y2="${y(v.p)}"/>`), labs.push({ t: 'S' + (i + 1), y: +y(v.p) + 10, c: 'fst' })) : labs.push({ t: `S${i + 1} ↓`, y: H - 2, c: 'fst' }));
  const right = labs.filter(l => !l.left).sort((a, b) => a.y - b.y); for (let i = 1; i < right.length; i++) if (right[i].y - right[i - 1].y < 11) right[i].y = right[i - 1].y + 11;
  const txt = labs.map(l => `<text class="${l.c}" x="${l.left ? 4 : W - 4}" y="${Math.max(9, Math.min(H - 2, l.y)).toFixed(1)}"${l.left ? '' : ' text-anchor="end"'}>${l.t}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${zone}${lines.join('')}
    ${k.map((z, i) => `<line class="${z.c >= z.o ? 'cu' : 'cd'}" x1="${(i * bw + bw / 2).toFixed(1)}" x2="${(i * bw + bw / 2).toFixed(1)}" y1="${y(z.h)}" y2="${y(z.l)}"/><rect class="${z.c >= z.o ? 'cu' : 'cd'}" x="${(i * bw + bw * 0.15).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" y="${y(Math.max(z.o, z.c))}" height="${Math.max(0.8, y(Math.min(z.o, z.c)) - y(Math.max(z.o, z.c)))}"/>`).join('')}${txt}</svg>`;
}
async function fnlFill(rows, up, pre = '') {
  for (const r of rows) {
    let x; try { x = await api('/api/structure_intraday?sym=' + encodeURIComponent(r.sym)); } catch (e) { continue; }
    const ch = document.getElementById(pre + 'fc-' + r.sym), lb = document.getElementById(pre + 'fl-' + r.sym); if (!ch || !lb) continue;
    const lv = fnlLevels(r.sym, up, x); if (!lv) { ch.innerHTML = ''; continue; }
    ch.innerHTML = fnlChart(x, lv, up, Math.max(220, Math.round(ch.clientWidth || 300)), Math.max(80, Math.round(ch.clientHeight || 96)));     // drawn at its real size, so nothing is stretched
    const pc = v => sg((v / lv.L - 1) * 100, 2) + '%';
    const cell = (t, w, v, c2) => `<div class="${c2}"><span>${t} · ${w}</span><b class="num">${v ? '₹' + px(v.p) : '–'}</b><i>${v ? `${pc(v.p)} · ${v.k}` : 'none near'}</i></div>`;
    lb.innerHTML = `${lv.zone ? `<div class="fz2" title="Order block: the last opposite candle before a strong move"><span>Z1 · where ${up ? 'buyers' : 'sellers'} stepped in before</span><b class="num">₹${px(lv.zone.bot)} to ₹${px(lv.zone.top)}</b><i>${pc(up ? lv.zone.top : lv.zone.bot)} · order block on 5-minute candles</i></div>` : `<div class="fz2"><span>Z1 · where ${up ? 'buyers' : 'sellers'} stepped in before</span><b>none ${up ? 'below' : 'above'} price today</b></div>`}
      ${cell('R1', 'next level above', lv.above[0], 'fr2')}${cell('R2', 'the one after', lv.above[1], 'fr2')}${cell('S1', 'next level below', lv.below[0], 'fs2')}${cell('S2', 'the one after', lv.below[1], 'fs2')}`;
  }
}
// focus: one stock or one sector comes forward, the rest of the market fades; kept across refreshes, cleared with Esc
function fnlFocusApply(d) {
  let root = view.querySelector('.fnl'); if (!root) return;
  const f = st.fnlFocus, sec = st.fnlSec, so = d.sec_of || {};
  if ((st.fnlScaleFor || null) !== (f || null)) {                       // redraw the chart so the followed stock fits on it
    st.fnlScaleFor = f || null;
    const w = root.querySelector('.fnl-spw'); if (w) { w.outerHTML = fnlSpaghetti(d, new Set()); fnlSpWire(d); }
    const ax = root.querySelectorAll('.fnl-ax'); if (ax.length === 3 && st.fnlSc) { ax[0].textContent = `+${n_(st.fnlSc.m)}%`; ax[2].textContent = `−${n_(st.fnlSc.m)}%`; }
  }
  root.classList.toggle('focusing', !!(f || sec));
  root.querySelectorAll('.bgl polyline[data-s]').forEach(el => el.classList.toggle('on', f ? el.dataset.s === f : sec ? el.dataset.c === sec : false));
  const fg = root.querySelector('.fgl'), endl = root.querySelector('.fnl-endl');
  if (fg) fg.innerHTML = [...root.querySelectorAll('.bgl polyline.on')].map(el => el.outerHTML.replace('class="', 'class="fg ')).join('');
  if (endl) {
    const P = (d.paths || {})[f], sc = st.fnlSc;
    let li = -1; if (P) for (let i = P.length - 1; i >= 0; i--) if (P[i] != null) { li = i; break; }
    if (f && sc && li >= 0) { endl.hidden = false; endl.style.left = (li / (sc.n - 1) * 100) + '%'; endl.style.top = (sc.y(P[li]) / sc.H * 100) + '%'; endl.innerHTML = `<b>${esc(f)}</b> <i class="${cls(P[li])}">${sg(P[li])}%</i>`; }
    else endl.hidden = true;
  }
  const fi = $('#fnl-follow'); if (fi && document.activeElement !== fi) fi.value = f || '';
  root.querySelectorAll('.fnl-right [data-fsym]').forEach(el => { const k = el.dataset.fsym; el.classList.toggle('on', f ? k === f : sec ? so[k] === sec : false); });
  root.querySelectorAll('.fnl-sec').forEach(el => el.classList.toggle('on', el.dataset.sec === (sec || (f ? so[f] : ''))));
  const slot = $('#fnl-focus'); if (!slot) return;
  if (f) {
    const r = [...(d.bull || []), ...(d.bear || [])].find(x => x.sym === f) || { sym: f, sector: so[f], chg: (d.chg || {})[f], rank: '' };
    const up = (r.chg || 0) >= 0;
    const peers = Object.keys(so).filter(k => so[k] === so[f] && k !== f && (d.chg || {})[k] != null).sort((a, b) => d.chg[b] - d.chg[a]);
    slot.innerHTML = `<div class="fnl-fp ${up ? 'u' : 'd'}"><div class="fnl-fh"><span>Focus</span><a href="#stock/${encodeURIComponent(f)}">Full stock page →</a><a href="#fno/${encodeURIComponent(f)}">Options →</a><button class="fnl-x" aria-label="Clear focus">×</button></div>
      ${fnlBig(r, up, 'fx-')}${peers.length ? `<div class="fnl-peers"><span>Same sector</span>${peers.slice(0, 12).map(k => `<button data-pick="${esc(k)}" class="${cls(d.chg[k])}">${esc(k)} ${sg(d.chg[k])}%</button>`).join('')}</div>` : ''}</div>`;
    fnlFill([r], up, 'fx-');
  } else if (sec) {
    const fl = (d.flow || []).find(x => x.name === sec) || {};
    const mem = Object.keys(so).filter(k => so[k] === sec && (d.chg || {})[k] != null).sort((a, b) => d.chg[b] - d.chg[a]);
    slot.innerHTML = `<div class="fnl-fp"><div class="fnl-fh"><span>Sector focus</span><b>${esc(sec)} <i class="${cls(fl.chg)}">${sg(fl.chg)}%</i></b><small>${fl.up ?? '–'} of ${fl.n ?? mem.length} up${fl.lead ? ` · leader ${esc(fl.lead)} ${sg(fl.lead_chg)}%` : ''}</small><button class="fnl-x" aria-label="Clear focus">×</button></div>
      <div class="fnl-peers">${mem.map(k => `<button data-pick="${esc(k)}" class="${cls(d.chg[k])}">${esc(k)} ${sg(d.chg[k])}%</button>`).join('')}</div><p class="note2" style="margin:6px 0 0">Click a stock to focus on it. Its line is the bright one on the left.</p></div>`;
  } else slot.innerHTML = '';
  slot.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { st.fnlFocus = b.dataset.pick; st.fnlSec = null; fnlFocusApply(d); });
  const x = slot.querySelector('.fnl-x'); if (x) x.onclick = () => { st.fnlFocus = st.fnlSec = null; fnlFocusApply(d); };
  if ((f || sec) && innerWidth < 1100) slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function fnlWire(d) {
  const root = view.querySelector('.fnl'); if (!root) return;
  root.querySelectorAll('.fnl-right [data-fsym]').forEach(el => {
    if (el.closest('#fnl-focus')) return;
    el.onclick = e => { if (e.target.closest('.symlink')) return; e.preventDefault(); const k = el.dataset.fsym; st.fnlFocus = st.fnlFocus === k ? null : k; st.fnlSec = null; fnlFocusApply(d); };
    el.onmouseenter = () => root.querySelectorAll(`polyline[data-s="${CSS.escape(el.dataset.fsym)}"]`).forEach(p => p.classList.add('peek'));
    el.onmouseleave = () => root.querySelectorAll('polyline.peek').forEach(p => p.classList.remove('peek'));
  });
  root.querySelectorAll('.fnl-sec').forEach(b => {
    b.onclick = () => { const k = b.dataset.sec; st.fnlSec = st.fnlSec === k ? null : k; st.fnlFocus = null; fnlFocusApply(d); };
    b.onmouseenter = () => root.querySelectorAll(`polyline[data-c="${CSS.escape(b.dataset.sec)}"]`).forEach(p => p.classList.add('peek'));
    b.onmouseleave = () => root.querySelectorAll('polyline.peek').forEach(p => p.classList.remove('peek'));
  });
  fnlFocusApply(d);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.tab === 'livefo' && (st.fnlFocus || st.fnlSec)) { st.fnlFocus = st.fnlSec = null; const d = st.lfData; if (d) fnlFocusApply(d); } });
// retail view of the whole market: one plain sentence, how the day went (share of stocks higher), and sectors as simple bars
function fnlMood(d) {
  const t = (d.up + d.down) || 1, pu = d.up / t * 100;
  const fl = d.flow || [], sup = fl.filter(s => s.chg > 0).length;
  const word = pu >= 65 ? 'Most F&amp;O stocks are rising today' : pu >= 55 ? 'More F&amp;O stocks are rising than falling' : pu > 45 ? 'F&amp;O stocks are split evenly today' : pu > 35 ? 'More F&amp;O stocks are falling than rising' : 'Most F&amp;O stocks are falling today';
  return `<div class="fnl-mood"><p>${word}.</p><div class="fnl-mbar"><b style="width:${pu}%"></b><u style="width:${100 - pu}%"></u></div>
    <div class="fnl-mlab"><span class="up"><b class="num">${d.up}</b> rising</span><span class="mut">${sup} of ${fl.length} sectors up</span><span class="dn"><b class="num">${d.down}</b> falling</span></div></div>`;
}
function fnlBreadth(d, chart = true) {
  const paths = Object.values(d.paths || {}), n = Math.max(...paths.map(p => p.length), 0);
  const share = [];
  for (let i = 0; i < n; i++) { let u = 0, c = 0; paths.forEach(p => { const v = p[i]; if (v != null) { c++; if (v > 0) u++; } }); if (c >= 20) share.push(u / c * 100); else break; }
  if (share.length < 2) return '';
  const W = 600, H = 150, x = i => i / (n - 1) * W, y = v => H - v / 100 * H;
  const pts = share.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const first = share[0], now = share[share.length - 1], peak = Math.max(...share), low = Math.min(...share);
  const pi = share.indexOf(peak), li = share.indexOf(low), tm = i => { const m = 555 + i * 5; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const say = `At the open ${Math.round(first)}% of F&amp;O stocks were higher than yesterday; now ${Math.round(now)}% are.`
    + (peak - now >= 12 && pi < share.length - 3 ? ` It reached ${Math.round(peak)}% around ${tm(pi)} and has faded since.` : now - low >= 12 && li < share.length - 3 ? ` It fell to ${Math.round(low)}% around ${tm(li)} and has recovered since.` : now < first - 10 ? ' The market has weakened through the day.' : now > first + 10 ? ' The market has strengthened through the day.' : ' Little change since the open.');
  const tk = [['9:15', 0], ['11:00', 21], ['13:00', 45], ['15:30', n - 1]].filter(([, i]) => i < n);
  if (!chart) return `<p class="fnl-say">${say}</p>`;
  return `<div class="fnl-br"><h4>How the day has gone</h4><p class="fnl-say">${say}</p>
    <div class="fnl-brw"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect class="bu" x="0" y="0" width="${W}" height="${H / 2}"/><rect class="bd" x="0" y="${H / 2}" width="${W}" height="${H / 2}"/>
      <line class="mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><polygon class="ar" points="0,${H} ${pts} ${x(share.length - 1).toFixed(1)},${H}"/><polyline class="ln" points="${pts}"/></svg>
      <span class="fnl-ya t">100% up</span><span class="fnl-ya m">half up</span><span class="fnl-ya b">all down</span></div>
    <div class="fnl-xa">${tk.map(([l, i]) => `<span style="left:${i / (n - 1) * 100}%">${l}</span>`).join('')}</div>
    <p class="note2">The line shows what share of the ${n ? Object.keys(d.paths).length : ''} F&amp;O stocks traded above yesterday's close at each moment. Above the middle line, more were up than down. Highest ${Math.round(peak)}%, lowest ${Math.round(low)}% today.</p></div>`;
}
function fnlBars(d) {
  const fl = (d.flow || []).slice().sort((a, b) => b.chg - a.chg), m = Math.max(...fl.map(s => Math.abs(s.chg)), 0.5);
  const bar = s => `<button class="fnl-sec fnl-bar" data-sec="${esc(s.name)}" title="${esc(s.name)}: ${s.up} of ${s.n} stocks up">
      <span>${esc(s.name)}</span><i class="${s.chg >= 0 ? 'p' : 'n'}"><u style="width:${Math.abs(s.chg) / m * 100}%"></u></i><b class="${cls(s.chg)} num">${sg(s.chg)}%</b><em>${s.up}/${s.n} up</em></button>`;
  const up = fl.filter(s => s.chg >= 0), dn = fl.filter(s => s.chg < 0).reverse();
  return `<div class="fnl-bars"><h4>Sectors today <small>average move of their F&amp;O stocks · click a sector to see its stocks</small></h4>
    <div class="fnl-b2"><div><h5 class="up">Rising · ${up.length}</h5>${up.map(bar).join('') || '<p class="mut">None</p>'}</div><div><h5 class="dn">Falling · ${dn.length}</h5>${dn.map(bar).join('') || '<p class="mut">None</p>'}</div></div></div>`;
}
// the every-stock chart answers the mouse: nearest line lights up with its name; a time line shows how many were up then
function fnlSpWire(d) {
  const w = view.querySelector('.fnl-spw'); if (!w || !st.fnlSc) return;
  const svg = w.querySelector('svg'), tip = w.querySelector('.fnl-tip'), tm = w.querySelector('.fnl-tm'), xh = svg.querySelector('.xh');
  const P = d.paths || {}, keys = Object.keys(P), so = d.sec_of || {}, C = d.chg || {};
  const hm = i => { const m = 555 + i * 5; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  let cur = null;
  const pick = e => {
    const r = svg.getBoundingClientRect(), sc = st.fnlSc, fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const i = Math.max(0, Math.min(sc.n - 1, Math.round(fx * (sc.n - 1)))), ym = fy * sc.H;
    let best = null, bd = 1e9, up = 0, cnt = 0;
    keys.forEach(k => { const v = P[k][i]; if (v == null) return; cnt++; if (v > 0) up++; const dd = Math.abs(sc.y(v) - ym); if (dd < bd) { bd = dd; best = k; } });
    return { i, best: bd < 14 ? best : null, up, cnt, fx, fy };
  };
  svg.onmousemove = e => {
    const h = pick(e), sc = st.fnlSc;
    xh.setAttribute('x1', h.fx * sc.W); xh.setAttribute('x2', h.fx * sc.W);
    if (h.cnt) { tm.hidden = false; tm.style.left = (h.fx * 100) + '%'; tm.textContent = `${hm(h.i)} · ${Math.round(h.up / h.cnt * 100)}% of stocks up`; }
    if (cur && cur !== h.best) svg.querySelectorAll('polyline.peek').forEach(p => p.classList.remove('peek'));
    cur = h.best;
    if (!cur) { tip.hidden = true; svg.style.cursor = 'crosshair'; return; }
    svg.querySelectorAll(`polyline[data-s="${CSS.escape(cur)}"]`).forEach(p => p.classList.add('peek'));
    svg.style.cursor = 'pointer';
    const v = P[cur][h.i];
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(cur)}</b> <span>${esc(so[cur] || '')}</span><br>${sg(v)}% at ${hm(h.i)} · now <i class="${cls(C[cur])}">${sg(C[cur])}%</i><br><small>click to focus</small>`;
    tip.style.left = Math.min(h.fx * 100, 78) + '%'; tip.style.top = Math.max(0, Math.min(h.fy * 100 - 12, 80)) + '%';
  };
  svg.onmouseleave = () => { tip.hidden = true; tm.hidden = true; xh.setAttribute('x1', -10); xh.setAttribute('x2', -10); svg.querySelectorAll('polyline.peek').forEach(p => p.classList.remove('peek')); cur = null; };
  svg.onclick = () => { if (!cur) return; st.fnlFocus = st.fnlFocus === cur ? null : cur; st.fnlSec = null; fnlFocusApply(d); const f = $('#fnl-focus'); if (f && st.fnlFocus) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
}
function lfFunnel(d) {
  const B = d.bull || [], R = d.bear || [], hot = new Set([...B.slice(0, 3), ...R.slice(0, 3)].map(r => r.sym));
  const band = (rows, up, total) => `<section class="fnl-band ${up ? 'u' : 'd'}">
      <div class="fnl-bandh"><h2 class="sec-h">${up ? 'Rising steadily' : 'Falling steadily'} · ${n(total)}</h2></div>
      <h4>${up ? 'The three strongest' : 'The three weakest'}</h4>
      <div class="fnl-c3">${rows.slice(0, 3).map(r => fnlBig(r, up)).join('') || `<div class="empty">No stock has moved one way ${up ? 'up' : 'down'} yet.</div>`}</div>
      ${rows.length > 3 ? `<h4>Next seven, 4 to 10</h4><div class="fnl-c2">${rows.slice(3, 10).map(r => fnlMid(r, d, up)).join('')}</div>` : ''}
      ${rows.length > 10 ? `<h4>Also ${up ? 'rising' : 'falling'} steadily, 11 to 20</h4><div class="fnl-c1">${rows.slice(10, 20).map(r => fnlSmall(r, d, up)).join('')}</div>` : ''}</section>`;
  const syms = Object.keys(d.paths || {}).sort();
  return `<section class="fnl">
    <section class="fnl-every"><div class="fnl-eh"><div><b class="up num">${d.up}</b> rising · <b class="dn num">${d.down}</b> falling <span class="mut">· one line per F&amp;O stock, from yesterday's close${d.open ? ' · prices to ' + esc(d.last_bar) : ''}</span></div>
      <form class="fnl-fol" id="fnl-fol"><input id="fnl-follow" list="fnl-syms" placeholder="Follow a stock…" autocomplete="off" aria-label="Follow one stock"><datalist id="fnl-syms">${syms.map(k => `<option value="${esc(k)}">`).join('')}</datalist></form></div>
      <div class="fnl-sw">${fnlRail(d)}${fnlSpaghetti(d, hot)}</div>
      <div class="fnl-xa2"><span>9:15</span><span>11:00</span><span>13:00</span><span>15:30</span></div>
      <p class="fnl-hint">Point at a line to see the stock. Click it, type a name above, or pick a sector to follow it; everything else blurs. Esc to clear.</p></section>
    <div id="fnl-focus"></div>
    <div class="fnl-left"><div class="fnl-l1">${fnlMood(d)}${fnlBreadth(d, false)}</div><div class="fnl-l2">${fnlBars(d)}</div></div>
    <div class="fnl-right">${band(B, true, d.bull_n)}${band(R, false, d.bear_n)}</div></section>
`;
}
async function vLiveFO() {
  const d = await api('/api/livefo');
  if (d.empty) { view.innerHTML = '<div class="empty">Live F&amp;O starts at 9:15 on a trading day.</div>'; return; }
  const fast = /upstox/i.test(d.source || '');
  const asof = d.open ? `<span class="lf-live"><i></i>${fast ? 'Live' : 'Live · delayed'} · prices to ${d.last_bar}</span>` : `Session of ${fmtSess(d.session)} · full day`;
  const ff = d.flow || [];
  $('#headline').textContent = ff.length ? `Live F&O · ${ff[0].name} leading, ${ff[ff.length - 1].name} lagging` : `${d.total} F&O stocks.`;
  const lfGlance = ff.length ? glance([[n(d.bull_n), 'one-way up', 'up'], [n(d.bear_n), 'one-way down', 'dn'],
    [`${esc(ff[0].name)} ${sg(ff[0].chg)}%`, 'leading sector', ff[0].chg >= 0 ? 'up' : 'dn'], [`${esc(ff[ff.length - 1].name)} ${sg(ff[ff.length - 1].chg)}%`, 'lagging sector', ff[ff.length - 1].chg >= 0 ? 'up' : 'dn']]) : '';
  const tot = (d.up + d.down) || 1, more = st.lfMore, secAll = st.lfSec;
  const pick = rows => rows.slice(0, more ? 18 : 3);
  const grid = (rows, up) => rows.length ? `<div class="lf-tiles">${pick(rows).map(r => lfTile(r, d.paths[r.sym])).join('')}</div>` : `<div class="empty">No stock has moved one way ${up ? 'up' : 'down'} yet.</div>`;
  const fl = d.flow || [], shown = secAll || fl.length <= 6 ? fl : [...fl.slice(0, 3), ...fl.slice(-3)];
  const focus = st.lfStocks;
  const members = focus ? Object.keys(d.paths || {}).filter(k => d.chg[k] != null && d.paths[k].some(v => v != null)).map(k => ({ sym: k, chg: d.chg[k], line: d.paths[k], sec: (d.sec_of || {})[k] })).sort((a, b) => b.chg - a.chg) : [];
  const secRows = focus
    ? `<div class="lf-mems">` + members.map(r => `<button class="lf-srow lf-mem" data-mem="${esc(r.sym)}"><div><b>${esc(r.sym)}</b>${r.sec ? `<span>${esc(r.sec)}</span>` : ''}</div><i class="num ${cls(r.chg)}">${sg(r.chg)}%</i></button>`).join('') + '</div>'
    : shown.map(s => `<button class="lf-srow" data-sec="${esc(s.name)}"><div><b>${esc(s.name)}</b>${s.broad ? '<em>Broad</em>' : ''}<span>${s.up} of ${s.n} up · ${esc(s.lead)} ${sg(s.lead_chg)}%</span></div><i class="num ${cls(s.chg)}">${sg(s.chg)}%</i></button>`).join('');
  const viewSeg = `<span class="seg" id="lf-view"><button class="${st.lfView === 'cards' ? '' : 'on'}" data-v="funnel">Funnel</button><button class="${st.lfView === 'cards' ? 'on' : ''}" data-v="cards">Cards</button></span>`;
  if (st.lfView !== 'cards') {
    $('#headline').textContent = 'Live F&O';
    view.innerHTML = `<div class="fnl-top"><span class="mut">Steady movers are stocks that went mostly one way from the open. Levels show where price turned before, not entries, stops or targets.</span>${viewSeg}</div>${lfFunnel(d)}`;
    $('#lf-view').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { st.lfView = b.dataset.v; render(true); } };
    st.lfData = d; fnlWire(d); fnlSpWire(d);
    const fo = $('#fnl-fol'); if (fo) { const go = () => { const v = $('#fnl-follow').value.trim().toUpperCase(); if ((d.paths || {})[v]) { st.fnlFocus = v; st.fnlSec = null; fnlFocusApply(d); } };
      fo.onsubmit = e => { e.preventDefault(); go(); }; $('#fnl-follow').oninput = e => { if ((d.paths || {})[e.target.value.trim().toUpperCase()]) go(); }; }
    const pro = view.querySelector('.fnl-pro'); if (pro) pro.ontoggle = () => { st.fnlSpag = pro.open; };
    fnlFill((d.bull || []).slice(0, 3), true); fnlFill((d.bear || []).slice(0, 3), false);
    return;
  }
  view.innerHTML = `<div class="fnl-top">${lfGlance}${viewSeg}</div><section class="card lf-top">
      <div class="lf-count"><span class="k">${asof}</span>
        <div class="lf-big"><b class="up num">${d.up}</b><em>up</em><b class="dn num">${d.down}</b><em>down</em></div>
        <div class="lf-ratio"><b style="width:${d.up / tot * 100}%"></b><u style="width:${d.down / tot * 100}%"></u></div></div>
      <div class="lf-dist"><span class="k">How far they moved today</span>${lfDepth(d.depth || {})}</div>
    </section>
    <section><div class="lf-2">
      <div><h2 class="sec-h">One-way moves up <small>rose steadily from the open, not up and down · <label class="ack lf-al"><input type="checkbox" data-mk="oneway" ${mAlerts().oneway ? 'checked' : ''}> alert me when a stock joins these lists</label> <label class="ack lf-al"><input type="checkbox" data-mk="sound" ${mAlerts().sound ? 'checked' : ''}> with a chime</label></small></h2>${grid(d.bull, true)}</div>
      <div><h2 class="sec-h">One-way moves down <small>fell steadily from the open</small></h2>${grid(d.bear, false)}</div></div>
      ${d.bull.length > 3 || d.bear.length > 3 ? `<button class="lf-more" id="lf-more">${more ? 'Show top 3' : 'Show more'}</button>` : ''}</section>
    <section class="card"><h3><span class="seg" id="lf-fsw"><button class="${focus ? '' : 'on'}" data-f="0">Sector flow</button><button class="${focus ? 'on' : ''}" data-f="1">Stock flow</button></span><small>${focus ? `all ${members.length} F&amp;O stocks, % from yesterday's close, since 9:15` : 'average of F&amp;O stocks in each sector, since 9:15'}</small></h3>
      <div class="lf-flow"><div><div class="lf-river"><canvas id="lf-cv"></canvas></div>
        <div class="lf-rp"><button id="lf-play" class="lf-pb" aria-label="Replay the day">▶</button><input type="range" id="lf-at" min="0" max="74" step="1" aria-label="Time of day"><span id="lf-att" class="num"></span><button id="lf-now" class="lf-more" hidden>Back to now</button></div></div>
      <div class="lf-srows">${secRows}${!focus && fl.length > 6 ? `<button class="lf-more" id="lf-sec">${secAll ? 'Show fewer' : `All ${fl.length} sectors`}</button>` : ''}</div></div></section>
    ${lfMoving(d)}
    <div id="snow-slot"></div>
    <p class="note2">Futures OI: ${esc(d.oi_basis || '')}. What the data shows, not a recommendation to buy or sell.${d.open ? (fast ? ' Updates every 30 seconds.' : ' Updates every two minutes.') : ''}</p>`;
  // replay: the chart, the side list and the up/down count as they stood at any 5-minute mark of the day
  const lastSlot = Math.max(0, ...Object.values(d.paths || {}).map(p => { let k = p.length - 1; while (k > 0 && p[k] == null) k--; return k; }));
  const at = st.lfAt != null && st.lfAt < lastSlot ? st.lfAt : null;
  const cut = (line, k) => { const l = line.slice(0, k + 1); let j = k; while (j > 0 && l[j] == null) j--; return [l, l[j]]; };
  const asAt = k => {
    if (k == null) return { fl, members };
    const f2 = fl.map(s_ => { const [line, v] = cut(s_.line, k); return { ...s_, line, chg: v ?? 0 }; }).sort((a, b) => b.chg - a.chg);
    const m2 = members.map(r => { const [line, v] = cut(r.line, k); return { ...r, line, chg: v ?? 0 }; }).sort((a, b) => b.chg - a.chg);
    return { fl: f2, members: m2 };
  };
  const hm = k => { const m = 555 + k * 5 + 5; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const flowDraw = hi => { const x = asAt(at); return focus ? stockFlowChart(x.members, null, hi) : flowChart(x.fl, hi); };
  const replay = k => {
    st.lfAt = k >= lastSlot ? null : k;
    const now = st.lfAt == null, x = asAt(st.lfAt);
    if (focus) stockFlowChart(x.members); else flowChart(x.fl);
    $('#lf-att').textContent = now ? (d.open ? `now, ${d.last_bar}` : 'close') : `at ${hm(k)}`;
    $('#lf-now').hidden = now;
    view.querySelector('.lf-flow').classList.toggle('lf-replay', !now);     // the live 'x of n up' lines do not apply to a past moment
    const ups = Object.values(d.paths || {}).map(p => cut(p, now ? lastSlot : k)[1]).filter(v => v != null);
    const u = ups.filter(v => v > 0).length, dn2 = ups.filter(v => v < 0).length;
    const big = view.querySelector('.lf-big'); if (big) { big.children[0].textContent = now ? d.up : u; big.children[2].textContent = now ? d.down : dn2; }
    const rt = view.querySelector('.lf-ratio'); if (rt) { const t2 = (now ? d.up + d.down : u + dn2) || 1; rt.children[0].style.width = (now ? d.up : u) / t2 * 100 + '%'; rt.children[1].style.width = (now ? d.down : dn2) / t2 * 100 + '%'; }
    if (!focus) view.querySelectorAll('.lf-srow[data-sec]').forEach(el => { const f = x.fl.find(z => z.name === el.dataset.sec); const i = el.querySelector('i'); if (f && i) { i.textContent = sg(f.chg) + '%'; i.className = 'num ' + cls(f.chg); } });
  };
  const rng = $('#lf-at'); rng.max = lastSlot; rng.value = at ?? lastSlot;
  rng.oninput = () => { clearInterval(lfPlay); $('#lf-play').textContent = '▶'; replay(+rng.value); };
  $('#lf-now').onclick = () => { clearInterval(lfPlay); $('#lf-play').textContent = '▶'; rng.value = lastSlot; replay(lastSlot); };
  $('#lf-play').onclick = () => {
    if (lfPlay) { clearInterval(lfPlay); lfPlay = null; $('#lf-play').textContent = '▶'; return; }
    let k = +rng.value >= lastSlot ? 0 : +rng.value; $('#lf-play').textContent = '❚❚';
    lfPlay = setInterval(() => { if (!rng.isConnected || k > lastSlot) { clearInterval(lfPlay); lfPlay = null; if (rng.isConnected) $('#lf-play').textContent = '▶'; return; } rng.value = k; replay(k); k++; }, 180);
  };
  replay(at ?? lastSlot);
  structNow($('#snow-slot'));
  view.querySelectorAll('[data-lf]').forEach(el => { el.onclick = e => lfGo(el.dataset.lf, e); });
  view.querySelectorAll('[data-sec]').forEach(el => { el.onclick = () => { location.hash = 'heat/' + encodeURIComponent(el.dataset.sec); }; el.onmouseenter = () => flowChart(fl, el.dataset.sec); el.onmouseleave = () => flowChart(fl); });
  view.querySelectorAll('[data-mem]').forEach(el => { el.onclick = e => lfGo(el.dataset.mem, e); el.onmouseenter = () => flowDraw(el.dataset.mem); el.onmouseleave = () => flowDraw(); });
  $('#lf-fsw').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { st.lfStocks = b.dataset.f === '1'; render(true); } };
  view.querySelectorAll('[data-kind]').forEach(el => { el.onclick = () => { st.lfKind = st.lfKind === el.dataset.kind ? null : el.dataset.kind; render(true); }; });
  const m = $('#lf-more'); if (m) m.onclick = () => { st.lfMore = !st.lfMore; render(true); };
  const lv = $('#lf-view'); if (lv) lv.onclick = e => { const b = e.target.closest('[data-v]'); if (b) { st.lfView = b.dataset.v; render(true); } };
  const s = $('#lf-sec'); if (s) s.onclick = () => { st.lfSec = !st.lfSec; render(true); };
  clearInterval(lfTimer);
  lfTimer = setInterval(() => { if (st.tab !== 'livefo') { clearInterval(lfTimer); return; } if (document.visibilityState === 'visible' && d.open) render(true); }, fast ? 30000 : 120000);
  lfFlash(d);
}
function lfDepth(dp) {
  const W = innerWidth < 700 ? 380 : 640, H = 128, base = H - 20, lim = 7.5;
  const bins = Object.keys(dp).map(Number).sort((a, b) => a - b);
  const mx = Math.max(...Object.values(dp), 1);
  const X = v => W / 2 + v / lim * (W / 2 - 12), Y = c => base - c / mx * (H - 46);
  const pts = up => bins.filter(b => up ? b >= 0 : b < 0).map(b => [X(b + 0.5), Y(dp[b]), dp[b]]);
  const u = pts(true), dn = pts(false);
  const area = (p, col) => p.length ? `<polygon points="${X(0)},${base} ${p.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')} ${p[p.length - 1][0].toFixed(1)},${base}" style="fill:var(${col});opacity:.16"/><polyline points="${X(0)},${base} ${p.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')}" style="fill:none;stroke:var(${col});stroke-width:2"/>` : '';
  const dnSorted = [...dn].reverse();
  const dots = (p, col) => p.map(q => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3" style="fill:var(${col})"/><text x="${q[0].toFixed(1)}" y="${(q[1] - 7).toFixed(1)}" text-anchor="middle" style="font-size:10.5px;fill:var(--mut)">${q[2]}</text>`).join('');
  const ticks = [-6, -4, -2, 0, 2, 4, 6].map(t => `<text x="${X(t)}" y="${H - 4}" text-anchor="middle" style="font-size:10px;fill:var(--faint)">${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}%</text>`).join('');
  return `<svg class="lf-dots" viewBox="0 0 ${W} ${H}" role="img" aria-label="F&amp;O stocks by size of move today"><line x1="8" x2="${W - 8}" y1="${base}" y2="${base}" style="stroke:var(--line)"/>${area(u, '--up')}${area(dnSorted, '--dn')}${dots(u, '--up')}${dots(dn, '--dn')}${ticks}</svg>`;
}
function flowChart(fl, hi) {
  const cv = $('#lf-cv'); if (!cv || !fl.length) return;
  const box = cv.parentElement, W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const L = 48, R = 118, T = 12, Bm = 22, w = W - L - R, h = H - T - Bm;
  const all = fl.flatMap(s => s.line).filter(v => v != null);
  const lim = Math.max(1, Math.ceil(Math.max(...all.map(Math.abs)) * 2) / 2);
  const X = s => L + s / 74 * w, Y = v => T + (lim - v) / (2 * lim) * h;
  const up = css('--up'), dn = css('--dn');
  x.font = '11px Montserrat, system-ui, sans-serif'; x.fillStyle = css('--faint'); x.strokeStyle = css('--grid'); x.lineWidth = 1;
  [-lim, -lim / 2, 0, lim / 2, lim].forEach(g => { x.beginPath(); x.moveTo(L, Y(g)); x.lineTo(L + w, Y(g)); x.stroke(); x.textAlign = 'right'; x.fillText((g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g) + '%', L - 6, Y(g) + 4); });
  x.textAlign = 'center';
  [[0, '9:15'], [21, '11:00'], [45, '13:00'], [74, '15:30']].forEach(([s, t]) => x.fillText(t, Math.min(Math.max(X(s), L + 14), L + w - 14), H - 6));
  const draw = (p, col, a, lw, blur) => { x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = lw; x.shadowColor = col; x.shadowBlur = blur || 0; x.beginPath(); let on = false; p.forEach((v, i) => { if (v == null) return; if (on) x.lineTo(X(i), Y(v)); else x.moveTo(X(i), Y(v)); on = true; }); x.stroke(); x.shadowBlur = 0; x.globalAlpha = 1; };
  const lead = new Set([...fl.slice(0, 3), ...fl.slice(-3)].map(s => s.name));
  if (hi) lead.add(hi);
  fl.forEach(s => { if (!lead.has(s.name)) draw(s.line, s.chg >= 0 ? up : dn, 0.14, 1); });
  x.strokeStyle = css('--mut'); x.lineWidth = 1; x.beginPath(); x.moveTo(L, Y(0)); x.lineTo(L + w, Y(0)); x.stroke();
  const labels = [];
  fl.filter(s => lead.has(s.name)).forEach(s => {
    const col = s.chg >= 0 ? up : dn, on = !hi || s.name === hi;
    draw(s.line, s.name === hi ? css('--ink') : col, on ? 1 : 0.2, s.name === hi ? 2.6 : 1.8, on ? 6 : 0);
    let k = s.line.length - 1; while (k > 0 && s.line[k] == null) k--;
    if (s.line[k] == null) return;
    x.fillStyle = col; x.globalAlpha = on ? 1 : 0.3; x.beginPath(); x.arc(X(k), Y(s.line[k]), 3, 0, 7); x.fill(); x.globalAlpha = 1;
    labels.push([Y(s.line[k]), s, col, on]);
  });
  labels.sort((a, b) => a[0] - b[0]);
  let lastY = -99; x.font = '600 11px Montserrat, system-ui, sans-serif'; x.textAlign = 'left';
  labels.forEach(([yy, s, col, on]) => { const y2 = Math.max(yy, lastY + 13); lastY = y2; x.globalAlpha = on ? 1 : 0.35; x.fillStyle = col; x.fillText(`${s.name} ${sg(s.chg, 1)}%`, L + w + 8, y2 + 4); });
  x.globalAlpha = 1;
}
/* ---------- sector heatmap: the whole market, one tile per stock ---------- */
async function vRotation() {
  const d = await api('/api/rotation');
  const wk = innerWidth < 700 ? 8 : d.weeks.length, from = d.weeks.length - wk;
  const top = d.rows[0], low = d.rows[d.rows.length - 1];
  $('#headline').textContent = `Over the last 4 weeks, ${top.name} beat the whole market by the most (${sg(top.m4, 1)}%) and ${low.name} lagged it by the most (${sg(low.m4, 1)}%).`;
  const label = w => new Date(w + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const range = w => { const e = new Date(w + 'T00:00:00'), s = new Date(e.getTime() - 4 * 864e5), mo = x => x.toLocaleDateString('en-IN', { month: 'short' }); return `${s.getDate()}${mo(s) === mo(e) ? '' : ' ' + mo(s)} to ${e.getDate()} ${mo(e)}`; };
  const mv = x => x >= 0.05 ? `rose ${n(x, 1)}%` : x <= -0.05 ? `fell ${n(-x, 1)}%` : 'was flat';
  const tip = (name, c, w) => { const m = d.market[d.weeks.indexOf(w)]; return `${range(w)}: ${name} ${mv(c.r)}, the whole market ${mv(m)}. ${c.x >= 0 ? 'Beat' : 'Lagged'} the market by ${n(Math.abs(c.x), 1)}%.${c.t >= 1.3 ? ` Trading was ${n(c.t, 1)} times its usual.` : ''}`; };
  const lastN = (r, k) => r.cells.slice(-k).map(c => c.x || 0);
  const sum = v => v.reduce((a, x) => a + x, 0);
  const turned = d.rows.filter(r => sum(lastN(r, 2)) >= 2 && sum(r.cells.slice(-6, -2).map(c => c.x || 0)) < -1).sort((x, y) => sum(lastN(y, 2)) - sum(lastN(x, 2))).slice(0, 3);
  const pill2 = (r, sub) => `<a href="#heat/${encodeURIComponent(r.name)}"><b>${esc(r.name)}</b><span>${sub}</span></a>`;
  const beat = r => `${r.m4 >= 0 ? 'beat' : 'lagged'} the market by ${n(Math.abs(r.m4), 1)}% in 4 weeks`;
  const all = st.rotAll, rows = all || d.rows.length <= 16 ? d.rows : [...d.rows.slice(0, 8), null, ...d.rows.slice(-8)];
  const view0 = st.rotView || 'board';
  // one verdict per sector, from how it did against the whole market week by week
  const verdict = r => {
    const xs = r.cells.map(c => c.x).filter(x => x != null), last = xs[xs.length - 1] || 0;
    let streak = 0; for (let i = xs.length - 1; i >= 0 && xs[i] !== 0 && (xs[i] > 0) === (last > 0); i--) streak++;
    const l2 = sum(lastN(r, 2)), prev4 = sum(r.cells.slice(-6, -2).map(c => c.x || 0)), beats5 = xs.slice(-5).filter(x => x > 0).length;
    const ahead = last > 0 ? 'Beat' : 'Lagged';
    let k, why;
    const p4 = xs.slice(-6, -2), behind4 = p4.filter(x => x < 0).length;
    if (l2 >= 2 && prev4 < -1) { k = 'turnup'; why = `Behind the market ${behind4} of the 4 weeks before, ahead over the last 2 weeks`; }
    else if (l2 <= -2 && prev4 > 1) { k = 'turndn'; why = `Ahead of the market ${p4.length - behind4} of the 4 weeks before, behind over the last 2 weeks`; }
    else if (r.m4 >= 2 && last > 0) { k = 'hot'; why = streak >= 2 ? `Beat the market ${streak} weeks in a row` : `Ahead by ${n(r.m4, 1)}% over 4 weeks, and ahead again this week`; }
    else if (r.m4 <= -2 && last < 0) { k = 'cold'; why = streak >= 2 ? `Lagged the market ${streak} weeks in a row` : `Behind by ${n(-r.m4, 1)}% over 4 weeks, and behind again this week`; }
    else { k = r.m4 >= 0 ? 'steadyup' : 'steadydn'; why = `${ahead} the market this week; ${r.m4 >= 0 ? 'ahead' : 'behind'} by ${n(Math.abs(r.m4), 1)}% over 4 weeks`; }
    return { ...r, k, why };
  };
  const SB = d.rows.map(verdict);
  const VK = { hot: ['Heating up', 'up', '▲'], turnup: ['Just turned up', 'up', '↗'], cold: ['Cooling off', 'dn', '▼'], turndn: ['Just turned down', 'dn', '↘'], steadyup: ['Ahead, no clear run', 'flat', '·'], steadydn: ['Behind, no clear run', 'flat', '·'] };
  const grp = k => SB.filter(r => r.k === k);
  const BMAX = (() => { const v = d.rows.flatMap(r => r.cells.slice(-8).map(c => Math.abs(c.x || 0))).sort((a, b) => a - b); return Math.max(0.5, v[Math.floor(v.length * 0.85)] || 1); })();     // a typical big week fills the bar; rarer outliers are capped
  const bars = r => { const xs = r.cells.slice(-8).map(c => c.x), W = 132, H = 40, bw = W / 8;
    return `<svg class="sb-bars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="${css('--line')}"/>${xs.map((x, i) => {
      if (x == null) return ''; const h = Math.max(2, Math.min(1, Math.abs(x) / BMAX) * (H / 2 - 1));
      return `<rect x="${i * bw + 2}" y="${x >= 0 ? H / 2 - h : H / 2}" width="${bw - 4}" height="${h}" rx="1.5" fill="${css(x >= 0 ? '--up' : '--dn')}"${i === xs.length - 1 ? ' opacity="0.6"' : ''}/>`; }).join('')}</svg>`; };
  const sbRow = r => { const v = VK[r.k];
    return `<a class="sb-r" href="#heat/${encodeURIComponent(r.name)}"><span class="sb-n">${esc(r.name)}</span><span class="sb-v"><b class="sb-tag s-${v[1]}">${v[2]} ${v[0]}</b><em>${esc(r.why)}</em></span>${bars(r)}<span class="sb-4 num ${cls(r.m4)}">${sg(r.m4, 1)}%</span></a>`; };
  const quiet = [...grp('steadyup'), ...grp('steadydn')];
  const board = `<div class="sb"><div class="sb-h"><span>Sector</span><span>What is happening</span><span>Last 8 weeks against the market</span><span class="r">4 weeks</span></div>
    ${['hot', 'turnup', 'cold', 'turndn'].map(k => grp(k).map(sbRow).join('')).join('')}
    ${quiet.length ? `<details class="sb-more"${st.rotQuiet ? ' open' : ''}><summary>${quiet.length} sectors with no clear run</summary>${quiet.map(sbRow).join('')}</details>` : ''}</div>`;
  const cell = (c, w, name) => c.x == null ? '<td class="ro-c"></td>' : `<td class="ro-c${c.t >= 1.3 ? ' hot' : ''}" style="${heat(c.x * 1.2)}" data-tip="${esc(tip(name, c, w))}">${sg(c.x, 1)}</td>`;
  const weeks = d.weeks.slice(from);
  const wkB = innerWidth < 700 ? 4 : 8;
  const blk = (c, up, w) => `<div class="bk ${up ? 'u' : 'd'}" data-sn="${esc(c.name)}" data-goto="heat/${encodeURIComponent(c.name)}" data-tip="${esc(tip(c.name, c, w))}" style="height:${Math.min(112, 36 + Math.abs(c.x) * 7.5)}px;${heat(c.x * 1.2)}"><span>${esc(c.name)}</span><b class="num">${sg(c.x, 1)}</b></div>`;
  const blocks = `<div class="bks" id="bks" style="grid-template-columns:repeat(${wkB},minmax(0,1fr))">${d.weeks.slice(-wkB).map((w, k) => {
    const i = d.weeks.length - wkB + k;
    const s = d.rows.map(r => ({ name: r.name, x: r.cells[i].x, r: r.cells[i].r })).filter(c => c.x != null).sort((a, b) => b.x - a.x);
    return `<div class="bk-c"><div class="bk-up">${s.slice(0, 5).filter(c => c.x > 0).reverse().map(c => blk(c, true, w)).join('')}</div><div class="bk-w${k === wkB - 1 ? ' now' : ''}">${k === wkB - 1 ? '<b>Latest week</b>' : '<b>Week</b>'}${range(w)}</div><div class="bk-dn">${s.slice(-5).filter(c => c.x < 0).reverse().map(c => blk(c, false, w)).join('')}</div></div>`;
  }).join('')}</div>`;
  view.innerHTML = `<section class="ro-top">
      <div class="ro-b up"><span class="k">Heating up</span>${grp('hot').slice(0, 3).map(r => pill2(r, beat(r))).join('') || '<p>No sector is on a clear run ahead of the market.</p>'}</div>
      <div class="ro-b dn"><span class="k">Cooling off</span>${grp('cold').slice(-3).reverse().map(r => pill2(r, beat(r))).join('') || '<p>No sector is on a clear run behind the market.</p>'}</div>
      <div class="ro-b tn"><span class="k">Just turned</span>${[...grp('turnup'), ...grp('turndn')].slice(0, 3).map(r => pill2(r, r.k === 'turnup' ? 'behind before, ahead now' : 'ahead before, behind now')).join('') || '<p>No sector has turned in the last two weeks.</p>'}</div></section>
    <section class="card"><h3>${{ board: 'Every sector, week by week', blocks: 'Sector blocks, week by week', table: 'Every week, every sector' }[view0]}<span class="seg ro-sw" id="ro-v">${[['board', 'Scoreboard'], ['blocks', 'Blocks'], ['table', 'Table']].map(([k, t]) => `<button class="${view0 === k ? 'on' : ''}" data-v="${k}">${t}</button>`).join('')}</span></h3>
    ${view0 === 'board' ? board : view0 === 'blocks' ? blocks : ''}<div class="tw"${view0 === 'table' ? '' : ' hidden'}><table class="ro"><thead><tr><th></th>${weeks.map(w => `<th>${range(w)}</th>`).join('')}<th class="ro-4">4 weeks</th></tr></thead><tbody>
    ${rows.map(r => r ? `<tr><td class="ro-n" data-goto="heat/${encodeURIComponent(r.name)}">${esc(r.name)}</td>${r.cells.slice(from).map((c, i) => cell(c, weeks[i], r.name)).join('')}<td class="ro-4 num ${cls(r.m4)}"><b>${sg(r.m4, 1)}</b></td></tr>` : `<tr><td class="ro-gap" colspan="${wk + 2}"></td></tr>`).join('')}</tbody></table></div>
    ${view0 === 'table' && d.rows.length > 16 ? `<button class="lf-more" id="ro-all">${all ? 'Show fewer' : `Show all ${d.rows.length} sectors`}</button>` : ''}
    <p class="note2">${view0 === 'board' ? 'Each bar is one week: green above the line when the sector beat the whole market, red below when it lagged. The last bar is the week in progress. Heating up means ahead of the market over 4 weeks and still ahead this week; cooling off is the reverse.' : view0 === 'table' ? 'Each number shows how far the sector beat or lagged the whole market that week, in %.' : 'The numbers show how far each sector beat or lagged the whole market that week, in %. The five strongest stack up and the five weakest hang below. Point at a block to follow that sector across the weeks.'} Tap a sector to see its stocks.</p></section>
    <p class="note2">Built from prices and traded value, weighted by company size. It estimates where activity moved. It is not actual money flow, because every share bought is also sold. What the data shows, not a recommendation.</p>`;
  const m = $('#ro-all'); if (m) m.onclick = () => { st.rotAll = !st.rotAll; render(true); };
  $('#ro-v').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { st.rotView = b.dataset.v; render(true); } };
  { const q = view.querySelector('.sb-more'); if (q) q.ontoggle = () => { st.rotQuiet = q.open; }; }
  const bx = $('#bks');
  if (bx) {
    const mark = n1 => { bx.classList.toggle('focus', !!n1); bx.querySelectorAll('.bk').forEach(x => x.classList.toggle('on', x.dataset.sn === n1)); };
    bx.onmouseover = e => { const k = e.target.closest('.bk'); mark(k ? k.dataset.sn : null); };
    bx.onmouseleave = () => mark(null);
  }
}
function stockFlowChart(rows, ref, hi) {
  const cv = $('#lf-cv'); if (!cv || !rows.length) return;
  const box = cv.parentElement, W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const L = 48, R = 118, T = 12, Bm = 22, w = W - L - R, h = H - T - Bm;
  const byChg = [...rows].sort((a, b) => b.chg - a.chg);
  const k5 = rows.length > 40 ? 5 : 3;
  const lead = new Set((rows.length <= 8 ? byChg : [...byChg.slice(0, k5), ...byChg.slice(-k5)]).map(r => r.sym));
  if (hi) lead.add(hi);
  const lines = [...rows.map(r => r.line), ref && ref.line].filter(Boolean);
  const all = lines.flat().filter(v => v != null);
  const lim = Math.max(1, Math.ceil(Math.max(...all.map(Math.abs)) * 2) / 2);
  const X = s => L + s / 74 * w, Y = v => T + (lim - v) / (2 * lim) * h;
  const up = css('--up'), dn = css('--dn');
  x.font = '11px Montserrat, system-ui, sans-serif'; x.fillStyle = css('--faint'); x.strokeStyle = css('--grid'); x.lineWidth = 1;
  [-lim, -lim / 2, 0, lim / 2, lim].forEach(g => { x.beginPath(); x.moveTo(L, Y(g)); x.lineTo(L + w, Y(g)); x.stroke(); x.textAlign = 'right'; x.fillText((g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g) + '%', L - 6, Y(g) + 4); });
  x.textAlign = 'center';
  [[0, '9:15'], [21, '11:00'], [45, '13:00'], [74, '15:30']].forEach(([s, t]) => x.fillText(t, Math.min(Math.max(X(s), L + 14), L + w - 14), H - 6));
  const draw = (p, col, a, lw, dash) => { x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = lw; x.setLineDash(dash || []); x.beginPath(); let on = false; p.forEach((v, i) => { if (v == null) return; if (on) x.lineTo(X(i), Y(v)); else x.moveTo(X(i), Y(v)); on = true; }); x.stroke(); x.setLineDash([]); x.globalAlpha = 1; };
  const end = p => { let k = p.length - 1; while (k > 0 && p[k] == null) k--; return p[k] == null ? null : k; };
  x.strokeStyle = css('--mut'); x.lineWidth = 1; x.beginPath(); x.moveTo(L, Y(0)); x.lineTo(L + w, Y(0)); x.stroke();
  const labels = [];
  if (ref && ref.line) { draw(ref.line, css('--mut'), 0.9, 1.4, [5, 4]); const k = end(ref.line); if (k != null) labels.push([Y(ref.line[k]), `Sector ${sg(ref.line[k], 1)}%`, css('--mut'), true]); }
  rows.forEach(r => { if (!lead.has(r.sym)) draw(r.line, r.chg >= 0 ? up : dn, hi ? 0.06 : rows.length > 40 ? 0.1 : 0.18, 1); });
  rows.filter(r => lead.has(r.sym)).forEach(r => {
    const col = r.chg >= 0 ? up : dn, on = !hi || r.sym === hi;
    draw(r.line, r.sym === hi ? css('--ink') : col, on ? 1 : 0.25, r.sym === hi ? 2.6 : 1.8);
    const k = end(r.line); if (k == null) return;
    x.fillStyle = col; x.globalAlpha = on ? 1 : 0.3; x.beginPath(); x.arc(X(k), Y(r.line[k]), 3, 0, 7); x.fill(); x.globalAlpha = 1;
    labels.push([Y(r.line[k]), `${r.sym} ${sg(r.chg, 1)}%`, col, on]);
  });
  labels.sort((a, b) => a[0] - b[0]);
  let lastY = -99; x.font = '600 11px Montserrat, system-ui, sans-serif'; x.textAlign = 'left';
  labels.forEach(([yy, t, col, on]) => { const y2 = Math.max(yy, lastY + 13); lastY = y2; x.globalAlpha = on ? 1 : 0.35; x.fillStyle = col; x.fillText(t, L + w + 8, y2 + 4); });
  x.globalAlpha = 1;
}
function heatSector(d, name) {
  const v = d.rows.filter(r => r.g === name).sort((a, b) => b.p - a.p);
  if (!v.length) { location.hash = 'heat'; return; }
  const up = v.filter(r => r.p > 0).length, avg = wAvg(v), all = st.secAll;
  const main = v.filter(r => r.c !== 'Micro'), hasMain = main.length >= 5, micro = v.length - main.length;
  const pool = hasMain && !st.secMicro ? main : v, show = all ? pool : pool.slice(0, 25);
  const big = [...v].sort((a, b) => b.m - a.m).slice(0, 5);
  const bigAvg = wAvg(big);
  $('#headline').textContent = `${name} ${sg(avg)}% today, ${up} of ${v.length} stocks up.`;
  const fromStock = /^#(stock|structure|fno)\/[^/]+$/.test(st.prevHash || '');     // arrived from a stock page: go back there, not to the heatmap
  view.innerHTML = `${fromStock ? `<a class="fn-back" href="${esc(st.prevHash)}">← Back to ${esc(decodeURIComponent(st.prevHash.split('/')[1]))}</a>` : '<a class="fn-back" href="#heat">← Back to the heatmap</a>'}
    <div class="sc-top"><div><span>Stocks up</span><b class="num">${up} of ${v.length}</b></div><div><span>Sector move, by size</span><b class="num ${cls(avg)}">${sg(avg)}%</b></div><div><span>Five largest</span><b class="num ${cls(bigAvg)}">${sg(bigAvg)}%</b></div></div>
    <section class="card"><div class="tw"><table><thead><tr><th>#</th><th>Stock</th><th>Size</th><th class="r">Price</th><th class="r">Today</th></tr></thead><tbody>
    ${show.map((r, i) => `<tr class="sc-r" data-stock="${esc(r.s)}"><td class="mut num">${i + 1}</td><td><b>${esc(r.s)}</b><small>${esc(r.n)}</small></td><td class="mut">${esc(r.c)}</td><td class="r num">${r.l == null ? '–' : px(r.l)}</td><td class="r num ${cls(r.p)}"><b>${sg(r.p)}%</b></td></tr>`).join('')}</tbody></table></div>
    <div class="sc-b">${pool.length > 25 ? `<button class="lf-more" id="sc-all">${all ? 'Show top 25' : `Show all ${pool.length}`}</button>` : ''}
    ${hasMain && micro ? `<button class="lf-more" id="sc-mic">${st.secMicro ? 'Hide micro caps' : `Include ${micro} micro caps`}</button>` : ''}</div></section>
    <p class="note2">Ranked by today&#39;s move. ${hasMain && !st.secMicro ? 'Micro caps are left out here because they are thinly traded and can jump on very little buying. ' : ''}What the data shows, not a recommendation.</p>`;
  const b = $('#sc-all'); if (b) b.onclick = () => { st.secAll = !st.secAll; render(true); };
  const mc = $('#sc-mic'); if (mc) mc.onclick = () => { st.secMicro = !st.secMicro; render(true); };
}
async function vHeat() {
  const d = await api('/api/heatmap');
  stamp(d.ts, d.open);
  if (st.heatSec) return heatSector(d, st.heatSec);
  const f = st.heatCap || 'lm';
  const keep = { lm: r => r.c === 'Large' || r.c === 'Mid', s: r => r.c === 'Small', all: () => true }[f];
  const rows = d.rows.filter(keep);
  const g = {};
  rows.forEach(r => { (g[r.g] = g[r.g] || []).push(r); });
  const secs = Object.entries(g).map(([name, v]) => {
    const up = v.filter(r => r.p > 0).length, sorted = [...v].sort((a, b) => b.p - a.p);
    return { name, rows: v, up, n: v.length, chg: wAvg(v), sorted, v: v.reduce((a, r) => a + Math.pow(Math.max(r.m, 1), 0.6), 0) };
  }).sort((a, b) => b.v - a.v);
  const byChg = [...secs].sort((a, b) => b.chg - a.chg);
  const upAll = rows.filter(r => r.p > 0).length;
  $('#headline').textContent = `${upAll} of ${rows.length} stocks shown are up. ${byChg[0].name} is strongest, ${byChg[byChg.length - 1].name} weakest.`;
  const tabs = [['lm', 'Large and mid caps'], ['s', 'Small caps'], ['all', `All ${n(d.rows.length)} stocks`]];
  view.innerHTML = `<div class="hm-ctl"><span class="hm-seg" id="hm-f">${tabs.map(([k, t]) => `<button class="${k === f ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</span>
      <span class="hm-key"><i style="${heat(-3)}">−3%</i><i style="${heat(-1)}">−1%</i><i style="${heat(0)}">0</i><i style="${heat(1)}">+1%</i><i style="${heat(3)}">+3%</i></span></div>
    <div class="hc">${byChg.map(s => {
      const big = [...s.rows].sort((x, y) => y.m - x.m).slice(0, 6);
      return `<section class="hc-c"><div class="hc-h" data-goto="heat/${encodeURIComponent(s.name)}" style="${heat(s.chg * 1.4)}"><b>${esc(s.name)}</b><span class="num">${sg(s.chg, 1)}%</span></div>
        <div class="hc-t">${big.map(r => `<button data-stock="${esc(r.s)}" data-tip="${esc(r.n)}" style="${heat(r.p)}"><b>${esc(r.s)}</b><span class="num">${sg(r.p, 1)}%</span></button>`).join('')}</div>
        <a class="hc-m" href="#heat/${encodeURIComponent(s.name)}">${s.up} of ${s.n} up${s.n > 6 ? ` · all ${s.n} →` : ' →'}</a></section>`;
    }).join('')}</div>
    <p class="note2">Strongest sector first. Each card shows its six largest companies. Sector numbers cover only the stocks chosen above, so they change between the tabs. Colour follows today&#39;s move. Sector moves are weighted by company size, like an index. What the data shows, not a recommendation.</p>`;
  $('#hm-f').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { st.heatCap = b.dataset.f; render(true); } };
}
async function sectorLine(sym, sel) {
  const host = view.querySelector(sel);
  if (!host || !sym) return;
  let s;
  try { s = await api('/api/sector?sym=' + encodeURIComponent(sym)); } catch (e) { return; }
  if (s.missing || !host.isConnected || view.querySelector('.sline')) return;
  const ord = i => { const v = i % 100; return i + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][i % 10] || 'th'); };
  host.insertAdjacentHTML('afterend', `<a class="sline" href="#heat/${encodeURIComponent(s.sector)}"><b>${esc(s.sector)} ${sg(s.chg)}%</b> ${s.open ? 'today' : 'at the last close'}, ${s.up} of ${s.n} stocks up. ${esc(sym)} ranks ${ord(s.pos)} of ${s.n}. <span>See the sector →</span></a>`);
}
/* ---------- one stock's F&O page: the verdict first, then the detail ---------- */
let fnTimer = null;
function lfGo(sym, e) {
  if (e && (e.ctrlKey || e.metaKey)) { window.open('#fno/' + sym, '_blank'); return; }
  location.hash = 'fno/' + sym;
}
function volProfile(cv, series, ch, pf, tries = 0) {
  // horizontal bars of volume at each price, drawn against the candle chart's own price scale
  if (!cv || !pf || !ch || !cv.isConnected) return;
  if (series.priceToCoordinate(pf.poc) == null) { if (tries < 25) setTimeout(() => volProfile(cv, series, ch, pf, tries + 1), 120); return; }     // the chart has not laid out its scale yet
  const box = cv.parentElement, W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, W, H);
  let right; try { right = ch.priceScale('right').width(); } catch (e) { right = 60; }
  const edge = W - right - 2, span = Math.min(160, (W - right) * 0.28);
  const mx = Math.max(...pf.rows.map(r => r[1]), 1);
  const half = Math.abs((series.priceToCoordinate(pf.rows[0][0]) ?? 0) - (series.priceToCoordinate(pf.rows[0][0] + pf.step) ?? 0)) / 2;
  const bh = Math.max(2, half * 2 - 2);
  pf.rows.forEach(([p, v]) => {
    const y = series.priceToCoordinate(p); if (y == null) return;
    const inVa = p >= pf.va[0] && p <= pf.va[1], poc = p === pf.poc;
    x.globalAlpha = poc ? 0.85 : inVa ? 0.5 : 0.25; x.fillStyle = poc ? css('--brand') : css('--mut');
    const w = v / mx * span; x.fillRect(edge - w, y - bh / 2, w, bh);
  });
  x.globalAlpha = 1;
}
function fnLine(pts, spot) {
  if (!pts || pts.length < 3) return '<div class="empty">Not enough data yet</div>';
  const W = 560, H = 160, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const X = v => 40 + (v - x0) / ((x1 - x0) || 1) * (W - 56), Y = v => 12 + (y1 - v) / ((y1 - y0) || 1) * (H - 36);
  const g = [0, 1, 2, 3].map(t => y0 + (y1 - y0) * t / 3).map(v => `<line x1="40" x2="${W - 16}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--line)"/><text x="34" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" style="font-size:10.5px;fill:var(--faint)">${v.toFixed(0)}%</text>`).join('');
  const s = spot != null ? `<line x1="${X(spot).toFixed(1)}" x2="${X(spot).toFixed(1)}" y1="10" y2="${H - 22}" style="stroke:var(--brand);stroke-dasharray:3 3"/>` : '';
  return `<svg class="fn-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="IV chart">${g}${s}<polyline points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" style="fill:none;stroke:var(--lu);stroke-width:2"/></svg>`;
}
async function vFno() {
  const sym = st.sym.fno || (st.sym.fno = 'NIFTY');
  const d = await api(`/api/fno?sym=${encodeURIComponent(sym)}${st.fnoExp && st.fnoExp[sym] ? '&exp=' + encodeURIComponent(st.fnoExp[sym]) : ''}`);
  const v = d.verdict, m = d.meter, S = d.spot, F = d.fut;
  const byK = {}; d.chain.forEach(x => { byK[x.k] = x; });
  const lad = d.chain.filter(x => Math.abs(x.k - F) <= 8 * d.step).sort((a, b) => b.k - a.k);
  const mo = Math.max(...lad.map(x => Math.max(x.c.oi, x.p.oi)), 1);
  let placed = false;
  const topC = Math.max(...lad.map(x => x.c.oi)), topP = Math.max(...lad.map(x => x.p.oi));
  const ladder = lad.map(x => {
    let h = '';
    if (!placed && x.k < S) { h = `<div class="fn-spot"><span>Now ${px(S)}</span></div>`; placed = true; }
    const inb = x.k >= S - d.move && x.k <= S + d.move;
    return h + `<div class="fn-lr${inb ? ' band' : ''}"><div class="l${x.p.oi === topP && topP ? ' top' : ''}">${x.p.oi === topP && topP ? '<u>Most puts</u>' : ''}<em class="num">${n(x.p.oi)}</em><i class="pe" style="width:${x.p.oi / mo * 100}%"></i></div><b class="num">${n(x.k)}</b><div class="r${x.c.oi === topC && topC ? ' top' : ''}"><i class="ce" style="width:${x.c.oi / mo * 100}%"></i><em class="num">${n(x.c.oi)}</em>${x.c.oi === topC && topC ? '<u>Most calls</u>' : ''}</div></div>`;
  }).join('');
  const all = st.fnoAll, gv = st.fnoGv === 'gv';
  const rows = d.chain.filter(x => all ? (x.c.oi || x.p.oi) : Math.abs(x.k - F) <= 5 * d.step);
  const dim = o => o.vol < 50 ? ' class="fn-thin"' : '';
  const a = (o, f, dp) => o[f] == null ? '–' : n(o[f], dp);
  const hiC = Math.max(...rows.map(x => x.c.oi)), hiP = Math.max(...rows.map(x => x.p.oi));
  const trs = rows.map(x => `<tr class="${x.k === d.atm ? 'atm' : ''}">
    ${gv ? `<td${dim(x.c)}>${a(x.c, 'v', 2)}</td><td${dim(x.c)}>${a(x.c, 'g', 4)}</td>` : `<td${dim(x.c)}>${a(x.c, 't', 2)}</td><td${dim(x.c)}>${a(x.c, 'd', 2)}</td>`}
    <td${dim(x.c)}>${a(x.c, 'iv', 1)}</td><td class="num${x.c.oi === hiC && hiC ? ' oi-c' : ''}">${compact(x.c.oi)}</td><td class="${cls(x.c.doi)}">${x.c.doi ? (x.c.doi > 0 ? '+' : '−') + compact(Math.abs(x.c.doi)) : '–'}</td><td><b>${n(x.c.ltp, 2)}</b></td>
    <th>${n(x.k)}</th>
    <td><b>${n(x.p.ltp, 2)}</b></td><td class="${cls(x.p.doi)}">${x.p.doi ? (x.p.doi > 0 ? '+' : '−') + compact(Math.abs(x.p.doi)) : '–'}</td><td class="num${x.p.oi === hiP && hiP ? ' oi-p' : ''}">${compact(x.p.oi)}</td><td${dim(x.p)}>${a(x.p, 'iv', 1)}</td>
    ${gv ? `<td${dim(x.p)}>${a(x.p, 'g', 4)}</td><td${dim(x.p)}>${a(x.p, 'v', 2)}</td>` : `<td${dim(x.p)}>${a(x.p, 'd', 2)}</td><td${dim(x.p)}>${a(x.p, 't', 2)}</td>`}</tr>`).join('');
  const g1 = gv ? 'Vega' : 'Theta', g2 = gv ? 'Gamma' : 'Delta';
  const maxT = Math.max(...d.term.map(t => t.iv || 0), 1);
  const t = d.today;
  view.innerHTML = `<div class="fn-top"><a class="fn-back" href="#livefo">← Back to Live F&amp;O</a>
      <form class="fn-pick" id="fn-pick"><a class="chip" href="#fno/NIFTY">NIFTY</a><a class="chip" href="#fno/BANKNIFTY">BANKNIFTY</a><input id="fn-q" list="sym-list" placeholder="Any F&amp;O stock" aria-label="Open an F&amp;O stock"></form></div>
    <section class="fn-head"><div><h2>${esc(sym)}</h2><span>${esc(d.sector || '')}${d.chg != null ? ` · <i class="num ${cls(d.chg)}">${sg(d.chg)}%</i> today` : ''}</span></div>
      <div class="fn-px"><b class="num">₹${n(S, 2)}</b><span>${d.fut_px ? `Futures ₹${n(d.fut_px, 2)} · ` : ''}${d.days} days to expiry</span></div>
      <span class="seg" id="fn-exp">${d.expiries.map(e => `<button class="${e === d.exp ? 'on' : ''}" data-e="${esc(e)}">${esc(e)}</button>`).join('')}</span></section>
    <section class="fn-v t-${v.tone}"><span class="k">What the options market is saying · ${esc(d.exp)} expiry</span><h2>${esc(v.head)}</h2>
      <ul>${v.lines.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="fn-chips">${v.chips.map(c => `<div><span>${esc(c.k)}</span><b>${esc(c.v)}</b><em>${esc(c.s)}</em></div>`).join('')}</div>
      ${v.change.length ? `<p class="fn-chg"><b>What would change this:</b> ${v.change.map(esc).join(' ')}</p>` : ''}</section>
    <div class="fn-two"><div class="fn-col">
      ${card('Are options cheap or expensive?', `<div class="fn-bar"><i style="left:${Math.min(Math.max(m.rank ?? 50, 2), 98)}%"></i></div><div class="fn-lb"><span>Cheap</span><span>Mid-range</span><span>Expensive</span></div>
        <p class="fn-mt">Today <b class="num">${m.iv ?? '–'}%</b>. Last ${m.n} sessions: ${m.lo != null ? `${m.lo.toFixed(0)}% to ${m.hi.toFixed(0)}%` : 'history building'}. Actual moves: <b class="num">${m.rv ?? '–'}%</b> a year.</p>`)}
      ${t && t.bars && t.bars.length ? card('Today', `<div class="fn-chw"><div class="chart fn-chart" id="fn-ch"></div><canvas id="fn-vp" class="fn-vp" aria-hidden="true"></canvas></div>${t.prof ? `<p class="fn-vpl">Most traded today at <b class="num">₹${px(t.prof.poc)}</b>. 70% of today's volume traded between <b class="num">₹${px(t.prof.va[0])}</b> and <b class="num">₹${px(t.prof.va[1])}</b>. VWAP <b class="num">₹${px(t.vwap)}</b>.</p>` : ''}<p class="note2">5 minute candles, dotted line is VWAP.${t.prof ? ' Bars on the right: volume traded at each price today, the darker band holds 70% of it.' : ''}${t.oi_hist && t.oi_hist.length > 1 ? ' Amber line: futures OI through the day.' : ''}</p>`, `prices to ${esc(t.last_bar || '')}`) : ''}</div>
      ${card('Where traders are positioned', `${ladder}<div class="fn-key"><span><i class="pe"></i>Put OI</span><span><i class="ce"></i>Call OI</span><span><i class="bd"></i>Priced range</span></div>`, 'open interest by strike')}</div>
    <details class="fn-more" id="fn-more"${st.fnoMore ? ' open' : ''}><summary>Option chain, Greeks and IV charts</summary>
    <section class="card"><h3>Option chain<small>${esc(d.exp)} · shaded row is at the money, red and green cells are the most calls and puts shown</small></h3>
      <div class="fn-ctl"><span class="seg" id="fn-gv"><button class="${gv ? '' : 'on'}" data-g="dt">Delta, Theta</button><button class="${gv ? 'on' : ''}" data-g="gv">Gamma, Vega</button></span>
        <span class="seg" id="fn-all"><button class="${all ? '' : 'on'}" data-a="0">Near the price</button><button class="${all ? 'on' : ''}" data-a="1">All strikes</button></span></div>
      <div class="tw"><table class="fn-t"><thead><tr><th class="grp" colspan="6">Calls</th><th></th><th class="grp" colspan="6">Puts</th></tr>
      <tr><th>${g1}</th><th>${g2}</th><th>IV</th><th>OI</th><th>OI chg</th><th>Price</th><th class="c">Strike</th><th>Price</th><th>OI chg</th><th>OI</th><th>IV</th><th>${g2}</th><th>${g1}</th></tr></thead><tbody>${trs}</tbody></table></div>
      <p class="note2">${gv ? 'Gamma: how fast delta changes when the price moves ₹1. Vega: the rupee change in the option for a 1 point change in IV.' : 'Delta: the rupee change in the option for a ₹1 move in the price. Theta: what it loses in a day from time passing.'} Grey: fewer than 50 contracts traded today, so treat with care.</p></section>
    <div class="grid g3">${card('IV across strikes', fnLine(d.smile, F), 'traded strikes')}${card(`IV, last ${d.hist.length} sessions`, fnLine(d.hist.map((h, i) => [i, h[1]])), 'at the money')}
      ${card('IV across expiries', d.term.length ? d.term.map(x => `<div class="fn-tr"><span class="num">${esc(x.exp)}</span><i style="width:${(x.iv || 0) / maxT * 100}%"></i><b class="num">${x.iv ?? '–'}%</b></div>`).join('') : '<div class="empty">Not available</div>')}</div></details>
    <p class="note2">IV and Greeks are calculated by 72 Street from option and futures prices, assuming a 6.5% rate, so they can differ slightly from a broker’s. "Stands out" compares this name with all F&amp;O stocks. The verdict describes what option prices and positions show. It is not a recommendation to buy or sell.</p>`;
  $('#fn-more').ontoggle = e => { st.fnoMore = e.target.open; };
  $('#fn-pick').onsubmit = e => { e.preventDefault(); const s = $('#fn-q').value.trim().toUpperCase(); if (s) lfGo(s); };
  $('#fn-exp').onclick = e => { const b = e.target.closest('[data-e]'); if (b) { st.fnoExp = { ...(st.fnoExp || {}), [sym]: b.dataset.e }; render(); } };
  $('#fn-gv').onclick = e => { const b = e.target.closest('[data-g]'); if (b) { st.fnoGv = b.dataset.g; render(true); } };
  $('#fn-all').onclick = e => { const b = e.target.closest('[data-a]'); if (b) { st.fnoAll = b.dataset.a === '1'; render(true); } };
  if (t && t.bars && t.bars.length && window.LightweightCharts) {
    const [y, mo2, dd] = t.session.split('-').map(Number), t0 = Date.UTC(y, mo2 - 1, dd, 9, 15) / 1000;
    chart = LightweightCharts.createChart($('#fn-ch'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Montserrat, system-ui, 'Segoe UI', sans-serif" },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: true, rightOffset: t.prof ? 18 : 4 }, crosshair: { mode: 0 }, handleScroll: false, handleScale: false });
    const cs = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
    cs.setData(t.bars.map(b => ({ time: t0 + b[0] * 300, open: b[1], high: b[2], low: b[3], close: b[4] })));
    const vw = chart.addLineSeries({ color: css('--sc'), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    vw.setData(t.bars.filter(b => b[5] != null).map(b => ({ time: t0 + b[0] * 300, value: b[5] })));
    cs.createPriceLine({ price: t.prev, color: css('--faint'), lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Prev close' });
    if (t.prof) { const drawVP = () => volProfile($('#fn-vp'), cs, chart, t.prof); requestAnimationFrame(() => requestAnimationFrame(drawVP));
      const ro = new ResizeObserver(() => { if (!$('#fn-vp')) { ro.disconnect(); return; } drawVP(); }); ro.observe($('#fn-ch')); }
    if (t.oi_hist && t.oi_hist.length > 1) {
      chart.applyOptions({ leftPriceScale: { visible: true, borderColor: css('--line') } });
      const oi = chart.addLineSeries({ priceScaleId: 'left', color: css('--lu'), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'OI', priceFormat: { type: 'custom', formatter: x => compact(x) } });
      oi.setData(t.oi_hist.map(h => ({ time: t0 + (h[0] - 555) * 60, value: h[1] })));
    }
    chart.timeScale().fitContent();
  }
  clearInterval(fnTimer);
  fnTimer = setInterval(() => { if (st.tab !== 'fno') { clearInterval(fnTimer); return; } if (document.visibilityState === 'visible' && d.open_mkt) render(true); }, 120000);
}
function fnoTest(c) {
  if (!c) return '';
  if ((c.sessions || 0) < 20) return card(`Options verdicts: too early to judge`, `<p class="how">Every evening the options verdict for each F&amp;O stock is logged and later checked against what prices did. ${c.sessions || 0} of 20 sessions logged so far${c.started ? ` since ${fmtD(c.started)}` : ''}. Results appear here once there are enough.</p>`, 'checked against what prices did next');
  const lab = { up: ['Put heavy', 'beats Nifty'], flat: ['Balanced', 'sits in between'], dn: ['Call heavy', 'lags Nifty'] };
  const enough = x => x.n >= 30 && (c.sessions || 0) >= 20;     // the same bar as the Stocks in focus record: a handful proves nothing
  const cell = (h, b) => { const x = ((c.h || {})[h] || {})[b]; return x && !enough(x) ? `<td class="r mut">too early<br><span style="font-size:12px">${n(x.n)} checked</span></td>` : x ? `<td class="r"><span class="num ${cls(x.avg)}">${sg(x.avg, 1)}%</span><br><span class="mut" style="font-size:12px">${x.beat}% beat Nifty · ${n(x.n)}</span></td>` : '<td class="r mut">pending</td>'; };
  return card('Options verdicts, checked against what prices did', `<p class="how">Every evening the options verdict for each F&amp;O stock is written down with its closing price. Later we check how each reading did against Nifty. ${c.started ? `Logging since ${fmtD(c.started)}, ${c.sessions} session${c.sessions === 1 ? '' : 's'} so far.` : 'Logging starts with the next closed session.'}</p>
    <div class="tw"><table class="trtab"><thead><tr><th>Positioning</th><th>If the reading is useful</th><th class="r">5 sessions later</th><th class="r">20 sessions later</th></tr></thead><tbody>
    ${Object.keys(lab).map(b => `<tr><td><b>${lab[b][0]}</b></td><td class="mut">${lab[b][1]}</td>${cell(5, b)}${cell(20, b)}</tr>`).join('')}</tbody></table></div>`, 'checked against what prices did next');
}

function readCard(items) {
  if (st.tab === 'stock') items = items.filter(i => !/quarter:/i.test(i.title));
  if (['flow', 'screens', 'oiflow', 'liquidity', 'expiry'].includes(st.tab)) return '';   // these explain themselves; the options reading lives on Option Pulse
  items = items.slice(0, 3);
  if (!items.length) return '';
  return `<details class="card read rd-c" aria-label="What this means"${st.readOpen ? ' open' : ''}><summary><span class="rd-k">What this means</span>${items.map(i => `<span class="rd-t t-${i.tone}">${esc(i.title)}</span>`).join('')}<span class="rd-more">why</span></summary>
    <div class="reads">${items.map(i => `<div class="ri t-${i.tone}"><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>`).join('')}</div></details>`;     // the footer already carries the disclaimer
}
const VIEWS = { feed: vFeed, login: vLogin, terminal: vTerminal, screener: vScreener, journal: vJournal, today: vToday, mine: vMine, track: vTrack, stock: vStock, compare: vCompare, pulse: vPulse, results: vResults, expiry: vExpiry, flow: vFlow, options: vOptions, oiflow: vOIFlow, liquidity: vLiquidity, radar: vRadar, calm: vCalm, global: vGlobal, screens: vScreens, learn: vLearn, livefo: vLiveFO, fno: vFno, heat: vHeat, rotation: vRotation, structure: vStructure };
const SYMTABS = ['options', 'oiflow', 'liquidity', 'radar', 'expiry', 'structure'];

function stamp(ts, open) {
  if (ts) $('#stamp').textContent = 'Data ' + ts;
  const l = $('#live');
  if (open === true) { l.className = 'live on'; l.title = 'Live, delayed'; $('#live-t').textContent = 'Live · delayed'; }
  else if (open === false) { l.className = 'live closed'; l.title = 'Market closed, showing the last session'; $('#live-t').textContent = 'Market closed · last session'; }
}

const ADV = ['options', 'oiflow', 'liquidity', 'expiry', 'calm'];
const GROUPS = { heat: [['heat', 'Heatmap'], ['rotation', 'Sector Rotation']], mine: [['mine', 'Watchlist'], ['feed', 'My Feed']], options: [['livefo', 'Live F&amp;O'], ['fno', 'Stock or Index'], ['options', 'Option Pulse'], ['oiflow', 'OI Flow'], ['liquidity', 'Liquidity Map'], ['expiry', 'Expiry Tracker'], ['calm', 'Calm Zone']],
  learn: [['learn', 'Learn'], ['journal', 'Trading journal']],
  stock: [['stock', 'Find a stock'], ['screener', 'Screener'], ['compare', 'Compare'], ['structure', 'Price Structure']],
  markets: [['pulse', 'Market Pulse'], ['flow', 'Money Flow'], ['results', 'Results Calendar'], ['global', 'Global & Crypto'], ['screens', '52 Week Highs and Lows']] };
const groupOf = t => t === 'compare' || t === 'screener' || t === 'structure' ? 'stock' : t === 'fno' ? 'options' : (Object.keys(GROUPS).find(g => GROUPS[g].some(([k]) => k === t)) || t);
function navs(tab) {
  const g = groupOf(tab);
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.group === g));
  const sub = $('#subtabs');
  if (GROUPS[g]) {
    const showAdv = st.adv || ADV.includes(tab);
    sub.hidden = false;
    sub.innerHTML = GROUPS[g].filter(([k]) => showAdv || !ADV.includes(k)).map(([k, t]) => `<a href="#${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')
      + (GROUPS[g].some(([k]) => ADV.includes(k)) ? `<a href="#" id="adv-t" class="adv-t">${showAdv ? 'Hide advanced' : 'Advanced'}</a>` : '');
  }
  else sub.hidden = true;
  $('#headrow').hidden = ['today', 'stock', 'mine', 'compare', 'fno', 'terminal', 'login'].includes(tab);
  $('#explain-btn').hidden = !EXPLAIN[tab];
}
const TITLES = { feed: 'My Feed', login: 'Your account', terminal: 'Terminal', today: 'Today', stock: 'Find any stock', compare: 'Compare stocks', livefo: 'Live F&O', fno: 'Stock or Index F&O', options: 'Option Pulse', oiflow: 'OI Flow', liquidity: 'Liquidity Map', expiry: 'Expiry Tracker', calm: 'Calm Zone', heat: 'Sector Heatmap', rotation: 'Sector Rotation', pulse: 'Market Pulse', flow: 'FII DII Money Flow', results: 'Results Calendar', global: 'Global Markets', screens: '52 Week Highs and Lows', mine: 'Watchlist', track: 'Track record', learn: 'Learn', journal: 'Free trading journal', screener: 'Stock screener', structure: 'Price Structure' };
function setTitle(t) { document.title = `${t} | 72 Street Market Desk`; }
async function render(silent = false) {
  const id = ++renderId, tab = st.tab;
  setTitle(TITLES[tab] || 'Market Desk');
  navs(tab);
  if (!SYMTABS.includes(tab)) $('#symbar').hidden = true;
  setExplain(tab);
  if (chart) { chart.remove(); chart = null; }
  if (!silent) view.innerHTML = skel(3);
  st.read = null;
  try { await VIEWS[tab]();
    if (id === renderId && st.read && st.read.length) { const slot = view.querySelector('#read-slot'); if (slot) slot.outerHTML = readCard(st.read); else view.insertAdjacentHTML('afterbegin', readCard(st.read));
      const rc = view.querySelector('.rd-c'); if (rc) rc.ontoggle = () => { st.readOpen = rc.open; }; }
    if (id === renderId && window.fxAfter) { try { fxAfter(tab, silent); } catch (e) {} }
    if (id === renderId) { decorate(); if (tab === 'stock') { sectorLine(st.sym.stock, '.shead'); if (view.querySelector('.shead')) addRecent(st.sym.stock); } if (tab === 'fno') { sectorLine(st.sym.fno, '.fn-head'); if (!['NIFTY', 'BANKNIFTY'].includes(st.sym.fno) && view.querySelector('.fn-head')) addRecent(st.sym.fno); } } }
  catch (e) { if (id === renderId) view.innerHTML = `<div class="err">${/do not have|now trades as/.test(e.message) ? esc(e.message) : `Could not load this view: ${esc(e.message)}. It retries every minute.`}</div>`; }
}
function route() {
  if (location.hash.startsWith('#radar')) location.replace('#stock');
  if (location.hash.startsWith('#terminal')) location.replace('#feed');     // the Terminal page is retired; My Feed and Watchlist cover it
  if (location.hash !== st.curHash) { st.prevHash = st.curHash; st.curHash = location.hash; }     // where the visitor came from, for back links
  const [t, arg] = (location.hash || '#today').slice(1).split('/');
  if (t === 'fno' && arg) st.sym.fno = decodeURIComponent(arg).toUpperCase();
  if (t === 'heat') st.heatSec = arg ? decodeURIComponent(arg) : null;
  if (t === 'stock') st.stockHome = !arg;
  if (t === 'mine' && arg) st.wlImport = decodeURIComponent(arg).toUpperCase().split(',').map(x => x.trim()).filter(x => /^[A-Z0-9&-]{1,20}$/.test(x)).slice(0, 50);
  if (arg && (t === 'stock' || SYMTABS.includes(t))) { const v = decodeURIComponent(arg).toUpperCase(); if (st.sym[t] !== v) st.exp[t] = null; st.sym[t] = v; }
  st.tab = VIEWS[t] ? t : 'today';
  $('#explain').hidden = true;
  const y = (history.state || {}).y;               // set only on a page already visited, so this is Back or Forward
  st.routing = true;
  render().then(() => { window.scrollTo(0, y || 0); setTimeout(() => { st.routing = false; }, 300); });
}
{ const keep = () => { if (!st.routing) { try { history.replaceState({ y: window.scrollY }, ''); } catch (e) {} } };
  let t; window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(keep, 120); }, { passive: true });
  document.addEventListener('click', keep, true); }      // saved before the click moves us away
try { const qp = new URLSearchParams(location.search); const q0 = qp.get('s'); if (q0) { st.sym.stock = q0.toUpperCase(); if (/^#stock\/?$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#stock/' + encodeURIComponent(q0.toUpperCase())); } const w0 = qp.get('w'); if (w0) setWatch(w0.toUpperCase().split(',').filter(Boolean).slice(0, 30)); const c0 = qp.get('c'); if (c0 && c0.includes(',')) st.cmp = c0.toUpperCase().split(',').slice(0, 2); } catch (e) {}
window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const gt = e.target.closest('[data-goto]'); if (gt) { location.hash = gt.dataset.goto; return; }
  if (e.target.id === 'adv-t') { e.preventDefault(); st.adv = !(st.adv || ADV.includes(st.tab)); navs(st.tab); return; }
  const k = e.target.closest('[data-stock]'); if (k) { e.preventDefault(); openStock(k.dataset.stock); return; }
  const s = e.target.closest('[data-go]'); if (!s) return; e.preventDefault();
  goTab(s.dataset.go, s.dataset.sym);
});
const tip = $('#tip');
document.addEventListener('mousemove', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip; tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = e.clientY + 16 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});

setInterval(() => { if (document.visibilityState === 'visible' && !['learn', 'stock', 'mine', 'livefo', 'fno', 'terminal'].includes(st.tab) && !(document.activeElement && document.activeElement.id === 'sq')) render(true); }, 60000);
api('/api/status').then(s => stamp(null, s.market_open)).catch(() => {});
api('/api/symbols').then(d => { st.symbols = d.symbols; $('#sym-list').innerHTML = d.symbols.map(s => `<option value="${s}">`).join(''); }).catch(() => {});
acctBoot().catch(() => {});
route();


/* ---------- quick search: / or Ctrl+K from any page ---------- */
const qs = { list: null, sel: 0, hits: [], ask: null, scr: null };

/* Ask 72 Street: plain English turned into a filter, a comparison, a sector or a stock. No model, just careful matching. */
const ASK_SECTORS = [['it services', 'IT Services'], ['software', 'IT Services'], [' it ', 'IT Services'], ['psu bank', 'PSU Banks'], ['private bank', 'Private Banks'], ['bank', 'Private Banks'],
  ['pharma', 'Pharma'], ['hospital', 'Hospitals'], ['healthcare', 'Hospitals'], ['auto component', 'Auto Components'], ['auto ancillar', 'Auto Components'], ['auto', 'Autos'],
  ['metal', 'Metals & Mining'], ['mining', 'Metals & Mining'], ['steel', 'Metals & Mining'], ['fmcg', 'FMCG'], ['consumer durable', 'Consumer Durables'], ['realty', 'Real Estate'], ['real estate', 'Real Estate'],
  ['power', 'Power'], ['renewable', 'Renewables'], ['solar', 'Renewables'], ['defence', 'Defence'], ['defense', 'Defence'], ['oil', 'Oil & Gas'], ['gas', 'Oil & Gas'], ['telecom', 'Telecom'],
  ['cement', 'Cement & Building'], ['chemical', 'Chemicals'], ['infra', 'Infrastructure'], ['insurance', 'Insurance'], ['nbfc', 'NBFC & Housing Finance'], ['housing finance', 'NBFC & Housing Finance'],
  ['capital market', 'Capital Markets'], ['broker', 'Capital Markets'], ['capital good', 'Capital Goods'], ['electrical', 'Electricals'], ['electronic', 'Electronics'], ['retail', 'Retail'],
  ['internet', 'Internet'], ['textile', 'Textiles'], ['travel', 'Travel'], ['airline', 'Travel'], ['hotel', 'Travel'], ['logistic', 'Logistics'], ['media', 'Media'], ['paper', 'Paper & Packaging'], ['packaging', 'Paper & Packaging']];
function askFind(word) {
  const w = word.trim().toUpperCase(); if (w.length < 2) return null;
  const all = qs.list || [];
  return (all.find(x => x.s === w) || all.find(x => (x.was || []).some(v => v.toUpperCase() === w)) || all.find(x => (x.n || '').toUpperCase().startsWith(w + ' ')) || {}).s || null;
}
function askParse(raw) {
  const t = ' ' + raw.toLowerCase().replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ') + ' ';
  if (raw.trim().split(/\s+/).length < 2) return null;                  // one word is a plain stock search
  const cmp = t.match(/^\s*(?:compare\s+)?(.+?)\s+(?:vs|versus|or|and|against)\s+(.+?)\s*$/);
  if (cmp && !/stock|share|compan/.test(t)) { const a = askFind(cmp[1]), b = askFind(cmp[2]); if (a && b && a !== b) return { kind: 'compare', a, b, chips: [`Compare ${a} and ${b}`] }; }
  const why = t.match(/\bwhy\b.*?\b(?:is|did|has|are)?\s*([a-z0-9&-]+)\s+(?:stock\s+|share\s+)?(?:down|up|fall|falling|fell|rise|rising|rose|moving|crash|jump)/) || t.match(/\bwhy\b\s+([a-z0-9&-]+)/);
  if (why) { const s = askFind(why[1]); if (s) return { kind: 'why', sym: s, chips: [`${s}`, 'latest filings, results and moves'] }; }
  const f = {}, chips = [];
  const sec = ASK_SECTORS.find(([k]) => t.includes(k.startsWith(' ') ? k : ' ' + k) || t.includes(k));
  if (sec) { f.g = sec[1]; chips.push(sec[1]); }
  const caps = ['large', 'mid', 'small'].filter(c => t.includes(c + ' cap') || t.includes(c + 'cap') || t.includes(c + '-cap'));
  if (caps.length) { f.cap = caps.map(c => c[0].toUpperCase() + c.slice(1)); chips.push(caps.map(c => c + ' cap').join(', ')); }
  if (/52 ?w(ee)?k high|near (the |its )?high|new high|all ?time high|breakout|breaking out/.test(t)) { f.near = 'hi'; chips.push('near 52 week high'); }
  else if (/52 ?w(ee)?k low|near (the |its )?low|new low|beaten down/.test(t)) { f.near = 'lo'; chips.push('near 52 week low'); }
  if (/uptrend|trending up|rising|strong trend|going up|momentum/.test(t)) { f.trend = 'up'; chips.push('uptrend'); }
  else if (/downtrend|trending down|falling|going down|weak trend/.test(t)) { f.trend = 'dn'; chips.push('downtrend'); }
  else if (/sideways|range ?bound|flat/.test(t)) { f.trend = 'flat'; chips.push('sideways'); }
  if (/debt ?free|zero debt|no debt/.test(t)) { f.debt = 'none'; chips.push('almost no debt'); }
  else if (/low debt|less debt|little debt/.test(t)) { f.debt = 'low'; chips.push('low debt'); }
  else if (/high debt|heavy debt|lot of debt|indebted/.test(t)) { f.debt = 'high'; chips.push('high debt'); }
  if (/cheap|undervalued|low p\/?e|value|discount/.test(t)) { f.val = 'cheap'; chips.push('cheaper than its sector'); }
  else if (/expensive|overvalued|rich|premium|high p\/?e/.test(t)) { f.val = 'rich'; chips.push('richer than its sector'); }
  if (/quality|high roce|good roce|high return|efficient|compounder/.test(t)) { f.roce = '15'; chips.push('return on capital 15%+'); }
  if (/result|earnings|reported|quarter/.test(t)) { f.res = true; chips.push('results out this week'); }
  if (!chips.length) return null;
  if (f.g && chips.length === 1 && !/stock|share|compan|list|show|find/.test(t)) return { kind: 'sector', g: f.g, f, chips: [f.g] };
  return { kind: 'screen', f, chips };
}
function askCount(f) {
  if (!qs.scr) return null;
  const F = { ...SCR_DEF, ...f };
  return qs.scr.rows.filter(r => (F.cap.includes(r.c) || (F.micro && r.c === 'Micro')) && (!F.g || r.g === F.g)
    && (F.val !== 'cheap' || (r.pe && r.spe && r.pe < r.spe * .85)) && (F.val !== 'rich' || (r.pe && r.spe && r.pe > r.spe * 1.15))
    && (F.debt !== 'low' || (!r.bank && r.de != null && r.de <= .5)) && (F.debt !== 'none' || (!r.bank && r.de != null && r.de <= .1)) && (F.debt !== 'high' || (!r.bank && r.de != null && r.de >= 1))
    && (!F.trend || r.t === F.trend) && (F.near !== 'hi' || (r.hi != null && r.hi >= -5)) && (F.near !== 'lo' || (r.lo != null && r.lo <= 5))
    && (!F.roce || (r.roce != null && r.roce >= +F.roce)) && (!F.res || r.res)).length;
}
function askGo(a) {
  qsClose();
  if (a.kind === 'compare') { st.cmp = [a.a, a.b]; location.hash = 'compare'; }
  else if (a.kind === 'why') { location.hash = 'stock/' + encodeURIComponent(a.sym); setTimeout(() => { const s = $('#filings-slot') || [...document.querySelectorAll('.card h3')].find(h => /told the exchange/.test(h.textContent)); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 2500); }
  else if (a.kind === 'sector') { location.hash = 'heat/' + encodeURIComponent(a.g); }
  else { st.scr = { ...JSON.parse(JSON.stringify(SCR_DEF)), ...a.f }; st.scrAll = false; if (location.hash === '#screener') render(); else location.hash = 'screener'; }
}
function askRow(a) {
  const n_ = a.kind === 'screen' || a.kind === 'sector' ? askCount(a.f) : null;
  const what = { compare: 'Open the comparison', why: 'Open the stock with its latest filings', sector: `Open the ${esc(a.g)} sector`, screen: n_ == null ? 'Show matching stocks' : `Show ${n(n_)} matching stocks` }[a.kind];
  return `<div class="qs-ask${qs.sel === -1 ? ' on' : ''}" data-ask="1"><span class="qs-ai">✦ Understood as</span><div class="qs-chips">${a.chips.map(c => `<i>${esc(c)}</i>`).join('')}</div><b>${what} →</b></div>`;
}
let askTimer = 0;
function qsRender(q) {
  const box = $('#qs-list'); if (!box) return;
  const t = q.trim().toUpperCase();
  const ask = q.trim() ? askParse(q) : null;
  qs.ask = ask;
  const fno = new Set(st.symbols || []);
  if (!t) {
    qs.hits = getRecent().map(s => ({ s, n: ((qs.list || []).find(x => x.s === s) || {}).n || '' }));
  } else {
    const all = qs.list || [];
    qs.hits = [...all.filter(x => x.s.startsWith(t)), ...all.filter(x => !x.s.startsWith(t) && ((x.n || '').toUpperCase().includes(t) || (x.was || []).some(w => w.toUpperCase().includes(t))))].slice(0, 8);
  }
  if (ask && qs.hits.length > 3) qs.hits = qs.hits.slice(0, 3);
  const tl = q.trim().toLowerCase();
  qs.pages = tl.length >= 2 ? Object.entries(TITLES).filter(([k, ttl]) => ttl.toLowerCase().replace(/&amp;/g, '&').includes(tl) || k.startsWith(tl)).slice(0, 4) : [];
  const pagesHtml = qs.pages.length ? `<div class="qs-k">Go to</div>${qs.pages.map(([k, ttl]) => `<div class="qs-r qs-pg" data-page="${k}"><b>${ttl}</b><span>page</span></div>`).join('')}` : '';
  qs.sel = ask ? Math.max(-1, Math.min(qs.sel, qs.hits.length - 1)) : Math.min(Math.max(qs.sel, 0), Math.max(qs.hits.length - 1, 0));
  const head = ask ? askRow(ask) : '';
  if (ask) { clearTimeout(askTimer); const inp = $('#qs-in'); if (inp) { inp.parentElement.classList.add('thinking'); askTimer = setTimeout(() => inp.parentElement && inp.parentElement.classList.remove('thinking'), 450); } }
  if (ask && !qs.scr && (ask.kind === 'screen' || ask.kind === 'sector')) api('/api/screener').then(d => { qs.scr = d; if ($('#qs-in')) qsRender($('#qs-in').value); }).catch(() => {});
  box.innerHTML = pagesHtml + head + (qs.hits.length ? `${t ? '' : '<div class="qs-k">Recent</div>'}${qs.hits.map((x, i) => `<div class="qs-r${i === qs.sel ? ' on' : ''}" data-i="${i}"><b>${esc(x.s)}</b><span>${esc(x.n)}</span>${fno.has(x.s) ? `<a href="#fno/${encodeURIComponent(x.s)}" data-f="1">F&amp;O</a>` : ''}</div>`).join('')}`
    : (ask ? '' : `<div class="qs-k">${t ? 'No match. Try a question like “low debt pharma near 52 week high”.' : 'Type a name or symbol'}</div>`));
}
function qsClose() { const o = $('#qs'); if (o) o.remove(); }
async function qsOpen() {
  if ($('#qs')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="qs" id="qs"><div class="qs-box" role="dialog" aria-label="Ask 72 Street"><div class="qs-inw"><span class="qs-orb" aria-hidden="true"></span><input id="qs-in" placeholder="Ask 72 Street: a stock, or “low debt IT near 52 week high”" autocomplete="off" spellcheck="false"></div><div id="qs-list"></div><p class="qs-h">Try “pharma near 52 week high” · “reliance vs ongc” · “why is suzlon down” · Enter to open · Esc to close</p></div></div>`);
  const inp = $('#qs-in'), o = $('#qs');
  inp.focus();
  o.onclick = e => {
    if (e.target === o) return qsClose();
    if (e.target.closest('[data-f]')) return qsClose();
    if (e.target.closest('[data-ask]') && qs.ask) return askGo(qs.ask);
    const pg = e.target.closest('[data-page]'); if (pg) { qsClose(); location.hash = pg.dataset.page; return; }
    const r = e.target.closest('[data-i]');
    if (r) { qsClose(); openStock(qs.hits[Number(r.dataset.i)].s); }
  };
  inp.oninput = () => { qs.sel = -1; qsRender(inp.value); };
  inp.onkeydown = e => {
    if (e.key === 'Escape') return qsClose();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const lo = qs.ask ? -1 : 0, span = qs.hits.length - lo; qs.sel = ((qs.sel - lo + (e.key === 'ArrowDown' ? 1 : -1) + span) % (span || 1)) + lo; qsRender(inp.value); }
    if (e.key === 'Enter') { if (!qs.hits.length && qs.pages && qs.pages.length) { qsClose(); location.hash = qs.pages[0][0]; return; } if (qs.ask && qs.sel === -1) return askGo(qs.ask); if (qs.hits[qs.sel]) { const s = qs.hits[qs.sel].s; qsClose(); openStock(s); } }
  };
  qsRender('');
  if (!qs.list) { try { qs.list = (await api('/api/search')).items; if ($('#qs-in')) qsRender($('#qs-in').value); } catch (e) {} }
}
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); qsOpen(); }
});
{ const b = $('#qs-btn'); if (b) b.onclick = qsOpen; }

/* ---------- theme: light, dark, black ---------- */
function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function paintThemeSw() {
  const t = currentTheme();
  document.querySelectorAll('#themesw [data-th]').forEach(b => b.classList.toggle('on', b.dataset.th === t));
}
document.addEventListener('click', e => {
  const b = e.target.closest('#themesw [data-th]'); if (!b) return;
  document.documentElement.setAttribute('data-theme', b.dataset.th);
  try { localStorage.setItem('72s-theme', b.dataset.th); } catch (e2) {}
  paintThemeSw(); render(true);
});
paintThemeSw();

/* ---------- key levels: every price level the page knows, nearest first, around today's price ---------- */
function keyLevels(d, o) {
  const S = d.structure || {}, p = d.price || {}, last = p.last || S.last;
  if (!last) return '';
  const L = [];
  if (o && o.ceiling) L.push(['Option ceiling', o.ceiling, 'most call open interest']);
  if (o && o.floor) L.push(['Option floor', o.floor, 'most put open interest']);
  if (S.last_high) L.push(['Last swing high', S.last_high.p, fmtT(S.last_high.t)]);
  if (S.last_low) L.push(['Last swing low', S.last_low.p, fmtT(S.last_low.t)]);
  const bl = S.blocks || [];
  const ab = bl.filter(b => b.bot > last).sort((a, b) => a.bot - b.bot)[0], be = bl.filter(b => b.top < last).sort((a, b) => b.top - a.top)[0];
  const inside = bl.find(b => last >= b.bot && last <= b.top);
  if (ab) L.push(['Order block above', ab.bot, `₹${px(ab.bot)} to ₹${px(ab.top)}`]);
  if (be) L.push(['Order block below', be.top, `₹${px(be.bot)} to ₹${px(be.top)}`]);
  if (p.hi52) L.push(['52 week high', p.hi52, '']);
  if (p.lo52) L.push(['52 week low', p.lo52, '']);
  const above = L.filter(x => x[1] > last).sort((a, b) => a[1] - b[1]).slice(0, 3).reverse(), below = L.filter(x => x[1] <= last).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!above.length && !below.length) return '';
  const row = ([k, v, note]) => `<div class="kl-r"><span>${k}${note ? `<em>${esc(note)}</em>` : ''}</span><b class="num">₹${px(v)}</b><i class="num ${v > last ? 'up' : 'dn'}">${sg((v / last - 1) * 100, 1)}%</i></div>`;
  return `<section class="card kl"><h3>Key levels<small>nearest above and below today's price · not entries, stops or targets</small></h3>
    <div class="kl-list">${above.map(row).join('')}<div class="kl-now"><span>Now${inside ? ' · inside an order block' : ''}</span><b class="num">₹${px(last)}</b></div>${below.map(row).join('')}</div></section>`;
}

/* ---------- price structure (structure.py) ---------- */
const SKIND = { BoS: 'Break of structure', CHoCH: 'Change of character', Break: 'Break', Sweep: 'Liquidity sweep', OB: 'Order block retest', DaySweep: 'Previous-day sweep' };
const SMARK = { BoS: 'BoS', CHoCH: 'CHoCH', Break: 'B', Sweep: 'S', OB: 'OB' };
var sIntra = false;     // a 5-minute structure view: event times need the clock time, not just the day
const fmtT = t => !t ? '' : sIntra ? new Date(t * 1000).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
  : new Date(t * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
// how long ago a daily-candle date was, so an old event never reads as a recent one
const sAgo = t => { if (!t || sIntra) return ''; const d = Math.floor((Date.now() / 1000 - t) / 86400);
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : d < 730 ? `${Math.round(d / 30.4)} months ago` : `${Math.round(d / 365)} years ago`; };
const istHM = t => new Date(t * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const sWay = d => d === 'up' ? 'up' : 'down';
const sShape = S => S.trend === 'up' ? `Swing points making higher highs and higher lows${S.since ? ' since ' + fmtT(S.since) : ''}`
  : S.trend === 'down' ? `Swing points making lower highs and lower lows${S.since ? ' since ' + fmtT(S.since) : ''}` : 'Swing points show no clear run of higher or lower highs right now';
const sOn = () => { try { return localStorage.getItem('72s-struct') === '1'; } catch (e) { return false; } };
const sSet = v => { try { localStorage.setItem('72s-struct', v ? '1' : '0'); } catch (e) {} };

class StructLayer {                     // order blocks as bands, and breaks of structure as short lines at the level that broke
  constructor() { this.blocks = []; this.segs = []; this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: tg => this.draw(tg) }) }]; }
  attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.redraw = requestUpdate; }
  detached() {}
  updateAllViews() {}
  paneViews() { return this.views; }
  set(blocks, segs) { this.blocks = blocks; this.segs = segs; if (this.redraw) this.redraw(); }
  draw(target) {
    if (!this.series) return;
    target.useMediaCoordinateSpace(sc => {
      const c = sc.context, W = sc.mediaSize.width, ts = this.chart.timeScale(), small = W < 500;
      c.font = `600 ${small ? 10 : 11}px Montserrat, system-ui, sans-serif`;
      this.blocks.forEach(b => {
        const y1 = this.series.priceToCoordinate(b.top), y2 = this.series.priceToCoordinate(b.bot);
        if (y1 == null || y2 == null) return;
        let x = ts.timeToCoordinate(b.t); if (x == null || x < 0) x = 0;
        const col = css(b.dir === 'up' ? '--up' : '--dn'), top = Math.min(y1, y2);
        c.globalAlpha = b.status === 'fresh' ? 0.2 : 0.1; c.fillStyle = col;
        c.fillRect(x, top, W - x, Math.max(2, Math.abs(y2 - y1)));
        c.globalAlpha = 0.95; c.textAlign = 'right';              // the label sits at the right edge, next to the price scale, out of the candles' way
        c.fillText(`OB ₹${px(b.bot)}–${px(b.top)}${b.status === 'fresh' ? '' : ' · tested'}`, W - 6, top - 4);
        c.textAlign = 'left'; c.globalAlpha = 1;
      });
      this.segs.forEach(e => {
        const y = this.series.priceToCoordinate(e.level);
        let x0 = ts.timeToCoordinate(e.level_t), x1 = ts.timeToCoordinate(e.t);
        if (y == null || x1 == null || x1 < 0) return;                 // off the visible window: an old break is not "now"
        if (x0 == null || x0 < 0) x0 = 0;
        const col = css(e.dir === 'up' ? '--up' : '--dn');
        c.strokeStyle = col; c.lineWidth = 1.6; c.setLineDash([]); c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
        c.fillStyle = col; c.beginPath(); c.arc(x1, y, 3, 0, 7); c.fill();
        const dt = fmtT(e.t).replace(/ \d{4}$/, '');     // the chart's time axis already shows the year: keep labels short
        const tag = e.kind === 'Break' ? `${e.dir === 'up' ? 'Above swing high' : 'Below swing low'} · ${dt}` : `${e.kind} ${e.dir === 'up' ? 'up' : 'down'} · ${dt}`;
        c.textAlign = 'center'; c.fillText(tag, Math.max(40, (x0 + x1) / 2), e.dir === 'up' ? y - 6 : y + 14); c.textAlign = 'left';
      });
    });
  }
}
// layers a viewer can switch on and off; the stock page offers the first three, the Price Structure page all four
const SLAYERS = [['ob', 'Order blocks'], ['BoS', 'BoS'], ['CHoCH', 'CHoCH'], ['swing', 'Swing points'], ['hist', 'Show history']];     // sweeps and breaks are worked out but not shown
const S_MAIN = ['ob', 'BoS', 'CHoCH', 'hist'], S_ALL = SLAYERS.map(l => l[0]);
const sLayers = () => { try { const v = JSON.parse(localStorage.getItem('72s-slayers3')); if (Array.isArray(v)) return v; } catch (e) {} return ['ob', 'BoS', 'CHoCH']; };     // the Now view: nearest zones and the latest break
const SHELP = {
  ob: '<b>Order block.</b> The last candle that moved the other way just before price broke a recent high or low. The shaded band runs from that candle&#39;s low to its high. Darker means price has not come back to it yet; lighter means it has. Once a candle closes through the band, it is removed. It is a chart shape, not a buy or sell level.',
  BoS: '<b>Break of structure (BoS).</b> Price closed above its last swing high while it was already making higher highs and higher lows, or below its last swing low while making lower ones. In plain words: the existing direction carried on. The arrow marks the day.',
  CHoCH: '<b>Change of character (CHoCH).</b> The first close the other way: for example, a close above the last swing high after a run of lower highs and lower lows. The pattern of the swings changed. Sometimes a new direction follows, often it does not.',
  Sweep: '<b>Liquidity sweep.</b> During the day price poked past the last swing high or low, then closed back inside it. Many traders keep orders just beyond these levels, which is where the name comes from. Marked S.',
  Break: '<b>Break.</b> A close past the last swing high or low when there was no clear run of higher or lower swings before it, so it is neither a BoS nor a CHoCH. Marked B.',
  hist: '<b>Show history.</b> Normally the chart shows only what matters now: the order blocks nearest above and below the price, and the latest break of structure or change of character as a line at the level that broke. Switch this on to see every standing order block and every break from the past year.',
  swing: '<b>Swing points.</b> A swing high is a candle whose high is above the three candles on each side of it; a swing low is the mirror image. Every other reading is measured from these. A swing point only appears three candles after it forms, once it is confirmed.' };
const sChips = allowed => `<div class="sl-chips" id="sl-chips" role="group" aria-label="Show on chart">${SLAYERS.filter(l => allowed.includes(l[0])).map(([k, t]) =>
  `<span class="sl-pair"><button class="sl-chip${sLayers().includes(k) ? ' on' : ''}" data-l="${k}" aria-pressed="${sLayers().includes(k)}"><i class="sl-i sl-i-${k}"></i>${t}</button><button class="sl-info" data-i="${k}" aria-label="What is ${t}?" title="What is this?">i</button></span>`).join('')}</div><div class="sl-help" id="sl-help" hidden></div>`;
const sZoom = (chart, n) => { if (n > 140) chart.timeScale().setVisibleLogicalRange({ from: n - 126, to: n + 4 }); };     // six months: zones and candles readable; scroll back for the rest
function drawStructure(chart, series, S, allowed) {
  if (!S) return;
  const layer = new StructLayer();
  series.attachPrimitive(layer);
  let on = [], swingLines = [];
  const near = () => {                                           // the band price is inside, and the nearest above and below
    const L = S.last, bl = S.blocks || [];
    const inside = bl.filter(b => L >= b.bot && L <= b.top);
    const above = bl.filter(b => b.bot > L).sort((a, b) => a.bot - b.bot).slice(0, 1), below = bl.filter(b => b.top < L).sort((a, b) => b.top - a.top).slice(0, 1);
    return [...inside, ...above, ...below];
  };
  const apply = () => {
    on = sLayers().filter(k => allowed.includes(k));
    const hist = on.includes('hist'), brk = (S.events || []).filter(e => ['BoS', 'CHoCH'].includes(e.kind) && on.includes(e.kind) && e.level_t);
    // the Now line is the latest change of any kind, so it matches the trend reading; a plain break gets a plain label
    const last = (on.includes('BoS') || on.includes('CHoCH')) ? (S.events || []).filter(e => ['BoS', 'CHoCH', 'Break'].includes(e.kind) && e.level_t).slice(-1) : [];
    layer.set(on.includes('ob') ? (hist ? (S.blocks || []) : near()) : [], hist ? [] : last);
    const mk = [];
    if (on.includes('swing')) (S.swings || []).forEach(w => mk.push({ time: w.t, position: w.kind === 'H' ? 'aboveBar' : 'belowBar', color: css('--faint'), shape: 'circle', size: 0.4 }));
    if (hist) brk.forEach(e => mk.push({ time: e.t, position: e.dir === 'up' ? 'belowBar' : 'aboveBar', color: css(e.dir === 'up' ? '--up' : '--dn'),
      shape: e.dir === 'up' ? 'arrowUp' : 'arrowDown', text: innerWidth < 700 ? '' : SMARK[e.kind], size: 0.8 }));
    mk.sort((a, b) => a.time - b.time);
    series.setMarkers(mk);
    swingLines.forEach(l => series.removePriceLine(l)); swingLines = [];
    if (on.includes('swing') || hist) {                          // the levels the next break would cross; part of the detail view
      if (S.last_high) swingLines.push(series.createPriceLine({ price: S.last_high.p, color: css('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Last swing high' }));
      if (S.last_low) swingLines.push(series.createPriceLine({ price: S.last_low.p, color: css('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Last swing low' }));
    }
  };
  apply();
  const chips = $('#sl-chips');
  if (chips) chips.onclick = e => {
    const inf = e.target.closest('[data-i]');
    if (inf) {                                       // the i button: a plain explanation under the chips; tap again to close
      const box = $('#sl-help'), k = inf.dataset.i, open = !box.hidden && box.dataset.k === k;
      chips.querySelectorAll('.sl-info').forEach(x => x.classList.toggle('on', !open && x === inf));
      box.hidden = open; box.dataset.k = k; box.innerHTML = open ? '' : SHELP[k] + ' <span class="mut">Describes what price did; not a recommendation.</span>';
      return;
    }
    const b = e.target.closest('[data-l]'); if (!b) return;
    const cur = sLayers(), k = b.dataset.l, next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    try { localStorage.setItem('72s-slayers3', JSON.stringify(next)); } catch (e2) {}
    b.classList.toggle('on', next.includes(k)); b.setAttribute('aria-pressed', next.includes(k));
    apply();
  };
  const note = $('#st-note');
  if (note) {
    const base = note.innerHTML;
    chart.subscribeCrosshairMove(p => {
      if (!p || !p.time) { note.innerHTML = base; return; }
      const ev = (S.events || []).filter(e => e.t === p.time && on.includes(e.kind)), bl = on.includes('ob') ? (S.blocks || []).filter(b => b.t === p.time) : [];
      note.innerHTML = ev.length || bl.length ? [...ev.map(e => `<b>${fmtT(e.t)} · ${SKIND[e.kind]}, ${sWay(e.dir)}.</b> ${esc(e.text)}.`),
        ...bl.map(b => b.n > 1 ? `<b>${b.n} order blocks, ${b.dates.map(fmtT).join(', ')}.</b> Their price ranges overlap or sit within 1% of each other, so they are drawn as one band, ₹${px(b.bot)} to ₹${px(b.top)}.`
          : `<b>${fmtT(b.t)} · Order block.</b> The last candle that moved the other way before the ${SKIND[b.after].toLowerCase()} on ${fmtT(b.made_t)}, ₹${px(b.bot)} to ₹${px(b.top)}.`)].join('<br>') : base;
    });
  }
}
// One plain reading of where the trend stands: the swing points (structure.py) and chart strength (chartscore.py)
// read together, then where price sits. A description of the chart, never advice.
function sRead(S, ch) {
  if (!S) return null;
  const band = ch && ch.band, cs = ch ? `chart strength ${ch.score} (${band})` : '';
  const strong = ['Strong', 'Constructive'].includes(band), weak = ['Weak', 'Broken'].includes(band);
  const since = S.since ? ` since ${fmtT(S.since)}` : '';
  let tag, tone, how;
  if (S.trend === 'up') {
    if (!ch || strong) { tag = 'Uptrend'; tone = 'up'; how = `Swing points are making higher highs and higher lows${since}${ch ? `, and ${cs} agrees` : ''}.`; }
    else if (weak) { tag = 'Turning up, chart still weak'; tone = 'mix'; how = `Swing points have turned up${since}, but ${cs} says the longer picture is still down. Early, and not yet confirmed.`; }
    else { tag = 'Uptrend, not yet confirmed'; tone = 'mix'; how = `Swing points are making higher highs and higher lows${since}, while ${cs} has not caught up yet.`; }
  } else if (S.trend === 'down') {
    if (!ch || weak) { tag = 'Downtrend'; tone = 'dn'; how = `Swing points are making lower highs and lower lows${since}${ch ? `, and ${cs} agrees` : ''}.`; }
    else if (strong) { tag = 'Pullback in a strong chart'; tone = 'mix'; how = `Swing points have turned down${since}, but ${cs} says the longer picture is still up. A dip inside an uptrend, or the start of a turn.`; }
    else { tag = 'Downtrend, not yet confirmed'; tone = 'mix'; how = `Swing points are making lower highs and lower lows${since}, while ${cs} sits in the middle.`; }
  } else {
    if (strong) { tag = 'Sideways in a strong chart'; tone = 'mix'; how = `No clear run of higher or lower swings right now, while ${cs} says the longer picture is up.`; }
    else if (weak) { tag = 'Sideways in a weak chart'; tone = 'mix'; how = `No clear run of higher or lower swings right now, while ${cs} says the longer picture is down.`; }
    else { tag = 'Sideways'; tone = 'flat'; how = `No clear run of higher or lower swings right now${ch ? `, and ${cs} sits in the middle` : ''}.`; }
  }
  const lastEv = (S.events || []).filter(e => ['BoS', 'CHoCH', 'Break'].includes(e.kind)).slice(-1)[0];     // a plain break is not drawn, but it is still the latest change
  const change = !lastEv ? '' : lastEv.kind === 'Break'
    ? `The latest change was a close ${lastEv.dir === 'up' ? 'above its last swing high' : 'below its last swing low'} on ${fmtT(lastEv.t)}, before any clear run of swings.`
    : `The last change in structure was a ${SKIND[lastEv.kind].toLowerCase()} ${sWay(lastEv.dir)} on ${fmtT(lastEv.t)}.`;
  const L = S.last, H = S.last_high && S.last_high.p, Lo = S.last_low && S.last_low.p;
  const pct = (a, b) => n(Math.abs(a / b - 1) * 100, 1);
  let where = '';
  if (L && H && Lo) {
    if (L > H) where = `Price ₹${px(L)} is above its last swing high of ₹${px(H)} (by ${pct(L, H)}%) and ${pct(L, Lo)}% above its last swing low of ₹${px(Lo)}.`;
    else if (L < Lo) where = `Price ₹${px(L)} is below its last swing low of ₹${px(Lo)} (by ${pct(Lo, L)}%).`;
    else where = `Price ₹${px(L)} sits between its last swing low of ₹${px(Lo)} and swing high of ₹${px(H)}, about ${n((L - Lo) / (H - Lo) * 100)}% of the way up.`;
  }
  const bl = S.blocks || [];
  const inside = bl.find(b => L >= b.bot && L <= b.top);
  const above = bl.filter(b => b.bot > L).sort((a, b) => a.bot - b.bot)[0], below = bl.filter(b => b.top < L).sort((a, b) => b.top - a.top)[0];
  const zone = inside ? `It is inside an order block band, ₹${px(inside.bot)} to ₹${px(inside.top)}.`
    : [above ? `The nearest order block above is ₹${px(above.bot)} to ₹${px(above.top)}, ${pct(above.bot, L)}% higher.` : '',
       below ? `The nearest below is ₹${px(below.bot)} to ₹${px(below.top)}, ${pct(L, below.top)}% lower.` : ''].filter(Boolean).join(' ');
  return { tag, tone, how, change, where, zone };
}
const sReadBox = (S, ch) => { const r = sRead(S, ch); if (!r) return '';
  return `<div class="s-read"><div class="s-read-h"><span class="s-tag s-${r.tone}">${esc(r.tag)}</span><span class="mut">Trend reading</span></div>
    <p><b>How:</b> ${r.how} ${r.change}</p>${r.where ? `<p><b>Where:</b> ${r.where} ${r.zone}</p>` : ''}</div>`; };
function sGlance(S, ch) {
  const r = sRead(S, ch); if (!r) return '';
  const L = S.last, H = S.last_high && S.last_high.p, Lo = S.last_low && S.last_low.p, bl = S.blocks || [];
  const above = bl.filter(b => b.bot > L).sort((a, b) => a.bot - b.bot)[0], below = bl.filter(b => b.top < L).sort((a, b) => b.top - a.top)[0];
  const tone = r.tone === 'up' ? 'up' : r.tone === 'dn' ? 'dn' : '';
  return glance([
    [esc(r.tag), 'swing trend', tone],
    S.since && S.trend !== 'none' ? [fmtT(S.since).replace(/ \d{4}$/, ''), `since · ${sAgo(S.since)}`] : null,
    ch && ch.score != null ? [`${ch.score} ${esc(ch.band || '')}`, 'chart strength', ch.score >= 60 ? 'up' : ch.score < 45 ? 'dn' : ''] : null,
    H ? [sgp((L / H - 1) * 100), `vs swing high ₹${px(H)}`] : null,
    Lo ? [sgp((L / Lo - 1) * 100), `vs swing low ₹${px(Lo)}`] : null,
    above ? [sgp((above.bot / L - 1) * 100), 'next block above'] : null,
    below ? [sgp((below.top / L - 1) * 100), 'next block below'] : null,
  ], `${r.how} ${r.change}`);
}
function sLadder(S) {
  const L = S.last, rows = [];
  (S.blocks || []).forEach(b => rows.push({ p: (b.top + b.bot) / 2, e: b.bot > L ? b.bot : b.top < L ? b.top : L, sw: b.dir === 'up' ? 'up' : 'dn', v: `₹${px(b.bot)} to ₹${px(b.top)}`,
    l: `order block before a move ${b.dir === 'up' ? 'up' : 'down'} · ${fmtT(b.t)}${sAgo(b.t) ? ` (${sAgo(b.t)})` : ''} · ${b.status === 'fresh' ? 'not revisited' : `revisited ${b.tests}×`}` }));
  if (S.last_high) rows.push({ p: S.last_high.p, sw: 'lv', v: `₹${px(S.last_high.p)}`, l: `last swing high · ${fmtT(S.last_high.t)}` });
  if (S.last_low) rows.push({ p: S.last_low.p, sw: 'lv', v: `₹${px(S.last_low.p)}`, l: `last swing low · ${fmtT(S.last_low.t)}` });
  rows.push({ p: L, now: 1, sw: 'now', v: `₹${px(L)}`, l: 'last close' });
  rows.sort((a, b) => b.p - a.p);
  return `<div class="lad">${rows.map(r => `<div class="lad-r${r.now ? ' now' : ''}"><i class="lad-sw ${r.sw}"></i><div><b class="num">${r.v}</b><span>${r.l}</span></div><em class="num">${r.now ? '' : sgp(((r.e ?? r.p) / L - 1) * 100)}</em></div>`).join('')}</div>`;
}
const S_NOTE = 'Order blocks, breaks of structure and changes of character describe chart shapes on daily candles, updated after the close. They are not predictions and not a recommendation.';
function structCard(S, sym, full, ch) {
  if (!S) return card('Price structure', '<div class="empty">Not enough price history to read the swings yet.</div>');
  const blocks = S.blocks || [];
  const evs = full ? (S.events || []).filter(e => ['BoS', 'CHoCH', 'Break'].includes(e.kind)).slice(-5).reverse() : [];     // plain breaks too, or a stock's recent moves go missing
  const blk = b => `<div class="sb-row"><span class="sb-sw ${b.dir === 'up' ? 'up' : 'dn'}"></span><div><b>₹${px(b.bot)} to ₹${px(b.top)}</b><span>${b.dir === 'up' ? 'before a move up' : 'before a move down'} · ${b.n > 1 ? `${b.n} blocks drawn as one band, ${b.dates.map(fmtT).join(', ')}` : `${fmtT(b.t)}${sAgo(b.t) ? ` (${sAgo(b.t)})` : ''}`} · ${b.status === 'fresh' ? 'not revisited yet' : `revisited ${b.tests} time${b.tests > 1 ? 's' : ''}`}</span></div></div>`;
  const evr = e => `<div class="se-row"><span class="se-tag ${e.dir === 'up' ? 'up' : 'dn'}">${e.kind === 'Break' ? 'Break' : SMARK[e.kind]}</span><div><b>${fmtT(e.t)} · ${SKIND[e.kind]}, ${sWay(e.dir)}</b>${sAgo(e.t) ? ` <i class="s-ago">· ${sAgo(e.t)}</i>` : ''}<span>${esc(e.text)}.</span></div></div>`;
  return card('Price structure', `${full ? `<h4 class="sc-h">Levels around price</h4>${sLadder(S)}${blocks.length ? '' : '<p class="mut sc-none">No order block standing: price has closed through every recent one.</p>'}` : `${sReadBox(S, ch)}
    <h4 class="sc-h">Order blocks still standing</h4>${blocks.length ? blocks.map(blk).join('') : '<p class="mut sc-none">None: price has closed through every recent one.</p>'}`}
    ${full ? `<h4 class="sc-h">Latest changes in structure</h4>${evs.length ? evs.map(evr).join('') : '<p class="mut sc-none">None in the last year.</p>'}` : ''}
    <p class="note2">${S.tf === '5m' ? S_NOTE.replace('on daily candles, updated after the close', 'on 5-minute candles, from delayed prices') : S_NOTE}${full ? '' : ` <a href="#structure/${encodeURIComponent(sym)}">See every event on the Price Structure page →</a>`}</p>`, S.tf === '5m' ? '5-minute candles' : 'daily candles');
}
// the all-stock scan runs after the close, but a restart can run it mid-session: say which
const sScanLate = td => { const m = /(\d{4}-\d\d-\d\d) (\d\d):(\d\d)/.exec(td.built || ''); return !m || m[1] > td.day || +m[2] * 60 + +m[3] >= 930; };
const sScanWhen = td => sScanLate(td) ? `on the ${esc(fmtD(td.day))} close` : `during the ${esc(fmtD(td.day))} session, at ${esc(td.built.slice(11, 16))}`;
async function vStructure() {
  symbar('structure', ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'ITC', 'LT']);
  $('#sym-in').placeholder = 'Any NSE stock';
  const sym = st.sym.structure || 'RELIANCE';
  const tf5 = st.sTf === '5m';
  sIntra = tf5;
  const [d, td, i5] = await Promise.all([api('/api/stock?sym=' + encodeURIComponent(sym)), tf5 ? Promise.resolve(null) : api(st.sAll ? '/api/structure_today_all' : '/api/structure_today').catch(() => null),
    tf5 ? api('/api/structure_intraday?sym=' + encodeURIComponent(sym)).catch(e => ({ error: e.message })) : Promise.resolve(null)]);
  if (tf5 && i5 && !i5.error) { d.candles = i5.candles; d.structure = i5.structure; d.chart = null; }     // 5-minute view: swings alone set the reading; chart strength is a daily score
  const S = d.structure;
  if (S && !tf5 && d.candles && d.candles.length) S.last = d.candles[d.candles.length - 1].c;     // one price on the page: the latest close the chart shows
  st.read = null;                                  // the stock page's summary belongs on the stock page
  const tdy = S && S.today ? S.today.filter(e => ['BoS', 'CHoCH', 'OB'].includes(e.kind)) : [];
  const rd = sRead(S, d.chart);
  $('#headline').textContent = S ? `${sym} · ${rd.tag}${tdy.length ? ' · ' + tdy.map(e => `${SKIND[e.kind].toLowerCase()} ${sWay(e.dir)} on the last close`).join(', ') : ''}` : `${sym}: not enough price history to read the swings.`;
  const GROUPS_T = [['BoS_up', 'Break of structure, up'], ['BoS_dn', 'Break of structure, down'], ['CHoCH_up', 'Change of character, up'], ['CHoCH_dn', 'Change of character, down'],
    ['OB_up', 'Dipped back into an order block (before a move up)'], ['OB_dn', 'Rose back into an order block (before a move down)']];     // two columns: up on the left, down on the right
  const todayCard = td && !td.error ? card(`Today across ${td.scope === 'fno' ? 'F&amp;O stocks' : 'all stocks'} <span class="seg" id="s-scope" style="margin-left:8px"><button class="${st.sAll ? '' : 'on'}" data-a="0">F&amp;O</button><button class="${st.sAll ? 'on' : ''}" data-a="1">All stocks</button></span>`,
    `<p class="mut" style="font-size:13.5px;margin:0 0 8px">${n(td.stocks)} stocks read ${sScanWhen(td)}: ${n(td.shape.up)} making higher highs and higher lows, ${n(td.shape.down)} making lower highs and lower lows.</p>
     <div class="st-today">${GROUPS_T.map(([k, t]) => { const g = (td.groups || {})[k] || []; return `<details class="st-g"${g.length ? '' : ' data-empty'}><summary><span>${t}</span><b class="num">${g.length}</b></summary>${g.length ? `<div class="st-syms">${g.sort((a, b) => a.sym.localeCompare(b.sym)).map(x => symlink(x.sym, 'structure')).join(' ')}</div>` : ''}</details>`; }).join('')}</div>
     <p class="note2">Counts of what happened on the day read. A list of events, not a ranking and not a list of trades.</p>`, sScanLate(td) ? 'after the close' : 'during the session') : card('Today across F&amp;O stocks', '<div class="empty">The first all-stock scan runs after the close. Counts appear then.</div>');
  const tfSeg = `<span class="seg" id="s-tf" style="margin-left:8px"><button class="${tf5 ? '' : 'on'}" data-tf="1d">Daily</button><button class="${tf5 ? 'on' : ''}" data-tf="5m">5 min</button></span>`;
  view.innerHTML = `${tf5 && i5 && i5.error ? `<div class="empty">${esc(i5.error)}</div>` : ''}${S ? sGlance(S, d.chart) : ''}<div class="grid g-main">${card(`${esc(sym)} · ${tf5 ? '5-minute' : 'daily'} candles ${tfSeg}<a class="mut" style="font-size:13px;margin-left:8px" href="#stock/${encodeURIComponent(sym)}">full stock page →</a>`, `${sChips(S_ALL)}<div class="chart st-chart" id="lw"></div><p class="note2" id="st-note">Point at a marker or a shaded band to read what happened that day.</p>`)}
    <div class="grid">${structCard(S, sym, true, d.chart)}</div></div>
    ${tf5 ? '<div id="snow-slot"></div>' : todayCard}
    <p class="note2">Order blocks, breaks of structure and changes of character come from Smart Money Concepts. They describe chart shapes, not who traded. Nothing here is a recommendation, an entry, a stop or a target.</p>`;
  const sc = $('#s-scope'); if (sc) sc.onclick = e => { const b = e.target.closest('[data-a]'); if (b) { st.sAll = b.dataset.a === '1'; render(true); } };
  $('#s-tf').onclick = e => { const b = e.target.closest('[data-tf]'); if (b) { st.sTf = b.dataset.tf; render(true); } };
  if (tf5) structNow($('#snow-slot'));
  if (!window.LightweightCharts) { $('#lw').innerHTML = '<div class="err">Chart library did not load. Check the internet connection.</div>'; return; }
  if (!d.candles || !d.candles.length) { $('#lw').innerHTML = '<div class="empty">No prices for this stock.</div>'; return; }
  chart = LightweightCharts.createChart($('#lw'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Montserrat, system-ui, 'Segoe UI', sans-serif" },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') }, crosshair: { mode: 0 },
    timeScale: { borderColor: css('--line'), timeVisible: tf5, tickMarkFormatter: tf5 ? (t => istHM(t)) : undefined }, localization: tf5 ? { timeFormatter: t => fmtT(t) } : {} });
  const se = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
  se.setData(d.candles.map(x => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));
  drawStructure(chart, se, S, S_ALL);
  chart.timeScale().fitContent();
  sZoom(chart, d.candles.length);
}

/* ---------- My Feed: a curated timeline for the visitor's own stocks ---------- */
const FD_GROUPS = { all: 'Everything', res: 'Results', news: 'Company news', money: 'Big money' };     // moves and levels are standing facts: they sit in "Right now"
const fdGroup = k => /^Results/.test(k) ? 'res' : /deal|Institutions|Big holder|Pledge|Insider/.test(k) ? 'money' : /Big move|Level/.test(k) ? 'move' : 'news';
const fdDay = t => { const d = new Date(t * 1000), td = new Date(); const k = x => x.toDateString();
  return k(d) === k(td) ? 'Today' : k(d) === k(new Date(td.getTime() - 864e5)) ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); };
const fdTime = t => new Date(t * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
function fdItem(x, big) {
  return `<div class="fd-i${big ? ' big' : ''}${x.new ? ' new' : ''}">
    <div class="fd-h"><span class="symlink" data-stock="${esc(x.sym)}">${esc(x.sym)}</span><span class="fd-k fd-${fdGroup(x.kind)}">${esc(x.kind)}</span>${x.new ? '<em class="fd-new">New</em>' : ''}<time>${big ? fdDay(x.t) + ' · ' : ''}${fdTime(x.t)}</time></div>
    <p class="${x.tone === 'up' ? 'up' : x.tone === 'dn' ? 'dn' : ''}">${esc(x.text)}</p>
    <div class="fd-f"><span>${esc(x.why || '')}</span><span>${esc(x.src)}${x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">read the filing</a>` : ''}</span></div></div>`;
}
async function vFeed() {
  const list = getWatch();
  const seenKey = '72s-feed-seen';
  let since = null; try { since = acct.user && acct.prev ? acct.prev : +(localStorage.getItem(seenKey) || 0) || null; } catch (e) {}
  if (!list.length) {
    $('#headline').textContent = 'My Feed · follow a few stocks to fill it';
    view.innerHTML = `<section class="card fd-empty"><h3>Your results, company news and big trades, in one place</h3>
      <p class="mut">Add the stocks you own or follow. This page then shows only what matters about them: results out and coming, announcements the company files with NSE, bulk and block deals, and big moves. Routine paperwork is left out.</p>
      <p><a class="explain-btn" href="#mine" style="text-decoration:none">Add stocks to my list</a></p>
      <p class="mut" style="font-size:13px">Or start with: ${['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK'].map(x => `<button class="chip fd-add" data-add="${x}">+ ${x}</button>`).join(' ')}</p></section>`;
    view.querySelectorAll('.fd-add').forEach(b => b.onclick = () => { setWatch([...getWatch(), b.dataset.add]); render(); });
    return;
  }
  const d = await api(`/api/feed?syms=${encodeURIComponent(list.join(','))}${since ? '&since=' + Math.floor(since > 1e12 ? since / 1000 : since) : ''}${st.fdAll ? '&all=1' : ''}`);
  const g = st.fdG || 'all';
  const keep = x => g === 'all' || fdGroup(x.kind) === g;
  const tl = d.timeline.filter(keep), top = d.top.filter(keep);
  const cnt = k => d.timeline.concat(d.top).filter(x => k === 'all' || fdGroup(x.kind) === k).length;
  $('#headline').textContent = `My Feed · ${d.new ? `${d.new} new since your last visit` : 'nothing new since your last visit'}`;
  const days = []; tl.forEach(x => { const k = fdDay(x.t); let b = days.find(z => z.k === k); if (!b) days.push(b = { k, xs: [] }); b.xs.push(x); });
  const wk = Date.now() / 1000 - 7 * 86400;
  view.innerHTML = `${glance([[n(d.stocks), 'stocks you follow'], [n(d.new), 'new since last visit', d.new ? 'up' : ''], [n(d.upcoming.length), 'results coming'],
      [n(d.timeline.concat(d.top).filter(x => /deal/.test(x.kind) && x.t > wk).length), 'big trades this week']])}
    <div class="fd-bar"><span class="seg" id="fd-g">${Object.entries(FD_GROUPS).map(([k, t]) => `<button class="${g === k ? 'on' : ''}" data-g="${k}">${t} <small>${cnt(k)}</small></button>`).join('')}</span>
      <label class="ack"><input type="checkbox" id="fd-all" ${st.fdAll ? 'checked' : ''}> include routine updates${d.hidden_routine && !st.fdAll ? ` (${d.hidden_routine} hidden)` : ''}</label>
      <a class="mut" href="#mine" style="font-size:13px">Edit my list (${list.length}) →</a></div>
    <div class="fd-grid"><div>
      ${top.length ? `<h2 class="sec-h">Worth knowing this week</h2><div class="fd-top">${top.map(x => fdItem(x, true)).join('')}</div>` : ''}
      <h2 class="sec-h">Everything, newest first</h2>
      ${days.length ? days.map(b => { const vis = b.xs.filter(x => !x.fold), more = b.xs.filter(x => x.fold);
        return `<div class="fd-day"><h4>${b.k}</h4>${vis.map(x => fdItem(x)).join('')}${more.length ? `<details class="fd-more"><summary>${more.length} more that day</summary>${more.map(x => fdItem(x)).join('')}</details>` : ''}</div>`; }).join('')
        : '<div class="empty">Nothing in this group in the last 45 days.</div>'}
    </div><aside>
      ${d.now && d.now.length ? card('Right now on your stocks', d.now.map(x => `<div class="fd-now"><span class="symlink" data-stock="${esc(x.sym)}">${esc(x.sym)}</span><span class="${x.tone === 'up' ? 'up' : x.tone === 'dn' ? 'dn' : ''}">${esc(x.text)}</span></div>`).join('')) : ''}
      ${card('Results coming for your stocks', d.upcoming.length ? d.upcoming.map(u => `<div class="fd-up"><b>${esc(u.date)}</b><span class="symlink" data-stock="${esc(u.sym)}">${esc(u.sym)}</span><i>${esc(u.text.replace(/^Results on [^,]+,?\s*/i, ''))}</i></div>`).join('') : '<div class="empty">No results dates announced yet.</div>')}
      ${card('How this feed is chosen', `<p class="note2" style="margin:0">Results, company announcements to NSE, bulk and block deals, big moves and institution changes for the stocks on your list, from the last 45 days. Routine paperwork (record dates, certificates, trading windows) is hidden. At most two items per stock per day are shown up front. Big trades are kept from ${d.deals_days ? `the last ${d.deals_days} trading day${d.deals_days > 1 ? 's' : ''} we stored` : 'today on'}. Descriptions of events, not advice.</p>`)}
    </aside></div>`;
  $('#fd-g').onclick = e => { const b = e.target.closest('[data-g]'); if (b) { st.fdG = b.dataset.g; render(true); } };
  $('#fd-all').onchange = e => { st.fdAll = e.target.checked; render(true); };
  try { localStorage.setItem(seenKey, String(Date.now())); } catch (e) {}
}

/* ---------- track record ---------- */
async function vTrack() {
  const d = await api('/api/track');
  const s5 = d.summary['5'] || d.summary[5], s20 = d.summary['20'] || d.summary[20];
  const M = d.min || { stocks: 30, sessions: 20 }, ex = d.excluded || {};
  const big = (s, h) => {
    if (!s.ready) return `<div class="tk wait"><span>After ${h} sessions</span><b>Too early</b><i>${s.stocks} of ${M.stocks} different stocks and ${s.sessions} of ${M.sessions} sessions checked. No result is shown until both are reached, because a few weeks of one kind of market proves nothing.</i></div>`;
    const sure = s.se != null && Math.abs(s.spread) > 2 * s.se;
    return `<div class="tk"><span>After ${h} sessions</span><b class="num ${cls(s.spread)}">${sg(s.spread, 1)} pts</b><i>Signals-up readings ${sg(s.up.avg, 1)}% and signals-down readings ${sg(s.dn.avg, 1)}% against stocks of their size. ${sure ? 'A gap this size is unlikely to be chance alone.' : 'A gap this size could still be chance.'} Right ${s.hits} of ${s.n} times (${s.rate}%); a coin toss would land between ${50 - s.luck}% and ${50 + s.luck}%.</i></div>`;
  };
  const have = new Set(d.rows.map(r => r.date)), skipped = [];
  if (d.rows.length) for (let t = new Date(d.started + 'T00:00:00'), e = new Date(Math.max(...d.rows.map(r => new Date(r.date + 'T00:00:00').getTime()))); t <= e; t = new Date(t.getTime() + 864e5)) {
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (t.getDay() % 6 && !have.has(iso) && (!d.trading || d.trading.includes(iso))) skipped.push(fmtD(iso));     // holidays are not missed days
  }
  const lean = { up: 'Signals up', dn: 'Signals down', warn: 'Mixed' };
  const res = (r, h) => r['x' + h] == null ? '<span class="mut">pending</span>'
    : `<span class="num ${cls(r['x' + h])}">${sg(r['x' + h], 1)}%</span>${r.counted && 'ok' + h in r ? ` <span class="okc ${r['ok' + h] ? 'y' : 'n'}">${r['ok' + h] ? 'right' : 'wrong'}</span>` : ''}`;
  const why = r => r.special ? 'special session, not counted' : r.late ? 'logged late, not counted' : r.repeat ? 'repeat, counted once' : r.lean === 'warn' ? 'mixed, not checked' : '';
  const counted = d.picks - (ex.repeat || 0) - (ex.late || 0) - (ex.mixed || 0) - (ex.special || 0);
  $('#headline').textContent = d.picks
    ? `${d.picks} readings logged across ${d.sessions} session${d.sessions > 1 ? 's' : ''} since ${fmtD(d.started)}. Each is written down by 9 pm on the day and checked later against stocks of its own size.${skipped.length ? ` No log for ${skipped.join(', ')}.` : ''} Nothing is edited after the fact.`
    : 'The log starts with the next closed session.';
  view.innerHTML = `<section class="card trk">
      <div class="tks">${big(s5, 5)}${big(s20, 20)}<div class="tk"><span>Logged so far</span><b class="num">${d.picks}</b><i>${d.sessions} session${d.sessions === 1 ? '' : 's'}, ${d.pending5} still waiting for their first check. ${counted} count toward the result; ${ex.repeat || 0} repeats, ${ex.late || 0} logged late, ${ex.mixed || 0} mixed${ex.special ? ` and ${ex.special} from a special session` : ''} do not.</i></div></div>
      <div class="how"><b>How a reading is checked.</b> Each day the six Stocks in focus are recorded with their signal and closing price, by 9 pm that evening. Five and twenty trading days later the stock's move is compared with an index of stocks its size over the same days: Nifty 100 for large caps, Midcap 150 for mid caps, Smallcap 250 for small caps. The main number is how much better signals-up readings did than signals-down readings, which is a fair test whether the market rose or fell. A stock that stays in focus day after day is one call, so it counts once. Readings logged after 9 pm, and mixed readings, are shown but not counted.</div></section>
    ${chartTest(d.chart)}${fnoTest(d.fno)}
    ${card('Full log', d.rows.length ? `<div class="tw"><table class="trtab"><thead><tr><th>Date</th><th>Stock</th><th>Signals</th><th>What stood out</th><th class="r">Price then</th><th class="r">5 sessions, vs its size</th><th class="r">20 sessions, vs its size</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr${r.counted ? '' : ' class="trx"'}><td class="num">${fmtD(r.date)}</td><td><a class="symlink" data-stock="${esc(r.sym)}" href="#stock">${esc(r.sym)}</a><br><span class="mut" style="font-size:12px">vs ${esc(r.bench || 'Nifty')}</span></td><td><span class="lean-c t-${r.lean}">${lean[r.lean] || r.lean}</span>${why(r) ? `<br><span class="mut" style="font-size:12px">${why(r)}</span>` : ''}</td><td>${esc(r.title)}</td><td class="r num">${px(r.price)}</td><td class="r">${res(r, 5)}</td><td class="r">${res(r, 20)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing logged yet.</div>', 'newest first')}
    <p class="note2">Past results of these readings say nothing certain about future ones, and none of this is a recommendation to buy or sell.</p>`;
}
function chartTest(c) {
  if (!c) return '';
  if ((c.sessions || 0) < 20) return card(`Chart strength: too early to judge`, `<p class="how">Every evening chart strength is logged for every listed stock (${n(c.stocks)} last time) and later checked against what prices did. ${c.sessions || 0} of 20 sessions logged so far${c.started ? ` since ${fmtD(c.started)}` : ''}. Results appear here once there are enough.</p>`, 'checked against what prices did next');
  const bands = ['Strong', 'Constructive', 'Neutral', 'Weak', 'Broken'];
  const any = [5, 20, 60].some(h => Object.keys((c.h || {})[h] || {}).length);
  const cell = (h, b) => { const x = ((c.h || {})[h] || {})[b]; return x ? `<td class="r"><span class="num ${cls(x.avg)}">${sg(x.avg, 1)}%</span><br><span class="mut" style="font-size:12px">${x.beat}% beat Nifty · ${n(x.n)}</span></td>` : '<td class="r mut">pending</td>'; };
  return card('Chart strength, checked against what prices did', `<p class="how">Every evening chart strength is worked out for every listed stock (${n(c.stocks)} last time) and written down with the closing price. Later we check how each band did against Nifty. If the score works, Strong should beat Nifty and Broken should lag it, at least at one horizon. ${c.started ? `Logging since ${fmtD(c.started)}, ${c.sessions} session${c.sessions === 1 ? '' : 's'} so far.` : 'Logging starts with the next closed session.'}</p>
    ${any ? '' : '<p class="mut" style="font-size:13.5px">No results yet: the first 5-session read arrives five trading days after logging starts, the 60-session read about three months in.</p>'}
    <div class="tw"><table class="trtab"><thead><tr><th>Band</th><th class="r">5 sessions later</th><th class="r">20 sessions later</th><th class="r">60 sessions later</th></tr></thead><tbody>
    ${bands.map(b => `<tr><td><span class="cs-band cs-${b.toLowerCase()}">${b}</span></td>${cell(5, b)}${cell(20, b)}${cell(60, b)}</tr>`).join('')}</tbody></table></div>
    <p class="note2">Average return against Nifty for stocks in each band. Strong 75 and above, Constructive 60 to 74, Neutral 45 to 59, Weak 30 to 44, Broken below 30.</p>`, 'checked against what prices did next');
}
function fmtD(iso) { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); }

/* ---------- alerts ---------- */
const AKEY = '72s-alerts', ALOG = '72s-alert-log', AFIRED = '72s-alert-fired';
const ADEF = { above: null, below: null, move: 4, results: true, levels: true, focus: true };
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const alertFor = sym => ({ ...ADEF, ...(lsGet(AKEY, {})[sym] || {}) });
function alertCount(sym) { const a = alertFor(sym); return ['above', 'below', 'move'].filter(k => a[k]).length + ['results', 'levels', 'focus'].filter(k => a[k]).length; }
function alertPanel(sym, last) {
  const a = alertFor(sym);
  const ck = (k, t) => `<label class="ack"><input type="checkbox" data-ak="${k}" ${a[k] ? 'checked' : ''}> ${t}</label>`;
  return `<form class="apanel" data-asave="${esc(sym)}">
    <div class="arow"><label>Price rises above<input data-ak="above" inputmode="decimal" placeholder="${last ? px(last * 1.05) : ''}" value="${a.above ?? ''}"></label>
      <label>Price falls below<input data-ak="below" inputmode="decimal" placeholder="${last ? px(last * 0.95) : ''}" value="${a.below ?? ''}"></label>
      <label>Moves more than, in a day<select data-ak="move">${[null, 2, 3, 4, 5, 8].map(v => `<option value="${v ?? ''}" ${a.move == v ? 'selected' : ''}>${v ? v + '%' : 'Off'}</option>`).join('')}</select></label></div>
    <div class="arow">${ck('results', 'Results come out')}${ck('levels', 'Breaks its option floor or ceiling')}${ck('focus', 'Shows up in Stocks in focus')}</div>
    <div class="arow"><button type="submit">Save alerts for ${esc(sym)}</button><button type="button" class="ghost" data-aclose>Cancel</button></div></form>`;
}
function alertsBtn(open = false) {
  const perm = !('Notification' in window) ? 'unsupported' : Notification.permission;
  const on = perm === 'granted';
  return `<button class="abtn ${on ? 'on' : ''}" id="atoggle">🔔 Alerts ${on ? 'on' : 'off'}</button>${open ? `<div class="apop">
    <p>${on ? 'Notifications are on for this browser.' : perm === 'denied' ? 'Notifications are blocked in your browser settings. Alerts still show on this page.' : 'Get a notification when something new happens on your stocks.'} Only new events alert you: fresh results, a level broken today, a big move today, or a price you set with 🔔 on a stock.</p>
    <div class="am"><b>Market alerts</b>${malertBoxes()}</div>
    <div class="abtns">${perm === 'default' ? '<button class="btn-y" id="aon">Turn on notifications</button>' : ''}<button class="wbtn" id="atest">Send a test alert</button></div></div>` : ''}`;
}
function malertBoxes() { const m = mAlerts(); return `<label class="ack"><input type="checkbox" data-mk="oneway" ${m.oneway ? 'checked' : ''}> A stock joins the One-way moves lists (top 3 up or down)</label>
  <label class="ack"><input type="checkbox" data-mk="struct5" ${m.struct5 ? 'checked' : ''}> A watchlist stock breaks structure or reaches an order block on 5-minute candles</label>
  <label class="ack"><input type="checkbox" data-mk="sound" ${m.sound ? 'checked' : ''}> Play a short chime with each alert</label>`; }
document.addEventListener('change', e => { const c = e.target.closest('[data-mk]'); if (!c) return; const m = mAlerts(); m[c.dataset.mk] = c.checked; try { localStorage.setItem('72s-malerts', JSON.stringify(m)); } catch (e2) {}
  if (c.dataset.mk === 'sound' && c.checked) chime();       // a tap unlocks sound in the browser, and lets the visitor hear it once
  if (c.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); });
function toast(title, body, sym) {
  let box = $('#toasts'); if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="toasts"></div>'); box = $('#toasts'); }
  const el = document.createElement('div'); el.className = 'toast'; if (sym) el.dataset.stock = sym;
  el.innerHTML = `<b>${esc(title)}</b><span>${esc(body)}</span>`;
  box.appendChild(el); setTimeout(() => el.classList.add('out'), 9000); setTimeout(() => el.remove(), 9600);
}
function chime() {
  try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const ctx = chime.ctx || (chime.ctx = new A()); if (ctx.state === 'suspended') ctx.resume();
    [[880, 0], [1320, 0.13]].forEach(([f, t]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.4); }); } catch (e) {}
}
function fireAlert(sym, title, body) {
  const now = new Date();
  toast(title, body, sym);
  if (mAlerts().sound) chime();
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body, tag: title }); n.onclick = () => { window.focus(); openStock(sym); n.close(); }; } catch (e) {}
  }
}
function mAlerts() { let v = {}; try { v = JSON.parse(localStorage.getItem('72s-malerts')) || {}; } catch (e) {} return { oneway: false, struct5: false, sound: false, ...v }; }
async function checkMarket() {
  const m = mAlerts(); if (!m.oneway && !m.struct5) return;
  const fired = lsGet(AFIRED, {}), today = new Date().toISOString().slice(0, 10), base = lsGet('72s-m-base', {});
  const quiet = base[today] !== true;                      // the first check of the day notes what is already there
  let n = 0; const hit = (key, sym, title, body) => { if (fired[key] || n >= 4) return; fired[key] = today; if (quiet) return; n++; fireAlert(sym, title, body); };
  if (m.oneway) { try { const d = await api('/api/livefo'); if (d.open) {
    (d.bull || []).slice(0, 3).forEach(r => hit(`ow|up|${r.sym}|${today}`, r.sym, `${r.sym} joined One-way moves up`, `${sg(r.chg)}% on the day, rising steadily from the open.`));
    (d.bear || []).slice(0, 3).forEach(r => hit(`ow|dn|${r.sym}|${today}`, r.sym, `${r.sym} joined One-way moves down`, `${sg(r.chg)}% on the day, falling steadily from the open.`)); } } catch (e) {} }
  if (m.struct5) { const W = new Set(getWatch()); if (W.size) { try { const d = await api('/api/structure_now'); if (d.open) {
    d.feed.filter(e => W.has(e.sym)).forEach(e => hit(`s5|${e.sym}|${e.t}`, e.sym, `${e.sym}: ${e.kind === 'Break' ? (e.dir === 'up' ? 'closed above its swing high' : 'closed below its swing low') : `${e.kind === 'BoS' ? 'break of structure' : 'change of character'} ${e.dir === 'up' ? 'up' : 'down'}`}`, `On 5-minute candles at ${istHM(e.t)}, level ₹${px(e.level)}. A description of price, not a signal to trade.`));
    d.at_ob.filter(x => W.has(x.sym)).forEach(x => hit(`ob|${x.sym}|${x.t}`, x.sym, `${x.sym} is back in an order block`, `₹${px(x.bot)} to ₹${px(x.top)} on 5-minute candles.`)); } } catch (e) {} } }
  lsSet(AFIRED, fired); base[today] = true; lsSet('72s-m-base', base);
}
async function checkAlerts() {
  await checkMarket();
  const list = getWatch(); if (!list.length) return;
  let d; try { d = await api('/api/watch?syms=' + encodeURIComponent(list.join(','))); } catch (e) { return; }
  const fired = lsGet(AFIRED, {}), today = new Date().toISOString().slice(0, 10); let n = 0;
  const quiet = !lsGet('72s-alert-base', false);          // first run: note what is already true, alert on nothing
  const hit = (key, sym, title, body) => { if (fired[key] || n >= 5) return; fired[key] = today; if (quiet) return; n++; fireAlert(sym, title, body); };
  const fresh = f => { const d = new Date(`${f} ${new Date().getFullYear()}`); return !isNaN(d) && (Date.now() - d) / 864e5 <= 2; };
  for (const r of d.rows) {
    if (r.error || !r.last) continue;
    const a = alertFor(r.sym), s = r.sym;
    if (a.above && r.last >= a.above) hit(`${s}|above|${a.above}`, s, `${s} crossed ₹${px(a.above)}`, `Now ₹${px(r.last)}, ${sg(r.chg)}% on the day.`);
    if (a.below && r.last <= a.below) hit(`${s}|below|${a.below}`, s, `${s} fell below ₹${px(a.below)}`, `Now ₹${px(r.last)}, ${sg(r.chg)}% on the day.`);
    if (a.move && Math.abs(r.chg) >= a.move) hit(`${s}|move|${today}`, s, `${s} ${r.chg > 0 ? 'up' : 'down'} ${Math.abs(r.chg).toFixed(1)}%`, (r.changes[0] || {}).text || 'A bigger move than your alert level.');
    if (a.results && r.rstate === 'out' && r.filed && fresh(r.filed)) { const c = (r.changes.find(c => /results out/.test(c.text)) || {}).text; hit(`${s}|res|${r.quarter}`, s, `${s} ${r.quarter} results are out`, c ? c.replace(/^.*?results out [^:]*: /, '').replace(/^./, m => m.toUpperCase()) + '.' : `Filed ${r.filed}. Open the stock for the numbers.`); }
    if (a.levels && r.floor && r.last < r.floor) hit(`${s}|floor|${r.floor}`, s, `${s} broke its option floor`, `₹${px(r.last)} is under ${px(r.floor)}, the level put writers were defending.`);
    if (a.levels && r.ceiling && r.last > r.ceiling) hit(`${s}|ceil|${r.ceiling}`, s, `${s} broke its option ceiling`, `₹${px(r.last)} is above ${px(r.ceiling)}, where call writers had capped it.`);
    if (a.focus && r.in_focus) hit(`${s}|focus|${today}`, s, `${s} is in Stocks in focus`, 'Several signals line up on it today. Open Today to see why.');
  }
  lsSet(AFIRED, fired);
  lsSet('72s-alert-base', true);
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-alert]');
  if (b) {
    e.stopPropagation();
    const row = b.closest('.mrow'), open = row.nextElementSibling && row.nextElementSibling.matches('.apanel');
    document.querySelectorAll('.apanel').forEach(p => p.remove());
    if (!open) row.insertAdjacentHTML('afterend', alertPanel(b.dataset.alert, +b.dataset.last || 0));
    return;
  }
  if (e.target.closest('[data-aclose]')) { e.target.closest('.apanel').remove(); return; }
  if (!e.target.closest('.aw')) { const pop = view.querySelector('.apop'); if (pop) pop.remove(); }
  if (e.target.closest('#atoggle')) { const w = view.querySelector('.aw'); if (w) w.innerHTML = alertsBtn(!w.querySelector('.apop')); return; }
  if (e.target.closest('#aon')) { try { await Notification.requestPermission(); } catch (e2) {} const w = view.querySelector('.aw'); if (w) w.innerHTML = alertsBtn(true); return; }
  if (e.target.closest('#atest')) {
    const s = getWatch()[0] || 'RELIANCE';
    fireAlert(s, `Test: ${s} alert`, 'This is how an alert looks. Real ones fire on results, broken levels, big moves and your price levels.');
    return;
  }
}, true);
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-asave]'); if (!f) return; e.preventDefault();
  const sym = f.dataset.asave, all = lsGet(AKEY, {}), a = {};
  f.querySelectorAll('[data-ak]').forEach(i => { const k = i.dataset.ak; a[k] = i.type === 'checkbox' ? i.checked : (i.value === '' ? null : +String(i.value).replace(/,/g, '')); });
  all[sym] = a; lsSet(AKEY, all);
  const btn = document.querySelector(`[data-alert="${sym}"]`); if (btn) btn.querySelector('i').textContent = alertCount(sym);
  f.remove(); toast(`Alerts saved for ${sym}`, `${alertCount(sym)} alerts on. Checks run every few minutes while this site is open.`, sym);
});
setTimeout(checkAlerts, 6000);
setInterval(checkAlerts, 3 * 60 * 1000);

/* ---------- first visit ---------- */
function welcome() {
  if (lsGet('72s-welcome', false)) return '';
  return `<section class="welcome"><div><b>New here? Three things this site does</b>
    <ol><li><b>Search any stock</b> and get everything about it on one page, in plain words.</li>
    <li><b>Add the stocks you own</b> to Watchlist. You see only what changed, and get alerts.</li>
    <li><b>Check Stocks in focus</b> every morning, and see in Track record how past readings did.</li></ol></div>
    <button class="x" id="wclose" aria-label="Close">×</button></section>`;
}
document.addEventListener('click', e => { if (e.target.closest('#wclose')) { lsSet('72s-welcome', true); const w = $('.welcome'); if (w) w.remove(); } });
})();
