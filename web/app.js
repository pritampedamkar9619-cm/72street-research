/* 72 Street Market Desk — front end. Plain JS, no build step. */
(() => {
const $ = s => document.querySelector(s);
const view = $('#view');
const st = { tab: 'today', sym: { options: 'NIFTY', oiflow: 'NIFTY', liquidity: 'NIFTY', radar: 'RELIANCE', expiry: 'NIFTY', stock: 'RELIANCE' }, exp: {}, tf: '5m', symbols: [] };
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
const stat = (k, v, d = '', s = '', dc = '') => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d ${dc}">${d}</div>` : ''}${s ? `<div class="s">${s}</div>` : ''}</div>`;
const skel = (k = 3) => `<div class="grid g${Math.min(k, 3)}">${'<div class="skel"></div>'.repeat(k)}</div>`;

/* ---------- explainers (also feed the Academy) ---------- */
const EXPLAIN = {
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
const LEARN_ORDER = ['today', 'stock', 'compare', 'livefo', 'fno', 'heat', 'rotation', 'pulse', 'flow', 'results', 'mine', 'track'];
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
  const inp = $('#sym-in'); inp.value = '';
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
  $('#headline').textContent = 'Who is buying Indian shares, foreign money or Indian money?';
  const last = d.fiidii[d.fiidii.length - 1] || {};
  const h = d.fiidii, sum = k => h.reduce((a, x) => a + (x[k] || 0), 0);
  const sf = sum('fii'), sd = sum('dii'), sells = h.filter(x => (x.fii || 0) < 0).length;
  const cr = x => '₹' + n(Math.abs(x)) + ' cr';
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
const hotWord = h => { const kind = Object.keys(B).find(k => B[k][0] === h.b), w = h.side === 'PE' ? 'Put' : 'Call'; return { short_buildup: `${w} writing`, long_buildup: `${w} buying`, short_covering: `${w} writers exiting`, long_unwinding: `${w} buyers exiting` }[kind] || h.b; };
async function vOIFlow() {
  symbar('oiflow', IDX_CHIPS, true);
  const d = await getOptions('oiflow');
  $('#headline').textContent = `${d.sym}: ${d.headline}`;
  const m = d.momentum, ml = m >= 40 ? 'Put writing leads' : m >= 15 ? 'Put writing ahead' : m <= -40 ? 'Call writing leads' : m <= -15 ? 'Call writing ahead' : 'Mixed';
  const hot = d.hot.length ? `<table><thead><tr><th>Strike</th><th>What is happening</th><th class="r">/min</th></tr></thead><tbody>${d.hot.map(h => `<tr><td class="num">${px(h.k)} ${h.side}</td><td>${esc(hotWord(h))}</td><td class="r ${cls(h.spd)}">${sg(h.spd, 1)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No change yet</div>';
  view.innerHTML = `<div class="grid g-main">${card('OI flow by strike', butterfly(d), `${d.expiry}`)}
    <div class="grid">${card('Who is more active', gauge(m, -100, 100, ml, '−100 call writers · +100 put writers'))}
    ${stat('Speed near spot', n(d.near_speed) + ' <span style="font-size:13px" class="mut">contracts/min</span>', d.speed_live ? 'Live, between snapshots' : 'Session average', d.speed_live ? `${d.snapshots} snapshots this session` : 'Live speed starts when the market opens')}
    ${card('What the flow says', `<div class="notes">${d.notes.map(x => `<div>${esc(x)}</div>`).join('')}</div>`)}
    ${card('Hot strikes', hot, 'fastest OI change')}</div></div>`;
}

async function vLiquidity() {
  symbar('liquidity', IDX_CHIPS, true);
  const sym = st.sym.liquidity;
  const [d, c] = await Promise.all([getOptions('liquidity'), api(`/api/candles?sym=${encodeURIComponent(sym)}&tf=${st.tf}`)]);
  $('#headline').textContent = `${sym}: ${d.headline}`;
  const lines = [['Ceiling', d.ceiling, '--dn', 0], ['Next ceiling', d.next_ceiling ?? d.call_wall, '--dn', 2], ['Max pain', d.max_pain, '--accent', 1], ['Floor', d.floor, '--up', 0], ['Next floor', d.next_floor ?? d.put_wall, '--up', 2],
    ['Range high', d.spot + d.straddle, '--faint', 1], ['Range low', d.spot - d.straddle, '--faint', 1]];
  const tfs = ['5m', '15m', '1h', '1d'].map(t => `<button class="${t === st.tf ? 'on' : ''}" data-tf="${t}">${t}</button>`).join('');
  view.innerHTML = `<div class="grid g-main">${card(`Price and option walls <span class="seg" id="tfseg" style="margin-left:8px">${tfs}</span>`, `<div class="chart" id="lw"></div>`, d.expiry)}
    <div class="grid">${card('Floors and ceilings', `<div class="walls">${lines.map(([k, v, col, ds]) => `<div><span><i style="background:var(${col});${ds ? 'opacity:.7' : ''}"></i>${k}</span><b class="num">${px(v)}</b></div>`).join('')}</div>`, `spot ${px(d.spot)}`)}
    ${card('Who is defending', `<div class="notes">${d.notes.slice(0, 3).map(x => `<div>${esc(x)}</div>`).join('')}</div>`)}</div></div>`;
  $('#tfseg').onclick = e => { const b = e.target.closest('[data-tf]'); if (b) { st.tf = b.dataset.tf; render(); } };
  if (!window.LightweightCharts) { $('#lw').innerHTML = '<div class="err">Chart library did not load. Check the internet connection.</div>'; return; }
  if (!c.candles.length) { $('#lw').innerHTML = '<div class="empty">No candles for this symbol</div>'; return; }
  chart = LightweightCharts.createChart($('#lw'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Barlow, system-ui, 'Segoe UI', sans-serif" },
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

function vJournal() {
  $('#headline').textContent = 'A free trading journal that shows where your money actually goes.';
  const saved = (() => { try { return JSON.parse(localStorage.getItem('72s-sizer') || '{}'); } catch (e) { return {}; } })();
  const f = (id, lbl, v, hint) => `<label class="jz-f"><span>${lbl}</span><input id="${id}" type="number" inputmode="decimal" step="any" value="${v ?? ''}">${hint ? `<em>${hint}</em>` : ''}</label>`;
  view.innerHTML = `<section class="jz-top">
      <div class="card jz-pitch"><h3>Most traders do not lose on stock picking</h3>
        <p>They lose on position size, on moving the stop, and on the trade taken out of boredom. This Excel journal makes all three visible.</p>
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
  if (st.stockHome) return vStocksHome();
  await loadSearch();
  const sym = st.sym.stock || 'RELIANCE';
  const d = await api(`/api/stock?sym=${encodeURIComponent(sym)}`);
  st.lastStock = d;
  const pr = d.profile || {}, p = d.price;
  $('#headline').textContent = '';
  if (pr.name) setTitle(`${pr.name} (${sym}): price, results, valuation`);
  const gl = (d.glance || []).map(g => `<div class="gl t-${g.tone}"><span>${esc(g.k)}</span><b>${esc(g.v)}</b></div>`).join('');
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
    <div class="glance">${gl}</div>
    ${deskBox(d.call, sym)}
    <div class="st-top solo">${card(`Price <span class="seg" id="px-seg" style="margin-left:8px"><button class="on" data-r="y">${d.price_break ? 'Since ' + esc(d.price_break.date) : '12 months'}</button><button data-r="5">5 days</button><button data-r="1">Today</button></span>`, `<div class="chart" id="lw"></div>${rets(d.candles)}` + (d.price_break ? `<p class="note2">The price jumped from ₹${px(d.price_break.from)} to ₹${px(d.price_break.to)} overnight on ${esc(d.price_break.date)}. That is a demerger, split or bonus, not a real move, so the chart and returns start after it.</p>` : ''), o ? 'lines: option floor and ceiling' : '')}</div>
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
    chart = LightweightCharts.createChart($('#lw'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Barlow, system-ui, 'Segoe UI', sans-serif" },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') }, timeScale: { borderColor: css('--line') } });
    const s = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
    s.setData(d.candles.map(x => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));
    const sma = (N, color) => { if (d.candles.length <= N) return; const out = []; let sum = 0;
      d.candles.forEach((x, i) => { sum += x.c; if (i >= N) sum -= d.candles[i - N].c; if (i >= N - 1) out.push({ time: x.t, value: sum / N }); });
      chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(out); };
    const lightT = document.documentElement.getAttribute('data-theme') === 'light' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: light)').matches);
    sma(50, css('--accent')); sma(200, lightT ? '#B07F00' : css('--brand'));
    api(`/api/candles?sym=${encodeURIComponent(sym)}&tf=1d`).then(c => { if (!chart || st.sym.stock !== sym) return;
      const from = d.candles[0].t, v = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      v.setData(c.candles.filter(x => x.t >= from && x.v).map(x => ({ time: x.t, value: x.v, color: css(x.c >= x.o ? '--up' : '--dn') + '55' }))); }).catch(() => {});
    if (o) { s.createPriceLine({ price: o.floor, color: css('--up'), lineWidth: 2, lineStyle: 0, title: 'Floor' }); s.createPriceLine({ price: o.ceiling, color: css('--dn'), lineWidth: 2, lineStyle: 0, title: 'Ceiling' }); }
    if (d.call && !d.call.sample) { s.createPriceLine({ price: d.call.stop, color: css('--dn'), lineStyle: 2, title: 'Desk stop' }); s.createPriceLine({ price: d.call.target1, color: css('--up'), lineStyle: 2, title: 'Desk target' }); }
    chart.timeScale().fitContent();
    const opts = { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Barlow, system-ui, 'Segoe UI', sans-serif" },
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
  return `<div class="px-rets">${ago(5, '1 week')}${ago(21, '1 month')}${ago(63, '3 months')}${ago(126, '6 months')}${cs.length > 240 ? ago(cs.length - 1, '1 year') : ''}<span class="px-leg"><i style="background:var(--accent)"></i>50 day average <i class="px-200"></i>200 day average</span></div>`;
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
  else { x.fillStyle = P.y; x.font = '600 40px "Barlow Condensed", sans-serif'; x.fillText('72 STREET', 64, 76); }
  x.fillStyle = '#8E8B83'; x.font = '500 28px "Barlow", sans-serif'; x.textAlign = 'right'; x.fillText(o.kicker, W - 64, 74); x.textAlign = 'left';
  x.fillStyle = P.ink; x.font = '700 64px "Barlow", sans-serif';
  let y = wrapText(x, o.title, 64, 230, W - 128, 74, 2);
  x.fillStyle = P.mut; x.font = '400 32px "Barlow", sans-serif'; y = wrapText(x, o.sub, 64, y + 4, W - 128, 42, 2);
  if (o.big) { x.font = '600 120px "Barlow Condensed", sans-serif'; x.fillStyle = tone(o.big.tone); x.fillText(o.big.v, 64, y + 120); x.font = '500 30px "Barlow", sans-serif'; x.fillStyle = P.mut; x.fillText(o.big.k, 64, y + 170); y += 210; }
  const tiles = o.tiles.slice(0, 4), tw = (W - 128 - 3 * 20) / 4;
  tiles.forEach((t, i) => { const tx = 64 + i * (tw + 20); x.fillStyle = P.soft; x.beginPath(); x.roundRect(tx, y + 20, tw, 150, 18); x.fill();
    x.fillStyle = P.mut; x.font = '500 24px "Barlow", sans-serif'; wrapText(x, t.k, tx + 20, y + 62, tw - 40, 28, 2);
    x.fillStyle = tone(t.tone); let fs = 38; x.font = `600 ${fs}px "Barlow Condensed", sans-serif`; while (x.measureText(t.v).width > tw - 40 && fs > 20) { fs -= 2; x.font = `600 ${fs}px "Barlow Condensed", sans-serif`; } x.fillText(t.v, tx + 20, y + 148); });
  y += 230;
  x.font = '400 34px "Barlow", sans-serif';
  for (const l of o.lines.slice(0, 4)) { x.fillStyle = tone(l.tone); x.beginPath(); x.arc(76, y - 11, 9, 0, Math.PI * 2); x.fill(); x.fillStyle = P.ink; y = wrapText(x, l.text, 104, y, W - 168, 46, 3) + 18; if (y > H - 230) break; }
  x.fillStyle = P.ink; x.fillRect(0, H - 170, W, 170);
  x.fillStyle = '#ECEAE4'; x.font = '600 28px "Barlow", sans-serif'; x.fillText('72 Street · SEBI Registered Research Analyst · INH000029722', 64, H - 112);
  x.fillStyle = '#8E8B83'; x.font = '400 22px "Barlow", sans-serif';
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
  view.innerHTML = `<section class="hero2"><h2>${esc(A.sym)} or ${esc(Bk.sym)}?</h2>${form}</section>
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
let lfTimer = null;
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
async function vLiveFO() {
  const d = await api('/api/livefo');
  if (d.empty) { view.innerHTML = '<div class="empty">Live F&amp;O starts at 9:15 on a trading day.</div>'; return; }
  const asof = d.open ? `<span class="lf-live"><i></i>Live · prices to ${d.last_bar}</span>` : `Session of ${fmtSess(d.session)} · full day`;
  const ff = d.flow || [];
  $('#headline').textContent = ff.length ? `Among F&O stocks, ${ff[0].name} led and ${ff[ff.length - 1].name} fell most. ${d.bull_n} moved one way up, ${d.bear_n} one way down.` : `${d.total} F&O stocks.`;
  const tot = (d.up + d.down) || 1, more = st.lfMore, secAll = st.lfSec;
  const pick = rows => rows.slice(0, more ? 18 : 3);
  const grid = (rows, up) => rows.length ? `<div class="lf-tiles">${pick(rows).map(r => lfTile(r, d.paths[r.sym])).join('')}</div>` : `<div class="empty">No stock has moved one way ${up ? 'up' : 'down'} yet.</div>`;
  const fl = d.flow || [], shown = secAll || fl.length <= 6 ? fl : [...fl.slice(0, 3), ...fl.slice(-3)];
  const secRows = shown.map(s => `<button class="lf-srow" data-sec="${esc(s.name)}"><div><b>${esc(s.name)}</b>${s.broad ? '<em>Broad</em>' : ''}<span>${s.up} of ${s.n} up · ${esc(s.lead)} ${sg(s.lead_chg)}%</span></div><i class="num ${cls(s.chg)}">${sg(s.chg)}%</i></button>`).join('');
  view.innerHTML = `<section class="card lf-top">
      <div class="lf-count"><span class="k">${asof}</span>
        <div class="lf-big"><b class="up num">${d.up}</b><em>up</em><b class="dn num">${d.down}</b><em>down</em></div>
        <div class="lf-ratio"><b style="width:${d.up / tot * 100}%"></b><u style="width:${d.down / tot * 100}%"></u></div></div>
      <div class="lf-dist"><span class="k">How far they moved today</span>${lfDepth(d.depth || {})}</div>
    </section>
    <section><div class="lf-2">
      <div><h2 class="sec-h">One-way moves up <small>rose steadily from the open, not up and down</small></h2>${grid(d.bull, true)}</div>
      <div><h2 class="sec-h">One-way moves down <small>fell steadily from the open</small></h2>${grid(d.bear, false)}</div></div>
      ${d.bull.length > 3 || d.bear.length > 3 ? `<button class="lf-more" id="lf-more">${more ? 'Show top 3' : 'Show more'}</button>` : ''}</section>
    <section class="card"><h3>Sector flow<small>average of F&amp;O stocks in each sector, since 9:15</small></h3>
      <div class="lf-flow"><div class="lf-river"><canvas id="lf-cv"></canvas></div>
      <div class="lf-srows">${secRows}${fl.length > 6 ? `<button class="lf-more" id="lf-sec">${secAll ? 'Show fewer' : `All ${fl.length} sectors`}</button>` : ''}</div></div></section>
    ${lfMoving(d)}
    <p class="note2">Futures OI: ${esc(d.oi_basis || '')}. What the data shows, not a recommendation to buy or sell.${d.open ? ' Updates every two minutes.' : ''}</p>`;
  flowChart(fl);
  view.querySelectorAll('[data-lf]').forEach(el => { el.onclick = e => lfGo(el.dataset.lf, e); });
  view.querySelectorAll('[data-sec]').forEach(el => { el.onclick = () => { location.hash = 'heat/' + encodeURIComponent(el.dataset.sec); }; el.onmouseenter = () => flowChart(fl, el.dataset.sec); el.onmouseleave = () => flowChart(fl); });
  view.querySelectorAll('[data-kind]').forEach(el => { el.onclick = () => { st.lfKind = st.lfKind === el.dataset.kind ? null : el.dataset.kind; render(true); }; });
  const m = $('#lf-more'); if (m) m.onclick = () => { st.lfMore = !st.lfMore; render(true); };
  const s = $('#lf-sec'); if (s) s.onclick = () => { st.lfSec = !st.lfSec; render(true); };
  clearInterval(lfTimer);
  lfTimer = setInterval(() => { if (st.tab !== 'livefo') { clearInterval(lfTimer); return; } if (document.visibilityState === 'visible' && d.open) render(true); }, 120000);
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
  x.font = '11px Barlow, system-ui, sans-serif'; x.fillStyle = css('--faint'); x.strokeStyle = css('--grid'); x.lineWidth = 1;
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
  let lastY = -99; x.font = '600 11px Barlow, system-ui, sans-serif'; x.textAlign = 'left';
  labels.forEach(([yy, s, col, on]) => { const y2 = Math.max(yy, lastY + 13); lastY = y2; x.globalAlpha = on ? 1 : 0.35; x.fillStyle = col; x.fillText(`${s.name} ${sg(s.chg, 1)}%`, L + w + 8, y2 + 4); });
  x.globalAlpha = 1;
}
/* ---------- sector heatmap: the whole market, one tile per stock ---------- */
async function vRotation() {
  const d = await api('/api/rotation');
  const wk = innerWidth < 700 ? 8 : d.weeks.length, from = d.weeks.length - wk;
  const top = d.rows[0], low = d.rows[d.rows.length - 1];
  $('#headline').textContent = `The action moved toward ${top.name} and away from ${low.name}.`;
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
      <div class="ro-b up"><span class="k">Heating up</span>${d.rows.slice(0, 3).map(r => pill2(r, beat(r))).join('')}</div>
      <div class="ro-b dn"><span class="k">Cooling off</span>${d.rows.slice(-3).reverse().map(r => pill2(r, beat(r))).join('')}</div>
      <div class="ro-b tn"><span class="k">Just turned</span>${turned.length ? turned.map(r => pill2(r, 'behind before, ahead now')).join('') : '<p>No sector has turned in the last two weeks.</p>'}</div></section>
    <section class="card"><h3>${st.rotTable ? 'Every week, every sector' : 'Sector blocks, week by week'}<span class="seg ro-sw" id="ro-v"><button class="${st.rotTable ? '' : 'on'}" data-v="0">Blocks</button><button class="${st.rotTable ? 'on' : ''}" data-v="1">Table</button></span></h3>
    ${st.rotTable ? '' : blocks}<div class="tw"${st.rotTable ? '' : ' hidden'}><table class="ro"><thead><tr><th></th>${weeks.map(w => `<th>${range(w)}</th>`).join('')}<th class="ro-4">4 weeks</th></tr></thead><tbody>
    ${rows.map(r => r ? `<tr><td class="ro-n" data-goto="heat/${encodeURIComponent(r.name)}">${esc(r.name)}</td>${r.cells.slice(from).map((c, i) => cell(c, weeks[i], r.name)).join('')}<td class="ro-4 num ${cls(r.m4)}"><b>${sg(r.m4, 1)}</b></td></tr>` : `<tr><td class="ro-gap" colspan="${wk + 2}"></td></tr>`).join('')}</tbody></table></div>
    ${st.rotTable && d.rows.length > 16 ? `<button class="lf-more" id="ro-all">${all ? 'Show fewer' : `Show all ${d.rows.length} sectors`}</button>` : ''}
    <p class="note2">${st.rotTable ? 'Each number shows how far the sector beat or lagged the whole market that week, in %.' : 'The numbers show how far each sector beat or lagged the whole market that week, in %. The five strongest stack up and the five weakest hang below. Point at a block to follow that sector across the weeks.'} Tap a sector to see its stocks.</p></section>
    <p class="note2">Built from prices and traded value, weighted by company size. It estimates where activity moved. It is not actual money flow, because every share bought is also sold. What the data shows, not a recommendation.</p>`;
  const m = $('#ro-all'); if (m) m.onclick = () => { st.rotAll = !st.rotAll; render(true); };
  $('#ro-v').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { st.rotTable = b.dataset.v === '1'; render(true); } };
  const bx = $('#bks');
  if (bx) {
    const mark = n1 => { bx.classList.toggle('focus', !!n1); bx.querySelectorAll('.bk').forEach(x => x.classList.toggle('on', x.dataset.sn === n1)); };
    bx.onmouseover = e => { const k = e.target.closest('.bk'); mark(k ? k.dataset.sn : null); };
    bx.onmouseleave = () => mark(null);
  }
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
  view.innerHTML = `<a class="fn-back" href="#heat">← Back to the heatmap</a>
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
      ${t && t.bars && t.bars.length ? card('Today', `<div class="chart fn-chart" id="fn-ch"></div><p class="note2">5 minute candles, dotted line is VWAP.${t.oi_hist && t.oi_hist.length > 1 ? ' Amber line: futures OI through the day.' : ''}</p>`, `prices to ${esc(t.last_bar || '')}`) : ''}</div>
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
    chart = LightweightCharts.createChart($('#fn-ch'), { autoSize: true, layout: { background: { color: css('--card') }, textColor: css('--mut'), fontFamily: "Barlow, system-ui, 'Segoe UI', sans-serif" },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } }, rightPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), timeVisible: true }, crosshair: { mode: 0 }, handleScroll: false, handleScale: false });
    const cs = chart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--dn'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--dn') });
    cs.setData(t.bars.map(b => ({ time: t0 + b[0] * 300, open: b[1], high: b[2], low: b[3], close: b[4] })));
    const vw = chart.addLineSeries({ color: css('--sc'), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    vw.setData(t.bars.filter(b => b[5] != null).map(b => ({ time: t0 + b[0] * 300, value: b[5] })));
    cs.createPriceLine({ price: t.prev, color: css('--faint'), lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Prev close' });
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
  const lab = { up: ['Put heavy', 'beats Nifty'], flat: ['Balanced', 'sits in between'], dn: ['Call heavy', 'lags Nifty'] };
  const cell = (h, b) => { const x = ((c.h || {})[h] || {})[b]; return x ? `<td class="r"><span class="num ${cls(x.avg)}">${sg(x.avg, 1)}%</span><br><span class="mut" style="font-size:12px">${x.beat}% beat Nifty · ${n(x.n)}</span></td>` : '<td class="r mut">pending</td>'; };
  return card('Do the options verdicts mean anything?', `<p class="how">Every evening the options verdict for each F&amp;O stock is written down with its closing price. Later we check how each reading did against Nifty. ${c.started ? `Logging since ${fmtD(c.started)}, ${c.sessions} session${c.sessions === 1 ? '' : 's'} so far.` : 'Logging starts with the next closed session.'}</p>
    <div class="tw"><table class="trtab"><thead><tr><th>Positioning</th><th>If the reading is useful</th><th class="r">5 sessions later</th><th class="r">20 sessions later</th></tr></thead><tbody>
    ${Object.keys(lab).map(b => `<tr><td><b>${lab[b][0]}</b></td><td class="mut">${lab[b][1]}</td>${cell(5, b)}${cell(20, b)}</tr>`).join('')}</tbody></table></div>`, 'checked against what prices did next');
}

function readCard(items) {
  if (st.tab === 'stock') items = items.filter(i => !/quarter:/i.test(i.title));
  if (st.tab === 'flow' || st.tab === 'screens') return '';   // these pages explain themselves
  items = items.slice(0, 3);
  return `<section class="card read" aria-label="What this means"><h3>What this means<small>our reading of the data, for education, not a recommendation</small></h3>
    <div class="reads">${items.map(i => `<div class="ri t-${i.tone}"><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div>`).join('')}</div></section>`;
}
const VIEWS = { screener: vScreener, journal: vJournal, today: vToday, mine: vMine, track: vTrack, stock: vStock, compare: vCompare, pulse: vPulse, results: vResults, expiry: vExpiry, flow: vFlow, options: vOptions, oiflow: vOIFlow, liquidity: vLiquidity, radar: vRadar, calm: vCalm, global: vGlobal, screens: vScreens, learn: vLearn, livefo: vLiveFO, fno: vFno, heat: vHeat, rotation: vRotation };
const SYMTABS = ['options', 'oiflow', 'liquidity', 'radar', 'expiry'];

function stamp(ts, open) {
  if (ts) $('#stamp').textContent = 'Data ' + ts;
  const l = $('#live');
  if (open === true) { l.className = 'live on'; l.title = 'Live, delayed'; $('#live-t').textContent = 'Live · delayed'; }
  else if (open === false) { l.className = 'live closed'; l.title = 'Market closed, showing the last session'; $('#live-t').textContent = 'Market closed · last session'; }
}

const ADV = ['options', 'oiflow', 'liquidity', 'expiry', 'calm'];
const GROUPS = { heat: [['heat', 'Heatmap'], ['rotation', 'Sector Rotation']], options: [['livefo', 'Live F&amp;O'], ['fno', 'Stock or Index'], ['options', 'Option Pulse'], ['oiflow', 'OI Flow'], ['liquidity', 'Liquidity Map'], ['expiry', 'Expiry Tracker'], ['calm', 'Calm Zone']],
  learn: [['learn', 'Learn'], ['journal', 'Trading journal']],
  stock: [['stock', 'Find a stock'], ['screener', 'Screener'], ['compare', 'Compare']],
  markets: [['pulse', 'Market Pulse'], ['flow', 'Money Flow'], ['results', 'Results Calendar'], ['global', 'Global & Crypto'], ['screens', '52 Week Highs and Lows']] };
const groupOf = t => t === 'compare' || t === 'screener' ? 'stock' : t === 'fno' ? 'options' : (Object.keys(GROUPS).find(g => GROUPS[g].some(([k]) => k === t)) || t);
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
  $('#headrow').hidden = ['today', 'stock', 'mine', 'compare', 'fno'].includes(tab);
  $('#explain-btn').hidden = !EXPLAIN[tab];
}
const TITLES = { today: 'Today', stock: 'Find any stock', compare: 'Compare stocks', livefo: 'Live F&O', fno: 'Stock or Index F&O', options: 'Option Pulse', oiflow: 'OI Flow', liquidity: 'Liquidity Map', expiry: 'Expiry Tracker', calm: 'Calm Zone', heat: 'Sector Heatmap', rotation: 'Sector Rotation', pulse: 'Market Pulse', flow: 'FII DII Money Flow', results: 'Results Calendar', global: 'Global Markets', screens: '52 Week Highs and Lows', mine: 'Watchlist', track: 'Track record', learn: 'Learn', journal: 'Free trading journal', screener: 'Stock screener' };
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
    if (id === renderId && st.read && st.read.length) { const slot = view.querySelector('#read-slot'); if (slot) slot.outerHTML = readCard(st.read); else view.insertAdjacentHTML('afterbegin', readCard(st.read)); }
    if (id === renderId && window.fxAfter) { try { fxAfter(tab, silent); } catch (e) {} }
    if (id === renderId) { decorate(); if (tab === 'stock') { sectorLine(st.sym.stock, '.shead'); if (view.querySelector('.shead')) addRecent(st.sym.stock); } if (tab === 'fno') { sectorLine(st.sym.fno, '.fn-head'); if (!['NIFTY', 'BANKNIFTY'].includes(st.sym.fno) && view.querySelector('.fn-head')) addRecent(st.sym.fno); } } }
  catch (e) { if (id === renderId) view.innerHTML = `<div class="err">${/do not have|now trades as/.test(e.message) ? esc(e.message) : `Could not load this view: ${esc(e.message)}. It retries every minute.`}</div>`; }
}
function route() {
  if (location.hash.startsWith('#radar')) location.replace('#stock');
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
try { const qp = new URLSearchParams(location.search); const q0 = qp.get('s'); if (q0) st.sym.stock = q0.toUpperCase(); const w0 = qp.get('w'); if (w0) setWatch(w0.toUpperCase().split(',').filter(Boolean).slice(0, 30)); const c0 = qp.get('c'); if (c0 && c0.includes(',')) st.cmp = c0.toUpperCase().split(',').slice(0, 2); } catch (e) {}
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

setInterval(() => { if (document.visibilityState === 'visible' && !['learn', 'stock', 'mine', 'livefo', 'fno'].includes(st.tab) && !(document.activeElement && document.activeElement.id === 'sq')) render(true); }, 60000);
api('/api/status').then(s => stamp(null, s.market_open)).catch(() => {});
api('/api/symbols').then(d => { st.symbols = d.symbols; $('#sym-list').innerHTML = d.symbols.map(s => `<option value="${s}">`).join(''); }).catch(() => {});
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
  qs.sel = ask ? Math.max(-1, Math.min(qs.sel, qs.hits.length - 1)) : Math.min(Math.max(qs.sel, 0), Math.max(qs.hits.length - 1, 0));
  const head = ask ? askRow(ask) : '';
  if (ask) { clearTimeout(askTimer); const inp = $('#qs-in'); if (inp) { inp.parentElement.classList.add('thinking'); askTimer = setTimeout(() => inp.parentElement && inp.parentElement.classList.remove('thinking'), 450); } }
  if (ask && !qs.scr && (ask.kind === 'screen' || ask.kind === 'sector')) api('/api/screener').then(d => { qs.scr = d; if ($('#qs-in')) qsRender($('#qs-in').value); }).catch(() => {});
  box.innerHTML = head + (qs.hits.length ? `${t ? '' : '<div class="qs-k">Recent</div>'}${qs.hits.map((x, i) => `<div class="qs-r${i === qs.sel ? ' on' : ''}" data-i="${i}"><b>${esc(x.s)}</b><span>${esc(x.n)}</span>${fno.has(x.s) ? `<a href="#fno/${encodeURIComponent(x.s)}" data-f="1">F&amp;O</a>` : ''}</div>`).join('')}`
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
    const r = e.target.closest('[data-i]');
    if (r) { qsClose(); openStock(qs.hits[Number(r.dataset.i)].s); }
  };
  inp.oninput = () => { qs.sel = -1; qsRender(inp.value); };
  inp.onkeydown = e => {
    if (e.key === 'Escape') return qsClose();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const lo = qs.ask ? -1 : 0, span = qs.hits.length - lo; qs.sel = ((qs.sel - lo + (e.key === 'ArrowDown' ? 1 : -1) + span) % (span || 1)) + lo; qsRender(inp.value); }
    if (e.key === 'Enter') { if (qs.ask && qs.sel === -1) return askGo(qs.ask); if (qs.hits[qs.sel]) { const s = qs.hits[qs.sel].s; qsClose(); openStock(s); } }
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

/* ---------- track record ---------- */
async function vTrack() {
  const d = await api('/api/track');
  const s5 = d.summary['5'] || d.summary[5], s20 = d.summary['20'] || d.summary[20];
  const MIN = 30;                                  // a hit rate on a handful of stocks proves nothing
  const big = (s, h) => s.all.n >= MIN
    ? `<div class="tk"><span>After ${h} sessions</span><b class="num">${s.all.rate}%</b><i>${s.all.hits} of ${s.all.n} went the way the signals pointed · ${sg(s.all.edge, 2)}% each against Nifty</i></div>`
    : `<div class="tk wait"><span>After ${h} sessions</span><b>Too early</b><i>${s.all.n} of ${MIN} checked. No percentage until at least ${MIN} stocks are checked, because a handful proves nothing.</i></div>`;
  const have = new Set(d.rows.map(r => r.date)), skipped = [];
  if (d.rows.length) for (let t = new Date(d.started + 'T00:00:00'), e = new Date(Math.max(...d.rows.map(r => new Date(r.date + 'T00:00:00').getTime()))); t <= e; t = new Date(t.getTime() + 864e5)) {
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (t.getDay() % 6 && !have.has(iso)) skipped.push(fmtD(iso));
  }
  const lean = { up: 'Signals up', dn: 'Signals down', warn: 'Mixed' };
  const res = (r, h) => r['x' + h] == null ? '<span class="mut">pending</span>'
    : `<span class="num ${cls(r['x' + h])}">${sg(r['x' + h], 1)}%</span>${'ok' + h in r ? ` <span class="okc ${r['ok' + h] ? 'y' : 'n'}">${r['ok' + h] ? 'right' : 'wrong'}</span>` : ''}`;
  $('#headline').textContent = d.picks
    ? `${d.picks} readings logged across ${d.sessions} session${d.sessions > 1 ? 's' : ''} since ${fmtD(d.started)}. Each is written down after the close and checked against Nifty later.${skipped.length ? ` No log for ${skipped.join(', ')}.` : ''} Nothing is edited after the fact.`
    : 'The log starts with the next closed session.';
  view.innerHTML = `<section class="card trk">
      <div class="tks">${big(s5, 5)}${big(s20, 20)}<div class="tk"><span>Logged so far</span><b class="num">${d.picks}</b><i>${d.sessions} session${d.sessions === 1 ? '' : 's'}, ${d.pending5} still waiting for their first check</i></div></div>
      <div class="how"><b>How a reading is checked.</b> Each day the six Stocks in focus are recorded with their signal and closing price. Five and twenty trading days later we compare the stock's move with Nifty's over the same days. Signals up counts as right if the stock beat Nifty, signals down if it lagged Nifty. Mixed readings are logged but not checked. A coin toss would be right about half the time, so that is the number to beat.</div></section>
    ${chartTest(d.chart)}${fnoTest(d.fno)}
    ${card('Full log', d.rows.length ? `<div class="tw"><table class="trtab"><thead><tr><th>Date</th><th>Stock</th><th>Signals</th><th>What stood out</th><th class="r">Price then</th><th class="r">5 sessions, vs Nifty</th><th class="r">20 sessions, vs Nifty</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td class="num">${fmtD(r.date)}</td><td><a class="symlink" data-stock="${esc(r.sym)}" href="#stock">${esc(r.sym)}</a></td><td><span class="lean-c t-${r.lean}">${lean[r.lean] || r.lean}</span></td><td>${esc(r.title)}</td><td class="r num">${px(r.price)}</td><td class="r">${res(r, 5)}</td><td class="r">${res(r, 20)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing logged yet.</div>', 'newest first')}
    <p class="note2">Past results of these readings say nothing certain about future ones, and none of this is a recommendation to buy or sell.</p>`;
}
function chartTest(c) {
  if (!c) return '';
  const bands = ['Strong', 'Constructive', 'Neutral', 'Weak', 'Broken'];
  const any = [5, 20, 60].some(h => Object.keys((c.h || {})[h] || {}).length);
  const cell = (h, b) => { const x = ((c.h || {})[h] || {})[b]; return x ? `<td class="r"><span class="num ${cls(x.avg)}">${sg(x.avg, 1)}%</span><br><span class="mut" style="font-size:12px">${x.beat}% beat Nifty · ${n(x.n)}</span></td>` : '<td class="r mut">pending</td>'; };
  return card('Is chart strength any good?', `<p class="how">Every evening chart strength is worked out for every listed stock (${n(c.stocks)} last time) and written down with the closing price. Later we check how each band did against Nifty. If the score works, Strong should beat Nifty and Broken should lag it, at least at one horizon. ${c.started ? `Logging since ${fmtD(c.started)}, ${c.sessions} session${c.sessions === 1 ? '' : 's'} so far.` : 'Logging starts with the next closed session.'}</p>
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
    <div class="abtns">${perm === 'default' ? '<button class="btn-y" id="aon">Turn on notifications</button>' : ''}<button class="wbtn" id="atest">Send a test alert</button></div></div>` : ''}`;
}
function toast(title, body, sym) {
  let box = $('#toasts'); if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="toasts"></div>'); box = $('#toasts'); }
  const el = document.createElement('div'); el.className = 'toast'; if (sym) el.dataset.stock = sym;
  el.innerHTML = `<b>${esc(title)}</b><span>${esc(body)}</span>`;
  box.appendChild(el); setTimeout(() => el.classList.add('out'), 9000); setTimeout(() => el.remove(), 9600);
}
function fireAlert(sym, title, body) {
  const now = new Date();
  toast(title, body, sym);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body, tag: title }); n.onclick = () => { window.focus(); openStock(sym); n.close(); }; } catch (e) {}
  }
}
async function checkAlerts() {
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
