// Storefront audit: every route x 5 widths
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const issues = {}; const add = (k, v) => { (issues[k] = issues[k] || new Set()).add(v); };
  const widths = [1440, 1024, 768, 390, 320];
  const ctx = await b.newContext(); await ctx.addInitScript(() => { try { sessionStorage.setItem('scg_intro_seen','1'); } catch (e) {} });
  const p = await ctx.newPage();
  p.on('pageerror', e => add('JS error', e.message + ' @ ' + p.url()));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') add('console ' + m.type(), m.text().slice(0, 160)); });
  p.on('requestfailed', r => add('request failed', r.url() + ' ' + (r.failure() || {}).errorText));
  p.on('response', r => { if (r.status() >= 400) add('HTTP ' + r.status(), r.url()); });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto('http://localhost:8765/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
  const routes = await p.evaluate(() => {
    const d = SCG.load(), r = ['', '#shop', '#flash', '#categories', '#cart', '#checkout', '#wishlist', '#account', '#track', '#track/NOPE123', '#china-direct', '#help', '#search/shirt', '#search/zzzznothing', '#c/does-not-exist', '#col/nope', '#p/nope', '#from/nope', '#weird-route', '#from/local'];
    d.categories.forEach(c => r.push('#c/' + c.id)); d.collections.forEach(c => r.push('#col/' + c.id));
    SCG.origins().forEach(o => r.push('#from/' + o.id));
    d.products.filter((x, i) => i % 9 === 0).forEach(x => r.push('#p/' + x.id));
    return r;
  });
  console.log('routes:', routes.length);
  const check = async (route, w) => {
    const res = await p.evaluate(({ route, w }) => {
      const out = [];
      const sw = document.documentElement.scrollWidth; if (sw > innerWidth + 1) {
        const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && r.width > 0; }).slice(0, 3).map(e => e.tagName + '.' + String(e.className).slice(0, 30));
        out.push(['overflow', w + 'px ' + (route || 'home') + ' scrollWidth=' + sw + ' ' + wide.join(', ')]);
      }
      document.querySelectorAll('img').forEach(i => { if (i.complete && i.naturalWidth === 0 && i.getAttribute('src')) out.push(['broken image', (route || 'home') + ' ' + i.getAttribute('src').slice(0, 60)]); if (!i.hasAttribute('alt')) out.push(['img without alt', (route || 'home') + ' ' + (i.getAttribute('src') || '').slice(0, 50)]); });
      document.querySelectorAll('button, a[href]').forEach(el => { const name = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim(); if (!name && !el.querySelector('img[alt]:not([alt=""])') && el.offsetParent) out.push(['control without a name', (route || 'home') + ' ' + el.outerHTML.slice(0, 90)]); });
      document.querySelectorAll('input, select, textarea').forEach(el => { if (el.type === 'hidden' || !el.offsetParent) return; const id = el.id; const lab = el.closest('label') || (id && document.querySelector('label[for="' + id + '"]')); if (!lab && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) out.push(['input without label', (route || 'home') + ' ' + el.outerHTML.slice(0, 90)]); });
      const ids = {}; document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; }); Object.keys(ids).forEach(k => { if (ids[k] > 1) out.push(['duplicate id', (route || 'home') + ' #' + k + ' x' + ids[k]]); });
      document.querySelectorAll('a[href^="#"]').forEach(a => { const h = a.getAttribute('href'); if (/^#(c|col|p|from)\/$/.test(h) || h === '#undefined' || /undefined|null|NaN/.test(h)) out.push(['bad link', (route || 'home') + ' ' + h]); });
      const txt = document.getElementById('app').innerText; if (/undefined|NaN|\[object Object\]|null\b/.test(txt)) out.push(['bad text', (route || 'home') + ' ' + (txt.match(/.{0,30}(undefined|NaN|\[object Object\]|null\b).{0,30}/) || [''])[0]]);
      if (!document.getElementById('app').innerText.trim()) out.push(['empty page', route || 'home']);
      return out;
    }, { route, w });
    res.forEach(([k, v]) => add(k, v));
  };
  for (const w of widths) {
    await p.setViewportSize({ width: w, height: 900 });
    for (const r of (w === 1440 || w === 390 ? routes : routes.filter((x, i) => i < 22))) {
      await p.evaluate(h => { location.hash = h; if (!h) window.dispatchEvent(new HashChangeEvent('hashchange')); }, r); await p.waitForTimeout(r === '' ? 700 : 220);
      await check(r, w);
    }
  }
  for (const k of Object.keys(issues)) { console.log('\n== ' + k + ' (' + issues[k].size + ')'); [...issues[k]].slice(0, 40).forEach(v => console.log('  ' + v)); }
  if (!Object.keys(issues).length) console.log('no issues');
  await b.close();
})();
