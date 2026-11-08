const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const issues = new Set(); const add = (k, v) => issues.add(k + ': ' + v);
  const badText = async (pg, label) => { const m = await pg.evaluate(() => { const t = document.body.innerText; const m = t.match(/.{0,25}(undefined|NaN|\[object Object\]|Infinity).{0,25}/); return m && m[0]; }); if (m) add('bad text', label + ' → ' + m); };
  const siteRoutes = ['', 'flash', 'cart', 'checkout', 'account', 'track/X', 'china-direct', 'help', 'search/tee', 'wish', 'from/usa', 'col/electronics', 'c/mens', 'p/mens-1', 'shop'];
  // 1) empty catalogue
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 850 } }); const s = await ctx.newPage();
    s.on('pageerror', e => add('empty: JS error', e.message)); s.on('dialog', d => d.dismiss());
    await s.goto('http://localhost:8765/'); await s.evaluate(() => { localStorage.clear(); localStorage.setItem('scg_intro_seen', '1'); const d = SCG.reload(); d.products = []; d.collections.forEach(c => { c.productIds = []; c.order = []; }); SCG.save(); SCG.saveCart([{ id: 'mens-1', size: 'M', qty: 2 }]); localStorage.setItem('scg_wish_v1', JSON.stringify(['mens-1'])); });
    for (const r of siteRoutes) { await s.evaluate(h => location.hash = h, r); await s.waitForTimeout(400); await s.mouse.wheel(0, 3000); await s.waitForTimeout(150); await badText(s, 'empty site #' + r); }
    const a = await ctx.newPage(); a.on('pageerror', e => add('empty admin: JS error', e.message)); a.on('dialog', d => d.accept());
    await a.goto('http://localhost:8765/admin/'); await a.fill('input[name=user]', 'admin'); await a.fill('input[name=pass]', 'admin123'); await a.click('#loginForm button'); await a.waitForTimeout(300);
    for (const v of ['dashboard', 'orders', 'customers', 'products', 'flash', 'categories', 'origins', 'collections', 'collections/electronics', 'homepage', 'banners', 'header', 'pages', 'settings', 'editor']) { await a.evaluate(h => location.hash = h, v); await a.waitForTimeout(400); await badText(a, 'empty admin ' + v); }
    await ctx.close();
  }
  // 2) storage blocked
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 850 } });
    await ctx.addInitScript(() => { const thrower = { get() { throw new DOMException('blocked', 'SecurityError'); } }; Object.defineProperty(window, 'localStorage', thrower); Object.defineProperty(window, 'sessionStorage', thrower); });
    const s = await ctx.newPage(); s.on('pageerror', e => add('no-storage site: JS error', e.message)); s.on('dialog', d => d.dismiss());
    await s.goto('http://localhost:8765/?intro=0'); await s.waitForTimeout(800);
    for (const r of siteRoutes) { await s.evaluate(h => location.hash = h, r); await s.waitForTimeout(300); }
    const has = await s.evaluate(() => document.querySelectorAll('.card').length); if (!has) add('no-storage', 'site shows no products');
    // add to cart + checkout path
    await s.evaluate(() => location.hash = 'p/mens-1'); await s.waitForTimeout(400);
    const a = await ctx.newPage(); a.on('pageerror', e => add('no-storage admin: JS error', e.message)); a.on('dialog', d => d.dismiss());
    await a.goto('http://localhost:8765/admin/'); await a.waitForTimeout(400);
    await a.fill('input[name=user]', 'admin'); await a.fill('input[name=pass]', 'admin123'); await a.click('#loginForm button'); await a.waitForTimeout(400);
    add('info', 'no-storage admin logged in: ' + await a.evaluate(() => !document.getElementById('shell').hidden));
    await ctx.close();
  }
  console.log([...issues].join('\n') || 'no issues');
  await b.close();
})();
