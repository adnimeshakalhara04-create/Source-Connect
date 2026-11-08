// Storefront states audit
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const issues = []; const add = (k, v) => issues.push(k + ': ' + v);
  for (const w of [1440, 768, 390, 320]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 850 } }); await ctx.addInitScript(() => { try { sessionStorage.setItem('scg_intro_seen','1'); } catch (e) {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => add('JS error ' + w, e.message)); p.on('console', m => { if (m.type() === 'error') add('console ' + w, m.text().slice(0, 140)); });
    p.on('response', r => { if (r.status() >= 400) add('HTTP ' + r.status(), r.url()); });
    const ov = async (label) => { const r = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth, (document.getElementById('app').innerText.match(/.{0,25}(undefined|NaN|\[object Object\]).{0,25}/) || [''])[0]]); if (r[0] > r[1] + 1) add('overflow ' + w, label + ' ' + r[0]); if (r[2]) add('bad text ' + w, label + ' ' + r[2]); };
    await p.goto('http://localhost:8765/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(400);
    // cart with items + wishlist
    for (const id of ['mens-1', 'shoes-2', 'watches-3', 'electronics-5']) { await p.evaluate(i => { location.hash = 'p/' + i; }, id); await p.waitForTimeout(250); await p.click('#addCart'); await p.click('[data-wish]'); }
    await p.evaluate(() => location.hash = 'cart'); await p.waitForTimeout(300); await ov('cart with items');
    await p.evaluate(() => location.hash = 'wishlist'); await p.waitForTimeout(300); await ov('wishlist with items');
    await p.evaluate(() => location.hash = 'checkout'); await p.waitForTimeout(300); await ov('checkout');
    for (const [k, v] of [['name', 'Kasun Perera'], ['phone', '0771234567'], ['email', 'k@example.com'], ['address', '10 Main St'], ['city', 'Kandy']]) await p.fill('#co [name=' + k + ']', v);
    await p.click('#co button.btn'); await p.waitForTimeout(400); await ov('order placed');
    if (!(await p.$('.success'))) add('flow ' + w, 'order did not complete');
    const oid = await p.evaluate(() => SCG.getOrders()[0] && SCG.getOrders()[0].id);
    await p.evaluate(i => location.hash = 'track/' + i, oid); await p.waitForTimeout(300); await ov('track found');
    if (!(await p.$('.track-steps'))) add('flow ' + w, 'tracking did not find the order');
    await p.evaluate(() => location.hash = 'account'); await p.waitForTimeout(300); await ov('account with orders');
    await p.evaluate(() => location.hash = 'checkout'); await p.waitForTimeout(300); await ov('checkout empty cart (redirect)');
    // flash ended
    await p.evaluate(() => { SCG.load().settings.flashMode = 'off'; SCG.save(); }); await p.reload(); await p.waitForTimeout(400);
    await p.evaluate(() => location.hash = 'flash'); await p.waitForTimeout(300); await ov('flash ended');
    await p.evaluate(() => location.hash = ''); await p.waitForTimeout(400); await ov('home without flash');
    // drawer + search suggestions (mobile/desktop)
    if (w <= 680) { await p.click('#burger'); await p.waitForTimeout(400); await ov('drawer open'); await p.click('#drawerClose'); }
    await p.fill('#searchInput', 'sh'); await p.waitForTimeout(200); await ov('search suggest');
    // intro
    await p.goto('http://localhost:8765/?intro=1'); await p.waitForTimeout(4200); await ov('intro');
    const btn = await p.$eval('.in-enter', e => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }).catch(() => false);
    if (!btn) add('intro ' + w, 'Enter button not fully on screen');
    await ctx.close();
  }
  console.log(issues.length ? [...new Set(issues)].join('\n') : 'no issues');
  await b.close();
})();
