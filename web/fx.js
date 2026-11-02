/* AI mode: off unless switched on with ?fx=1 or the header button. Remembered per browser. */
(function () {
  const root = document.documentElement;
  const q = new URLSearchParams(location.search).get('fx');
  const store = v => { try { if (v) localStorage.setItem('72s-fx', '1'); else localStorage.removeItem('72s-fx'); } catch (e) {} };
  if (q === '1') store(true); else if (q === '0') store(false);
  let on = false; try { on = localStorage.getItem('72s-fx') === '1'; } catch (e) {}
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.toggle('fx', on);
  const ok = () => root.classList.contains('fx') && !calm;
  const seen = new Set(), last = {};

  addEventListener('DOMContentLoaded', () => {
    const at = document.querySelector('.top-r');
    if (at) {
      const b = document.createElement('button');
      b.className = 'fx-sw'; b.type = 'button'; b.title = 'The animated AI look';
      const label = () => { b.textContent = root.classList.contains('fx') ? '✦ AI mode on' : '✦ AI mode'; };
      label();
      b.onclick = () => { const v = !root.classList.contains('fx'); root.classList.toggle('fx', v); store(v); label(); field(); ticker(); watch(); if (v) { seen.clear(); dispatchEvent(new HashChangeEvent('hashchange')); } };
      at.prepend(b);
    }
    field(); ticker(); watch();
  });

  /* ---------- the living dot field: a grid of dots lit by a moving market wave */
  let cv = null, raf = 0;
  function field() {
    const main = document.querySelector('main.wrap');
    if (!main) return;
    if (!ok()) { if (cv) { cancelAnimationFrame(raf); cv.remove(); cv = null; } return; }
    if (cv) return;
    cv = document.createElement('canvas'); cv.className = 'fx-field'; main.prepend(cv);
    const ctx = cv.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2);
    const weak = (navigator.hardwareConcurrency || 8) <= 4 || innerWidth < 600;
    const gap = weak ? 11 : 8;
    let W = 0, H = 0, mx = -999, my = -999, lastT = 0, visible = true;
    const size = () => { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size);
    addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(cv);
    const light = getComputedStyle(root).getPropertyValue('color-scheme').includes('light') || root.dataset.theme === 'light';
    const col = light ? '178,134,0' : '242,194,0';
    // the wave looks like an intraday line: a slow trend plus two smaller swings
    const line = (x, t) => .55 + .16 * Math.sin(x * .0042 + t * .00035) + .07 * Math.sin(x * .013 - t * .0009) + .03 * Math.sin(x * .041 + t * .002);
    const draw = t => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden || t - lastT < (weak ? 66 : 33)) return;
      lastT = t;
      ctx.clearRect(0, 0, W, H);
      const x0 = W * .32;                                      // keep the title side calm
      for (let x = gap / 2; x < W; x += gap) {
        const fadeL = Math.min(1, Math.max(0, (x - x0 * .5) / x0));
        if (fadeL <= 0) continue;
        const yl = H * line(x, t) * .78;
        for (let y = gap / 2; y < H; y += gap) {
          const d = Math.abs(y - yl), band = Math.max(0, 1 - d / 46);
          const under = y > yl ? .16 * Math.max(0, 1 - (y - yl) / 160) : 0;     // a soft fill below the line, like an area chart
          const md = Math.hypot(x - mx, y - my), hover = md < 120 ? (1 - md / 120) * .5 : 0;
          const tw = .05 * (Math.sin(x * 12.9898 + y * 78.233 + t * .002) + 1);   // a faint twinkle
          const a = (band * .6 + under * .8 + hover + tw * .8) * fadeL * .8;
          if (a < .04) continue;
          ctx.fillStyle = `rgba(${col},${Math.min(a, .9).toFixed(3)})`;
          const r = band > .6 ? 1.6 : 1.1;
          ctx.fillRect(x - r / 2, y - r / 2, r, r);
        }
      }
    };
    raf = requestAnimationFrame(draw);
  }

  /* ---------- the ticker: indices, sectors and movers scrolling under the header */
  let tk = null, tkTimer = 0;
  async function ticker() {
    if (!ok()) { if (tk) { tk.remove(); tk = null; clearInterval(tkTimer); } return; }
    if (tk) return;
    const head = document.querySelector('header.top');
    if (!head) return;
    tk = document.createElement('div'); tk.className = 'fx-tick'; tk.setAttribute('aria-hidden', 'true');
    head.after(tk);
    const fill = async () => {
      try {
        const d = await (await fetch('/api/pulse')).json();
        const sg = v => (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
        const c = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
        const it = [];
        it.push('<a><span class="k">INDICES</span></a>');
        (d.main || []).forEach(m => it.push(`<a href="#pulse"><b>${m.name}</b><span class="num">${Number(m.last).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span><span class="num ${c(m.chg)}">${sg(m.chg)}</span></a>`));
        it.push('<a><span class="k">SECTORS</span></a>');
        (d.sectors || []).forEach(s => it.push(`<a href="#heat"><b>${s.name}</b><span class="num ${c(s.chg)}">${sg(s.chg)}</span></a>`));
        const mv = d.movers || {};
        it.push('<a><span class="k">NIFTY 50 MOVERS</span></a>');
        [...(mv.gainers || []), ...(mv.loosers || [])].forEach(m => it.push(`<a href="#stock/${m.sym}"><b>${m.sym}</b><span class="num ${c(m.chg)}">${sg(m.chg)}</span></a>`));
        const row = it.join('');
        tk.innerHTML = `<div class="fx-tick-in">${row}${row}</div>`;
      } catch (e) {}
    };
    fill(); tkTimer = setInterval(() => { if (!document.hidden) fill(); }, 120000);
  }

  /* ---------- watching status: how many stocks the desk reads, with a radar pulse */
  let wt = null;
  async function watch() {
    if (!ok()) { if (wt) { wt.remove(); wt = null; } return; }
    if (wt) return;
    const live = document.getElementById('live');
    if (!live) return;
    wt = document.createElement('span'); wt.className = 'fx-watch'; wt.innerHTML = '<i></i><b>Watching the market</b>';
    live.before(wt);
    try { const d = await (await fetch('/api/screener')).json(); const n = (d.rows || []).length; if (n && wt) wt.querySelector('b').textContent = `Watching ${n.toLocaleString('en-IN')} stocks`; } catch (e) {}
  }

  /* ---------- numbers count up; the real number always wins */
  function countUp(el) {
    const txt = el.textContent.trim(), m = txt.match(/^([₹+−-]?)([\d,]+(?:\.\d+)?)(%?)$/);
    if (!m) return;
    const end = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, t0 = performance.now(), dur = 900;
    if (!isFinite(end) || end === 0) return;
    const fmt = v => m[1] + v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
    let done = false;
    const step = () => { if (done) return; const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { done = true; el.textContent = txt; return; } el.textContent = fmt(end * e); requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(() => { done = true; el.textContent = txt; }, dur + 150);      // the real number always wins, even if frames stall
  }

  function typeHeadline() {
    const h = document.getElementById('headline'); if (!h) return;
    const full = h.textContent; if (!full || full.length > 220) return;
    h.textContent = ''; h.classList.add('fx-typing');
    let i = 0;
    setTimeout(() => { h.textContent = full; h.classList.remove('fx-typing'); }, 2500);
    const tick = () => { i = Math.min(full.length, i + Math.max(1, Math.round(full.length / 45))); h.textContent = full.slice(0, i); if (i < full.length) setTimeout(tick, 16); else setTimeout(() => h.classList.remove('fx-typing'), 700); };
    tick();
  }

  /* ---------- sections below the fold reveal as they arrive */
  function reveal(view) {
    const items = [...view.querySelectorAll(':scope > section, :scope > .card, :scope > .grid, :scope > details')];
    const fold = innerHeight * .95;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove('fx-wait'); e.target.classList.add('fx-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => { if (el.getBoundingClientRect().top > fold) { el.classList.add('fx-wait'); io.observe(el); } });
    setTimeout(() => items.forEach(el => { if (el.classList.contains('fx-wait')) { el.classList.remove('fx-wait'); el.classList.add('fx-in'); } }), 6000);   // never leave anything hidden
  }

  /* called by render() after a view is drawn */
  window.fxAfter = function (tab, silent) {
    if (!ok()) return;
    field(); ticker(); watch();
    const view = document.getElementById('view');
    const key = location.hash || tab;
    if (!silent && !seen.has(key)) {
      seen.add(key);
      root.classList.remove('fx-run'); void root.offsetWidth; root.classList.add('fx-run');
      setTimeout(() => root.classList.remove('fx-run'), 3000);
      typeHeadline();
      const sp = view.querySelector('.since p');
      if (sp) { const full = sp.textContent; sp.textContent = ''; let i = 0; const go = () => { i = Math.min(full.length, i + 3); sp.textContent = full.slice(0, i); if (i < full.length) setTimeout(go, 14); }; setTimeout(go, 500); setTimeout(() => { sp.textContent = full; }, 3500); }
      view.querySelectorAll('.mstrip .ms-n > b.num, .stat .v, .tk b.num, .lf-big b.num, .jz-big b, .cs-top > b.num, .sprice > b.num').forEach(countUp);
      reveal(view);
    }
    view.querySelectorAll('[data-stock], [data-lf]').forEach(row => {
      const k = row.dataset.stock || row.dataset.lf, p = row.querySelector('.num');
      if (!p) return;
      const v = parseFloat(p.textContent.replace(/[^\d.-]/g, ''));
      if (silent && last[k] != null && isFinite(v) && v !== last[k]) p.classList.add(v > last[k] ? 'fx-up' : 'fx-dn');
      if (isFinite(v)) last[k] = v;
    });
  };

  addEventListener('pointermove', e => {
    if (!root.classList.contains('fx')) return;
    const c = e.target.closest && e.target.closest('.card, .fcard, .hc-c, .gl, .lf-tile');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
})();
