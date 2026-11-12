// Baseline visual snapshots of the original design (desktop + mobile).
// Usage: node e2e/baseline.mjs [outDir]   (default e2e/baseline)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // works with a local install or the machine-wide one
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || path.join(here, 'baseline'));
fs.mkdirSync(out, { recursive: true });
const { srv, url } = await serveStatic(root);
const b = await chromium.launch();
const shots = [
  ['home', '#'], ['product', '#p/mens-1'], ['category', '#c/electronics'], ['cart', '#cart'], ['checkout', '#checkout'], ['account', '#account'], ['track', '#track/SCG0000001'],
];
const admin = ['dashboard', 'products', 'orders', 'editor', 'banners', 'homepage'];
const errors = [];
for (const [dev, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(dev + ' ' + e.message));
  await p.goto(url + '/'); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('scg_intro_seen', '1'); sessionStorage.setItem('scg_intro_seen', '1');
    const o = [{ id: 'SCG0000001', date: '2026-11-01T10:00:00Z', status: 'Shipped', payment: 'Cash on Delivery', customer: { name: 'Test Customer', phone: '0771234567', address: '1 Main St, Kandy, Kandy', profileId: 'c1' }, items: [{ id: 'mens-1', name: 'Classic Cotton Crew Neck Tee', size: 'M', qty: 1, price: 1880, origin: 'china' }], subtotal: 1880, shipping: 350, total: 2230 }];
    localStorage.setItem('scg_orders_v1', JSON.stringify(o)); localStorage.setItem('scg_cart_v2', JSON.stringify([{ id: 'mens-1', size: 'M', qty: 1 }]));
    localStorage.setItem('scg_profile_v1', JSON.stringify({ id: 'c1', name: 'Test Customer', phone: '0771234567', createdAt: '2026-11-01T10:00:00Z' })); });
  await p.reload(); // the intro was decided on first load; reload so it stays off
  for (const [name, hash] of shots) {
    await p.goto(url + '/' + hash); await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(out, `site-${name}-${dev}.jpg`), type: 'jpeg', quality: 72 });
  }
  await p.goto(url + '/admin/'); await p.fill('input[name=user]', 'admin'); await p.fill('input[name=pass]', 'admin123'); await p.click('#loginForm button:not(.pw-eye)'); await p.waitForTimeout(500);
  for (const v of admin) { await p.evaluate(h => location.hash = h, v); await p.waitForTimeout(v === 'editor' ? 1800 : 600); await p.screenshot({ path: path.join(out, `admin-${v}-${dev}.jpg`), type: 'jpeg', quality: 72 }); }
  await ctx.close();
}
await b.close(); srv.close();
console.log('snapshots written to', out, errors.length ? '\nERRORS:\n' + errors.join('\n') : '(no page errors)');
