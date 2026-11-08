// Admin audit: every view + every modal at 3 widths
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const issues = new Set(); const add = (k, v) => issues.add(k + ': ' + v);
  for (const w of [1440, 1024, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 850 } });
    const a = await ctx.newPage(); a.on('dialog', d => d.dismiss());
    a.on('pageerror', e => add('JS error ' + w, e.message)); a.on('console', m => { if (m.type() === 'error') add('console ' + w, m.text().slice(0, 140)); });
    a.on('response', r => { if (r.status() >= 400) add('HTTP ' + r.status(), r.url()); });
    await a.goto('http://localhost:8765/admin/'); await a.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await a.reload();
    // an order so orders/customers have content
    await a.evaluate(() => { const o = SCG.getOrders(); o.unshift({ id: 'SCG0000001', date: new Date().toISOString(), status: 'Pending', payment: 'Cash on Delivery', customer: { name: 'Test User', phone: '0771234567', address: '1 Rd, Kandy, Kandy', profileId: 'cust-1' }, items: [{ id: 'mens-1', name: 'Classic Cotton Crew Neck Tee', size: 'M', qty: 1, price: 1880, origin: 'china' }], subtotal: 1880, shipping: 350, total: 2230 }); SCG.saveOrders(o); });
    await a.fill('input[name=user]', 'admin'); await a.fill('input[name=pass]', 'admin123'); await a.click('#loginForm button'); await a.waitForTimeout(300);
    const check = async (label) => {
      const r = await a.evaluate(() => {
        const out = [], vis = el => el.offsetParent || getComputedStyle(el).position === 'fixed';
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push(['overflow', document.documentElement.scrollWidth]);
        document.querySelectorAll('.main button, .main a[href], .modal.open button').forEach(el => { if (!vis(el)) return; const n = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim(); if (!n) out.push(['control without a name', el.outerHTML.slice(0, 80)]); });
        document.querySelectorAll('.main input, .main select, .main textarea, .modal.open input, .modal.open select, .modal.open textarea, .pv-bar select').forEach(el => { if (el.type === 'hidden' || !vis(el)) return; if (!el.closest('label') && !el.getAttribute('aria-label') && !(el.id && document.querySelector('label[for="' + el.id + '"]'))) out.push(['input without label', el.outerHTML.slice(0, 90)]); });
        const t = (document.querySelector('.main') || document.body).innerText + ' ' + ((document.querySelector('.modal.open') || {}).innerText || '');
        const m = t.match(/.{0,25}(undefined|NaN|\[object Object\]).{0,25}/); if (m) out.push(['bad text', m[0]]);
        const ids = {}; document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; }); Object.keys(ids).forEach(k => { if (ids[k] > 1) out.push(['duplicate id', k]); });
        return out;
      });
      r.forEach(([k, v]) => add(k + ' ' + w, label + ' → ' + v));
    };
    const views = ['editor', 'dashboard', 'orders', 'customers', 'products', 'flash', 'categories', 'origins', 'collections', 'collections/electronics', 'homepage', 'banners', 'header', 'pages', 'settings'];
    for (const v of views) { await a.evaluate(h => location.hash = h, v); await a.waitForTimeout(v === 'editor' ? 900 : 350); await check(v); }
    const modal = async (label, open) => { try { await open(); await a.waitForTimeout(350); await check('modal ' + label); } catch (e) { add('could not open ' + w, label + ' ' + e.message.split('\n')[0]); } await a.evaluate(() => document.getElementById('modal').classList.remove('open')); };
    await a.evaluate(() => location.hash = 'products'); await a.waitForTimeout(300);
    await modal('add product', () => a.evaluate(() => location.hash = 'products/new'));
    await a.evaluate(() => location.hash = 'products'); await a.waitForTimeout(300);
    await modal('edit product', () => a.click('#ptb [data-edit]'));
    await a.evaluate(() => location.hash = 'categories'); await a.waitForTimeout(300);
    await modal('add category', () => a.click('#addCat'));
    await modal('edit category', () => a.click('[data-edit]'));
    await a.evaluate(() => location.hash = 'collections/electronics'); await a.waitForTimeout(300);
    await modal('collection picker', () => a.click('#mAdd'));
    await a.evaluate(() => location.hash = 'banners'); await a.waitForTimeout(300);
    await modal('add banner', () => a.click('#addHero'));
    await modal('edit banner', () => a.click('[data-edit="0"]'));
    await a.evaluate(() => location.hash = 'flash'); await a.waitForTimeout(300);
    await modal('flash add', () => a.click('#fadd'));
    await a.evaluate(() => location.hash = 'orders'); await a.waitForTimeout(300);
    await modal('order detail', () => a.click('#olist tr.click td'));
    await a.evaluate(() => location.hash = 'editor'); await a.waitForTimeout(600);
    await modal('editor: + product', () => a.click('[data-new=product]'));
    await ctx.close();
  }
  console.log(issues.size ? [...issues].join('\n') : 'no issues');
  await b.close();
})();
