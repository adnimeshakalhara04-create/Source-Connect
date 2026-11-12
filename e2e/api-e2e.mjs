// End-to-end test of the storefront + admin against a running API.
// Prereqs: API on $API (default http://127.0.0.1:8080) with a seeded DB, the static site on $SITE (default http://127.0.0.1:8000),
// an owner account ($OWNER_USER / $OWNER_PASS) and PAYHERE_MERCHANT_ID / PAYHERE_MERCHANT_SECRET matching the API's sandbox test values.
// Usage: node e2e/api-e2e.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const API = process.env.API || 'http://127.0.0.1:8080';
const SITE = process.env.SITE || 'http://127.0.0.1:8000';
const USER = process.env.OWNER_USER || 'owner', PASS = process.env.OWNER_PASS;
const MID = process.env.PAYHERE_MERCHANT_ID, SECRET = process.env.PAYHERE_MERCHANT_SECRET;
const OUT = process.env.OUT || 'e2e/out';
fs.mkdirSync(OUT, { recursive: true });
const results = []; let failed = 0;
const check = (name, ok, extra = '') => { results.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!ok) failed++; };
const md5U = s => crypto.createHash('md5').update(s).digest('hex').toUpperCase();

const b = await chromium.launch();
const errors = [];
async function ctx(opts = {}) {
  const c = await b.newContext({ viewport: { width: 1366, height: 860 }, ...opts });
  await c.addInitScript(() => { try { sessionStorage.setItem('scg_intro_seen', '1'); localStorage.setItem('scg_intro_seen', '1'); } catch (e) {} });
  // PayHere's real page is outside this test; record that the browser was sent there with the right fields
  await c.route('https://sandbox.payhere.lk/**', async r => { c._payhere = r.request().postData(); await r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>PayHere sandbox (stub)</h1>' }); });
  return c;
}
// pick a size that is in stock right now (runs can be repeated on the same database)
const inStock = async (slug) => { const p = await (await fetch(API + '/api/v1/products/' + slug)).json(); const v = (p.variants || []).slice().sort((a, b) => b.stock - a.stock)[0]; return v ? v.size : ''; };
const cartWith = async (pg, slug) => { const size = await inStock(slug); await pg.evaluate(([id, sz]) => { SCG.saveCart([{ id, size: sz, qty: 1, sel: true }]); location.hash = 'checkout'; }, [slug, size]); };
const page = async (c, name) => { const p = await c.newPage(); p.on('pageerror', e => errors.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text().slice(0, 160)); }); return p; };
const q = s => SITE + '/' + s.replace(/^\//, '');
const withApi = (path) => { const i = path.indexOf('#'); const p = i < 0 ? path : path.slice(0, i), h = i < 0 ? '' : path.slice(i); return q(p + (p.includes('?') ? '&' : '?') + 'api=' + encodeURIComponent(API) + h); };
process.on('uncaughtException', e => { console.log(results.join('\n')); console.log('CRASH: ' + e.message.split('\n')[0]); console.log('errors: ' + errors.join(' | ')); process.exit(1); });
process.on('unhandledRejection', e => { console.log(results.join('\n')); console.log('CRASH: ' + String(e && e.message || e).split('\n')[0]); console.log('errors: ' + errors.join(' | ')); process.exit(1); });

// ---------- 1. storefront loads from the API ----------
const shopper = await ctx(); const sp = await page(shopper, 'shop');
await sp.goto(withApi('')); await sp.waitForSelector('.card', { timeout: 15000 });
check('storefront renders products from the API', (await sp.$$('.card')).length > 10);
await sp.screenshot({ path: OUT + '/api-home-desktop.jpg', type: 'jpeg', quality: 70 });

// ---------- 2. admin login (server) and an edit seen on ANOTHER device ----------
const adminC = await ctx(); const ap = await page(adminC, 'admin');
await ap.goto(withApi('admin/'));
check('default admin/admin123 hint is hidden', await ap.$eval('#defHint', e => e.hidden).catch(() => true));
await ap.fill('input[name=user]', 'admin'); await ap.fill('input[name=pass]', 'admin123'); await ap.click('#loginForm button:not(.pw-eye)'); await ap.waitForTimeout(800);
check('old default login is refused', /incorrect/i.test(await ap.textContent('#loginErr')));
await ap.fill('input[name=user]', USER); await ap.fill('input[name=pass]', PASS); await ap.click('#loginForm button:not(.pw-eye)');
await ap.waitForSelector('#shell:not([hidden])', { timeout: 15000 }); await ap.waitForTimeout(1200);
check('owner signs in through the server', await ap.isVisible('#shell'));
await ap.screenshot({ path: OUT + '/api-admin-dashboard.jpg', type: 'jpeg', quality: 70 });
const before = await (await fetch(API + '/api/v1/products/mens-12')).json();
const newPrice = before.price + 10;
await ap.evaluate(() => { location.hash = 'products'; }); await ap.waitForTimeout(800);
await ap.fill('#pq', before.name); await ap.waitForTimeout(500);
const priceInput = ap.locator('#ptb tr[data-id="mens-12"] [data-f=price]');
await priceInput.fill(String(newPrice)); await priceInput.press('Tab');
await ap.waitForFunction(() => !SCG.syncing(), null, { timeout: 15000 }); await ap.waitForTimeout(300);
const after = await (await fetch(API + '/api/v1/products/mens-12')).json();
check('admin inline price edit is saved in PostgreSQL', after.price === newPrice, before.price + ' → ' + after.price);
const other = await ctx(); const op = await page(other, 'other-device');
await op.goto(withApi('#p/mens-12')); await op.waitForSelector('.pdp, .price, h1', { timeout: 15000 }); await op.waitForTimeout(600);
check('a different browser sees the new price', (await op.textContent('body')).includes(newPrice.toLocaleString('en-US')));
// product form edit: name + photo upload
await ap.evaluate(() => { location.hash = 'products/edit:mens-12'; }); await ap.waitForSelector('#modal.open form', { timeout: 10000 });
const sizeInputs = await ap.$$('#modal input[data-size]');
check('product form shows stock per size', sizeInputs.length >= 3);
check('rating/reviews/sold cannot be typed in', !(await ap.isVisible('#modal input[name=rating]')));
await ap.fill('#modal input[name=name]', before.name + ' (Edited)');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(OUT + '/pixel.png', png);
const fileInput = await ap.$('#modal input[type=file][multiple], #modal input[type=file]');
if (fileInput) { await fileInput.setInputFiles(OUT + '/pixel.png'); await ap.waitForTimeout(800); }
await ap.click('#modal button:has-text("Save Changes")');
await ap.waitForFunction(() => !SCG.syncing(), null, { timeout: 20000 }); await ap.waitForTimeout(500);
const edited = await (await fetch(API + '/api/v1/products/mens-12')).json();
check('product form edit saved (name)', edited.name === before.name + ' (Edited)');
check('photo uploaded to the server (not stored as base64)', !!edited.images[0] && /^https?:\/\//.test(edited.images[0]) && !edited.images[0].startsWith('data:'), edited.images[0] || 'no image');
const img = edited.images[0] ? await fetch(edited.images[0]) : null;
check('uploaded photo is served', !!img && img.status === 200 && /image\//.test(img.headers.get('content-type') || ''));

// ---------- 3. guest Cash on Delivery order ----------
await sp.goto(withApi('#p/mens-1')); await sp.waitForTimeout(800);
await cartWith(sp, 'mens-1');
await sp.waitForSelector('#placeBtn:not([disabled])', { timeout: 15000 });
await sp.fill('#co [name=name]', 'Test Buyer'); await sp.fill('#co [name=phone]', '0771234567'); await sp.fill('#co [name=address]', '12 Temple Road'); await sp.fill('#co [name=city]', 'Kandy');
await sp.selectOption('#co [name=district]', 'Kandy');
await sp.check('#co input[value="Cash on Delivery"]');
await sp.screenshot({ path: OUT + '/api-checkout-desktop.jpg', type: 'jpeg', quality: 70 });
await sp.click('#placeBtn'); await sp.waitForSelector('.success', { timeout: 15000 });
const codNo = (await sp.textContent('.success')).match(/SC-\d{6}-[A-Z0-9]{6}/)?.[0];
check('guest COD order placed (server order number)', !!codNo, codNo);
await sp.click('a:has-text("Track order")'); await sp.waitForSelector('#ordBox h2', { timeout: 15000 }); await sp.waitForTimeout(800);
check('buyer sees the order with the private token on this device', (await sp.textContent('#ordBox')).includes('Pay on delivery'));
const third = await ctx(); const tp = await page(third, 'stranger');
await tp.goto(withApi('#order/' + codNo)); await tp.waitForTimeout(1500);
check('another device cannot open the order by number alone', !(await tp.textContent('#app')).includes('12 Temple Road'));
await ap.evaluate(() => { location.hash = 'orders'; }); await ap.waitForTimeout(1200);
check('the order appears in the admin panel', (await ap.textContent('#olist')).includes(codNo));

// ---------- 4. card payment: redirect is NOT payment; only the signed server notification is ----------
await ap.evaluate(() => { location.hash = 'settings'; }); await ap.waitForSelector('#dform input[name=payOnline]', { timeout: 10000 });
await ap.check('#dform input[name=payOnline]', { force: true }); await ap.click('#dform button.primary');
await ap.waitForFunction(() => !SCG.syncing(), null, { timeout: 15000 }); await ap.waitForTimeout(300);
check('owner switches on card payments in Store Settings', (await (await fetch(API + '/api/v1/site-content')).json()).payOnline === true);
await sp.goto(withApi('')); await sp.waitForSelector('.card', { timeout: 15000 });
await cartWith(sp, 'womens-5');
await sp.waitForSelector('#placeBtn:not([disabled])', { timeout: 15000 });
await sp.fill('#co [name=name]', 'Card Buyer'); await sp.fill('#co [name=phone]', '0771234568'); await sp.fill('#co [name=email]', 'card@example.com');
await sp.fill('#co [name=address]', '5 Lake Road'); await sp.fill('#co [name=city]', 'Galle'); await sp.selectOption('#co [name=district]', 'Galle');
await sp.check('#co input[value="Card"]');
await sp.click('#placeBtn'); await sp.waitForURL(/payhere\.lk/, { timeout: 15000 });
const fields = Object.fromEntries(new URLSearchParams(shopper._payhere || ''));
check('browser is sent to PayHere sandbox with a server-made hash', !!fields.hash && fields.merchant_id === MID && /^\d+\.\d\d$/.test(fields.amount));
check('merchant secret is not in the browser', !(shopper._payhere || '').includes(SECRET));
await sp.goto(withApi('#order/' + fields.order_id)); await sp.waitForSelector('#ordBox h2', { timeout: 15000 }); await sp.waitForTimeout(800);
check('return page shows "waiting for PayHere", not paid', /Waiting for PayHere/i.test(await sp.textContent('#ordBox')));
const sig = md5U(MID + fields.order_id + fields.amount + 'LKR' + '2' + md5U(SECRET));
const n = await fetch(API + '/api/v1/payments/payhere/notify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ merchant_id: MID, order_id: fields.order_id, payment_id: '320099' + Date.now() % 1000, payhere_amount: fields.amount, payhere_currency: 'LKR', status_code: '2', md5sig: sig, method: 'VISA', card_no: '************1292' }) });
check('signed PayHere notification accepted', n.status === 200);
await sp.waitForFunction(() => /Payment received/.test(document.querySelector('#ordBox')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
check('order page updates to paid after the notification', /Payment received/.test(await sp.textContent('#ordBox')));

// ---------- 5. customer account ----------
const acc = await ctx(); const cp = await page(acc, 'customer');
await cp.goto(withApi('#account')); await cp.waitForSelector('#regF', { timeout: 15000 });
const email = 'e2e-' + Date.now() + '@example.com';
await cp.fill('#regF [name=name]', 'E2E Customer'); await cp.fill('#regF [name=email]', email); await cp.fill('#regF [name=password]', 'E2e-Customer-Pass-1');
await cp.click('#regF button:not(.pw-eye)'); await cp.waitForSelector('#profForm', { timeout: 15000 });
check('customer can create an account', (await cp.textContent('.acct-head')).includes('E2E'));
await cp.reload(); await cp.waitForTimeout(1500); await cp.evaluate(() => { location.hash = 'account'; }); await cp.waitForTimeout(800);
check('customer stays signed in after reload (server session)', !!(await cp.$('#profForm')));

// ---------- 6. mobile ----------
const mob = await ctx({ ...devices['iPhone 13'] }); const mp = await page(mob, 'mobile');
await mp.goto(withApi('')); await mp.waitForSelector('.card', { timeout: 15000 }); await mp.waitForTimeout(800);
const ow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
check('mobile home has no sideways scrolling', ow <= 1, 'overflow ' + ow + 'px');
await mp.screenshot({ path: OUT + '/api-home-mobile.jpg', type: 'jpeg', quality: 70 });
await cartWith(mp, 'mens-2'); await mp.waitForSelector('#placeBtn:not([disabled])', { timeout: 15000 });
check('mobile checkout has no sideways scrolling', (await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await mp.screenshot({ path: OUT + '/api-checkout-mobile.jpg', type: 'jpeg', quality: 70 });
const mad = await ctx({ ...devices['iPhone 13'] }); const map = await page(mad, 'mobile-admin');
await map.goto(withApi('admin/')); await map.fill('input[name=user]', USER); await map.fill('input[name=pass]', PASS); await map.click('#loginForm button:not(.pw-eye)');
await map.waitForSelector('#shell:not([hidden])', { timeout: 15000 }); await map.waitForTimeout(1200);
check('admin works on a phone (no sideways scrolling)', (await map.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await map.screenshot({ path: OUT + '/api-admin-mobile.jpg', type: 'jpeg', quality: 70 });

check('no JavaScript errors in any page', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
