const { chromium } = require('playwright');
const PF = k => `'"><img src=x onerror=__h('${k}')>`; const P = PF('cust');
(async () => {
  const b = await chromium.launch(); const issues = new Set(); const add = (k, v) => issues.add(k + ': ' + v);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 850 } }); await ctx.addInitScript(() => { window.__h = k => { (window.__x = window.__x || new Set()).add(k); }; });
  const s = await ctx.newPage(); s.on('dialog', d => d.dismiss());
  s.on('pageerror', e => add('site JS error', e.message));
  await s.goto('http://localhost:8765/?intro=0'); await s.evaluate(() => localStorage.clear());
  await s.reload(); await s.waitForTimeout(300);
  const skipped = await s.evaluate((P) => {
    const db = JSON.parse(localStorage.getItem('scg_db_v2') || 'null') || SCG.db || SCG.getDB();
    const skip = /^(id|shape|color|colour|pattern|accent|origin|origins|category|cat|catId|href|link|url|img|image|images|photo|cover|icon|bg|ink|mode|kind|rule|sort|v|version|adminPassHash|adminUser|adminSalt|key|code|status|from|to|type|dev|ends|end|start|style|tone)$/i;
    const keys = new Set();
    (function walk(o) { for (const k in o) { const v = o[k]; if (typeof v === 'string') { if (!skip.test(k) && !/Id$|Hash$|Salt$|url$/i.test(k) && !/^(data:|#|https?:)/.test(v)) { o[k] = v + `'"><img src=x onerror=__h('${k}')>`; keys.add(k); } } else if (v && typeof v === 'object') walk(v); } })(db);
    const C = k => `#fff"><img src=x onerror=__h('${k}')>`, IM = k => `x" onerror="__h('${k}')`;
    db.products.slice(0, 40).forEach((p, i) => { p.color = C('pcolor'); p.accent = C('paccent'); if (i % 2) { p.images = [IM('pimg'), IM('pimg2')]; p.image = IM('pimg'); } });
    db.categories.forEach(c => { c.icon = C('cicon'); c.image = IM('cimg'); });
    db.collections.forEach(c => { c.image = IM('colimg'); c.color = C('colcolor'); });
    db.hero.forEach(h => { h.color = C('hcolor'); h.image = IM('himg'); });
    localStorage.setItem('scg_db_v2', JSON.stringify(db));
    // order + profile with payload
    const o = [{ id: 'SCG0000009', date: new Date().toISOString(), status: 'Pending', payment: 'Cash on Delivery', customer: { name: 'N' + P, phone: '0771234567', email: 'a@b.c', address: 'A' + P, city: 'C' + P, district: 'Kandy', note: 'x' + P, profileId: 'cust-1' }, items: [{ id: db.products[0].id, name: 'I' + P, size: 'M' + P, color: 'c' + P, qty: 1, price: 100, origin: 'china' }], subtotal: 100, shipping: 350, total: 450 }];
    localStorage.setItem('scg_orders_v1', JSON.stringify(o));
    localStorage.setItem('scg_profile_v1', JSON.stringify({ id: 'cust-1', name: 'N' + P, phone: '0771234567', email: 'e' + P, address: 'A' + P, city: 'C' + P, district: 'Kandy' }));
    localStorage.setItem('scg_intro_seen', '1');
    return [...keys].join(',');
  }, P);
  console.log('injected keys:', skipped);
  await s.reload(); await s.waitForTimeout(500);
  const db = await s.evaluate(() => ({ p: SCG.db ? null : null, prods: SCG.getProducts ? SCG.getProducts().slice(0, 3).map(p => p.id) : [], cats: (SCG.getCategories ? SCG.getCategories() : []).slice(0, 2).map(c => c.id) }));
  const routes = ['search/' + encodeURIComponent(`"><img src=x onerror=__h('url')>`), 'c/' + encodeURIComponent(`"><img src=x onerror=__h('url2')>`), 'p/' + encodeURIComponent(`"><img src=x onerror=__h('url3')>`), '', 'flash', 'cart', 'checkout', 'account', 'track/SCG0000009', 'china-direct', 'help', 'search/' + encodeURIComponent('tee'), 'wish', 'from/usa', 'from/china', 'col/electronics', 'col/' + (db.cols||'new-arrivals'), 'c/mens', 'p/' + (db.prods[0] || 'mens-1')];
  await s.evaluate(id => { SCG.saveCart && SCG.saveCart([{ id, size: 'M', qty: 1 }]); }, db.prods[0] || 'mens-1');
  for (const r of routes) {
    await s.evaluate(h => location.hash = h, r); await s.waitForTimeout(450);
    await s.mouse.wheel(0, 4000); await s.waitForTimeout(200);
    const x = await s.evaluate(() => { const v = window.__x ? [...window.__x].join(',') : ''; window.__x = null; return v; }); if (x) add('XSS site', '#' + r + ' → ' + x);
  }
  // search suggestions
  await s.fill('#q, input[type=search]', 'a'); await s.waitForTimeout(400);
  if (await s.evaluate(() => window.__x)) add('XSS site', 'search suggestions');
  // admin
  const a = await ctx.newPage(); a.on('dialog', d => d.dismiss()); a.on('pageerror', e => add('admin JS error', e.message));
  await a.goto('http://localhost:8765/admin/');
  await a.fill('input[name=user]', 'admin'); await a.fill('input[name=pass]', 'admin123'); await a.click('#loginForm button'); await a.waitForTimeout(400);
  const views = ['dashboard', 'orders', 'orders/SCG0000009', 'customers', 'products', 'flash', 'categories', 'origins', 'collections', 'collections/electronics', 'homepage', 'banners', 'header', 'pages', 'settings', 'editor'];
  for (const v of views) {
    await a.evaluate(h => location.hash = h, v); await a.waitForTimeout(600);
    const x = await a.evaluate(() => { const v = window.__x ? [...window.__x].join(',') : ''; window.__x = null; return v; }); if (x) add('XSS admin', v + ' → ' + x);
  }
  const tryModal = async (label, view, sel) => { try { await a.evaluate(h => location.hash = h, view); await a.waitForTimeout(400); await a.click(sel, { timeout: 2000 }); await a.waitForTimeout(400); const x = await a.evaluate(() => { const v = window.__x ? [...window.__x].join(',') : ''; window.__x = null; return v; }); if (x) add('XSS admin modal', label + ' → ' + x); } catch (e) { add('modal fail', label + ' ' + e.message.split('\n')[0]); } await a.evaluate(() => document.getElementById('modal').classList.remove('open')); };
  await tryModal('edit product', 'products', '#ptb [data-edit]');
  await tryModal('edit category', 'categories', '[data-edit]');
  await tryModal('picker', 'collections/electronics', '#mAdd');
  await tryModal('edit banner', 'banners', '[data-edit]');
  await tryModal('customer', 'customers', 'tbody tr');
  console.log([...issues].join('\n') || 'no issues');
  await b.close();
})();
