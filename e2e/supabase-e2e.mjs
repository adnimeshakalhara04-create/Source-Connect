// Browser end-to-end test of the storefront + admin against a LOCAL Supabase stack (never production).
// Prereqs: `supabase start` + `supabase db reset`, Edge Functions served with supabase/functions/.env (test values),
// the repository served on $SITE (default http://127.0.0.1:8000).
// Usage: node e2e/supabase-e2e.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
const req = createRequire(import.meta.url);
const { chromium, devices } = req('playwright');
const { authenticator } = createRequire(new URL('../supabase/tests/package.json', import.meta.url))('otplib');
const env = Object.fromEntries(execSync('npx -y supabase@2 status -o env', { cwd: new URL('..', import.meta.url).pathname }).toString().split('\n')
  .map(l => /^([A-Z_]+)="(.*)"$/.exec(l)).filter(Boolean).map(m => [m[1], m[2]]));
const SB = env.API_URL, ANON = env.ANON_KEY, SERVICE = env.SERVICE_ROLE_KEY;
if (!/^http:\/\/127\.0\.0\.1/.test(SB)) throw new Error('refusing to run against a non-local Supabase');
const SITE = process.env.SITE || 'http://127.0.0.1:8000';
const MID = '1211149', SECRET = 'local-test-secret-not-real';   // supabase/functions/.env test values
const OUT = 'e2e/out'; fs.mkdirSync(OUT, { recursive: true });
const results = []; let failed = 0; const errors = [];
const check = (name, ok, extra = '') => { results.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!ok) failed++; };
const md5U = s => crypto.createHash('md5').update(s).digest('hex').toUpperCase();
process.on('uncaughtException', e => { console.log(results.join('\n')); console.log('CRASH: ' + String(e && e.message || e).split('\n')[0]); console.log('errors: ' + errors.join(' | ')); process.exit(1); });
process.on('unhandledRejection', e => { console.log(results.join('\n')); console.log('CRASH: ' + String(e && e.message || e).split('\n')[0]); console.log('errors: ' + errors.join(' | ')); process.exit(1); });
const rpc = async (fn, args = {}) => (await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify(args) })).json();

// ---- owner account for the test (Supabase Auth + staff row), MFA required as in production ----
const OWNER = { email: 'owner-e2e@staff.test', password: 'Owner-E2e-Pass-2026' };
const sql = (q) => execSync(`psql "${env.DB_URL}" -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
let ownerId = sql(`SELECT id FROM auth.users WHERE email = '${OWNER.email}'`);
if (!ownerId) {
  const r = await (await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER.email, password: OWNER.password, email_confirm: true, app_metadata: { kind: 'staff' } }) })).json();
  ownerId = r.id;
  sql(`INSERT INTO app.staff_users (id, username, email, display_name) VALUES ('${ownerId}', 'ownere2e', '${OWNER.email}', 'E2E Owner')`);
  sql(`INSERT INTO app.staff_roles (staff_id, role_id) SELECT '${ownerId}', id FROM app.roles WHERE code = 'owner'`);
}
sql(`DELETE FROM auth.mfa_factors WHERE user_id = '${ownerId}'`);   // enrol a fresh authenticator every run
sql(`DELETE FROM app.rate_limits`);
sql(`DELETE FROM app.product_costs WHERE product_id = (SELECT id FROM app.products WHERE slug = 'mens-1')`);   // the report test enters this cost itself   // the API tests and this browser share one local gateway IP, so start with clean limiter counters
sql(`UPDATE app.security_settings SET require_staff_mfa = true`);
sql(`UPDATE app.ops_settings SET payhere_configured = true`);

const b = await chromium.launch();
async function ctx(opts = {}) {
  const c = await b.newContext({ viewport: { width: 1366, height: 860 }, ...opts });
  await c.addInitScript(() => { try { sessionStorage.setItem('scg_intro_seen', '1'); localStorage.setItem('scg_intro_seen', '1'); } catch (e) {} });
  await c.route('https://sandbox.payhere.lk/**', async r => { c._payhere = r.request().postData(); await r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>PayHere sandbox (stub)</h1>' }); });
  return c;
}
const page = async (c, name) => { const p = await c.newPage(); p.on('pageerror', e => errors.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text().slice(0, 160)); }); return p; };
const withSb = (path) => { const i = path.indexOf('#'); const p = i < 0 ? path : path.slice(0, i), h = i < 0 ? '' : path.slice(i); return `${SITE}/${p}${p.includes('?') ? '&' : '?'}supabase=${encodeURIComponent(SB)}&anon=${encodeURIComponent(ANON)}${h}`; };
const inStock = async (slug) => { const p = await rpc('get_product', { p_slug: slug }); const v = (p.variants || []).slice().sort((a, b) => b.stock - a.stock)[0]; return v ? v.size : ''; };
const cartWith = async (pg, slug) => { const size = await inStock(slug); await pg.evaluate(([id, sz]) => { SCG.saveCart([{ id, size: sz, qty: 1, sel: true }]); location.hash = 'checkout'; }, [slug, size]); };

// 1. storefront from Supabase
const shopper = await ctx(); const sp = await page(shopper, 'shop');
await sp.goto(withSb('')); await sp.waitForSelector('.card', { timeout: 20000 });
check('storefront renders products from Supabase', (await sp.$$('.card')).length > 10);
await sp.screenshot({ path: OUT + '/sb-home-desktop.jpg', type: 'jpeg', quality: 70 });

// 2. admin: password, then two-step sign-in (QR/secret shown, code from an authenticator)
const adminC = await ctx(); const ap = await page(adminC, 'admin');
const toasts = []; await ap.exposeFunction('__toast', t => toasts.push(t)); await ap.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { new MutationObserver(() => { const t = document.getElementById('toast'); if (t && t.textContent) window.__toast(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); }); });
await ap.goto(withSb('admin/'));
await ap.fill('input[name=user]', 'admin'); await ap.fill('input[name=pass]', 'admin123'); await ap.click('#loginForm button:not(.pw-eye)'); await ap.waitForTimeout(1200);
check('old default login is refused', /incorrect/i.test(await ap.textContent('#loginErr')));
await ap.fill('input[name=user]', OWNER.email); await ap.fill('input[name=pass]', OWNER.password); await ap.click('#loginForm button:not(.pw-eye)');
await ap.waitForSelector('#mfaHelp', { timeout: 15000 });
await ap.waitForFunction(() => /scan|authenticator/i.test(document.querySelector('#mfaHelp')?.textContent || ''), null, { timeout: 15000 });
let secret = (await ap.textContent('#mfaQr').catch(() => '')).match(/key:\s*([A-Z2-7]{16,})/)?.[1];
check('staff must set up two-step sign-in (QR + key shown)', !!secret || /authenticator app/i.test(await ap.textContent('#mfaHelp')));
await ap.fill('input[name=code]', authenticator.generate(secret)); await ap.click('#loginForm button.primary');
await ap.waitForSelector('#shell:not([hidden])', { timeout: 20000 }); await ap.waitForTimeout(1500);
check('owner reaches the dashboard after the 6-digit code', await ap.isVisible('#shell'));
await ap.screenshot({ path: OUT + '/sb-admin-dashboard.jpg', type: 'jpeg', quality: 70 });

// 3. inline price edit saved in Supabase and seen on ANOTHER device
const before = await rpc('get_product', { p_slug: 'mens-12' });
const newPrice = before.price + 10;
await ap.evaluate(() => { location.hash = 'products'; }); await ap.waitForTimeout(1000);
await ap.fill('#pq', before.name); await ap.waitForTimeout(500);
const priceInput = ap.locator('#ptb tr[data-id="mens-12"] [data-f=price]');
await priceInput.fill(String(newPrice)); await priceInput.press('Tab');
await ap.waitForFunction(() => !SCG.syncing(), null, { timeout: 20000 }); await ap.waitForTimeout(400);
check('admin price edit saved in Supabase', (await rpc('get_product', { p_slug: 'mens-12' })).price === newPrice);
const other = await ctx(); const op = await page(other, 'other-device');
await op.goto(withSb('#p/mens-12')); await op.waitForTimeout(2500);
check('a different browser sees the new price', (await op.textContent('body')).includes(newPrice.toLocaleString('en-US')));

// 4. product form: stock per size, no fake ratings, photo to Supabase Storage
await ap.evaluate(() => { location.hash = 'products/edit:mens-12'; }); await ap.waitForSelector('#modal.open form', { timeout: 15000 });
check('product form shows stock per size', (await ap.$$('#modal input[data-size]')).length >= 3);
check('rating/reviews/sold cannot be typed in', !(await ap.isVisible('#modal input[name=rating]')));
await ap.fill('#modal input[name=name]', before.name + ' (Edited)');
fs.writeFileSync(OUT + '/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const fileInput = await ap.$('#modal input[type=file]');
if (fileInput) { await fileInput.setInputFiles(OUT + '/pixel.png'); await ap.waitForTimeout(1000); }
await ap.click('#modal button:has-text("Save Changes")');
await ap.waitForFunction(() => !SCG.syncing(), null, { timeout: 25000 }); await ap.waitForTimeout(600);
const edited = await rpc('get_product', { p_slug: 'mens-12' });
check('product form edit saved (name)', edited.name === before.name + ' (Edited)');
check('photo stored in Supabase Storage (not base64)', !!edited.images[0] && edited.images[0].includes('/storage/v1/object/public/product-images/'), edited.images[0] || 'none');
check('uploaded photo is served', !!edited.images[0] && (await fetch(edited.images[0])).status === 200);

// 5. guest COD order through the checkout Edge Function
await sp.goto(withSb('#p/mens-1')); await sp.waitForTimeout(1500);
await cartWith(sp, 'mens-1');
await sp.waitForSelector('#placeBtn:not([disabled])', { timeout: 20000 });
await sp.fill('#co [name=name]', 'Test Buyer'); await sp.fill('#co [name=phone]', '0771234567'); await sp.fill('#co [name=address]', '12 Temple Road'); await sp.fill('#co [name=city]', 'Kandy');
await sp.selectOption('#co [name=district]', 'Kandy'); await sp.check('#co input[value="Cash on Delivery"]');
await sp.click('#placeBtn'); await sp.waitForSelector('.success', { timeout: 20000 });
const codNo = (await sp.textContent('.success')).match(/SC-\d{6}-[A-Z0-9]{6}/)?.[0];
check('guest COD order placed', !!codNo, codNo);
await sp.click('a:has-text("Track order")'); await sp.waitForSelector('#ordBox h2', { timeout: 20000 }); await sp.waitForTimeout(1500);
check('buyer sees the order on this device (private token)', (await sp.textContent('#ordBox')).includes('Pay on delivery'));
const third = await ctx(); const tp = await page(third, 'stranger');
await tp.goto(withSb('#order/' + codNo)); await tp.waitForTimeout(2500);
check('another device cannot open the order by number alone', !(await tp.textContent('#app')).includes('12 Temple Road'));
await ap.keyboard.press('Escape'); await ap.evaluate(() => { document.getElementById('modal').classList.remove('open'); location.hash = 'orders'; }); await ap.waitForTimeout(1800);
check('the order appears in the admin panel', (await ap.textContent('#olist')).includes(codNo));

// 6. card payment: redirect is not payment; only the signed notification is
await ap.evaluate(() => { location.hash = 'settings'; }); await ap.waitForSelector('#dform input[name=payOnline]', { timeout: 15000 });
await ap.check('#dform input[name=payOnline]', { force: true }); await ap.click('#dform button.primary');
await ap.waitForFunction(() => !SCG.syncing(), null, { timeout: 20000 }); await ap.waitForTimeout(500);
console.log('admin toasts:', [...new Set(toasts)].slice(-8).join(' | '));
check('owner switches on card payments', (await rpc('storefront_snapshot')).settings.payOnline === true);
await sp.goto(withSb('')); await sp.waitForSelector('.card', { timeout: 20000 });
await cartWith(sp, 'womens-5');
await sp.waitForSelector('#placeBtn:not([disabled])', { timeout: 20000 });
await sp.fill('#co [name=name]', 'Card Buyer'); await sp.fill('#co [name=phone]', '0771234568'); await sp.fill('#co [name=email]', 'card@example.com');
await sp.fill('#co [name=address]', '5 Lake Road'); await sp.fill('#co [name=city]', 'Galle'); await sp.selectOption('#co [name=district]', 'Galle');
await sp.check('#co input[value="Card"]');
await sp.click('#placeBtn'); await sp.waitForURL(/payhere\.lk/, { timeout: 20000 });
const f = Object.fromEntries(new URLSearchParams(shopper._payhere || ''));
check('sent to PayHere sandbox with the server-made hash', f.hash === md5U(MID + f.order_id + f.amount + 'LKR' + md5U(SECRET)));
check('merchant secret is not in the browser', !(shopper._payhere || '').includes(SECRET));
await sp.goto(withSb('#order/' + f.order_id)); await sp.waitForSelector('#ordBox h2', { timeout: 20000 }); await sp.waitForTimeout(1500);
check('return page waits for PayHere (not paid)', /Waiting for PayHere/i.test(await sp.textContent('#ordBox')));
const nr = await fetch(`${SB}/functions/v1/payhere-notify`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ merchant_id: MID, order_id: f.order_id, payment_id: String(Date.now()).slice(-9), payhere_amount: f.amount, payhere_currency: 'LKR', status_code: '2', md5sig: md5U(MID + f.order_id + f.amount + 'LKR2' + md5U(SECRET)), method: 'VISA', card_no: '************1292' }) });
check('signed notification accepted by the Edge Function', nr.status === 200);
await sp.waitForFunction(() => /Payment received/.test(document.querySelector('#ordBox')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
check('order page turns to paid', /Payment received/.test(await sp.textContent('#ordBox')));

// 6b. sales & profit report (owner): cost price entry, numbers match the database, best/least sellers, CSV
await ap.evaluate(() => { location.hash = 'reports/costs'; }); await ap.waitForSelector('[data-cost="mens-1"]', { timeout: 15000 });
check('owner sees the Sales & Profit menu', await ap.isVisible('#sideNav a[data-v=reports]'));
await ap.fill('[data-cost="mens-1"]', '800'); await ap.check('#cPast'); await ap.click('[data-save="mens-1"]');
await ap.waitForFunction(() => /Cost saved/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
check('cost price saved by the owner', sql(`SELECT c.cost_cents FROM app.product_costs c JOIN app.products p ON p.id = c.product_id WHERE p.slug = 'mens-1'`) === '80000');
check('cost used for the earlier COD sale that had none', sql(`SELECT count(*) FROM app.order_item_cost_fills f JOIN app.order_items i ON i.id = f.order_item_id JOIN app.orders o ON o.id = i.order_id WHERE o.order_number = '${codNo}'`) === '1');
await ap.evaluate(() => { location.hash = 'reports'; }); await ap.waitForSelector('#rpPre [data-pre=today]', { timeout: 15000 });
await ap.click('#rpPre [data-pre=today]'); await ap.waitForSelector('#rpOut .stats', { timeout: 20000 });
// expected values straight from the order tables (independent of the report function)
const exp = JSON.parse(sql(`SELECT json_build_object('orders', count(*), 'net', coalesce(sum(subtotal_cents - discount_cents), 0), 'received', coalesce(sum(total_cents) FILTER (WHERE payment_status IN ('paid','cod_collected')), 0)) FROM app.orders WHERE (placed_at AT TIME ZONE 'Asia/Colombo')::date = (now() AT TIME ZONE 'Asia/Colombo')::date AND status NOT IN ('pending_payment','cancelled','expired','refunded')`));
const fmt = (cents) => { const n = cents / 100; return 'Rs. ' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
const statText = await ap.$$eval('#rpOut .stat', els => Object.fromEntries(els.map(e => [e.querySelector('small').textContent.replace(/ \(-?[0-9.]+%\)$/, ''), e.querySelector('b').textContent.trim()])));
check('report: number of orders today matches the database', statText['Orders'] === String(exp.orders), `${statText['Orders']} vs ${exp.orders}`);
check('report: sales after discounts match the database', statText['Sales (after discounts)'] === fmt(exp.net), `${statText['Sales (after discounts)']} vs ${fmt(exp.net)}`);
check('report: money received matches the database', statText['Money received'] === fmt(exp.received), `${statText['Money received']} vs ${fmt(exp.received)}`);
check('report: best sellers and least sold are listed', (await ap.$$('#rpTop tbody tr a')).length >= 2 && (await ap.$$('#rpLeast tbody tr')).length === 10);
const [dl] = await Promise.all([ap.waitForEvent('download', { timeout: 15000 }), ap.click('#rpCsv')]);
const csv = fs.readFileSync(await dl.path(), 'utf8');
check('report downloads as a spreadsheet (CSV)', csv.includes('Sales after discounts') && csv.includes(exp.orders ? 'Best seller' : 'Orders'));
await ap.screenshot({ path: OUT + '/sb-admin-reports.jpg', type: 'jpeg', quality: 70, fullPage: true });
await ap.setViewportSize({ width: 390, height: 844 }); await ap.waitForTimeout(500);
check('report page on a phone: no sideways scrolling', (await ap.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
  await ap.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.table-wrap'))
    .slice(0, 5).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().width)).join(' | ')));
await ap.setViewportSize({ width: 1366, height: 900 });

// 7. customer account (Supabase Auth)
const acc = await ctx(); const cp = await page(acc, 'customer');
await cp.goto(withSb('#account')); await cp.waitForSelector('#regF', { timeout: 20000 });
await cp.fill('#regF [name=name]', 'E2E Customer'); await cp.fill('#regF [name=email]', `e2e-${Date.now()}@example.com`); await cp.fill('#regF [name=password]', 'E2e-Customer-Pass-1');
await cp.click('#regF button:not(.pw-eye)'); await cp.waitForSelector('#profForm', { timeout: 20000 });
check('customer can create an account', (await cp.textContent('.acct-head')).includes('E2E'));
await cp.reload(); await cp.waitForTimeout(2500); await cp.evaluate(() => { location.hash = 'account'; }); await cp.waitForTimeout(1500);
check('customer stays signed in after reload', !!(await cp.$('#profForm')));

// 8. mobile
const mob = await ctx({ ...devices['iPhone 13'] }); const mp = await page(mob, 'mobile');
await mp.goto(withSb('')); await mp.waitForSelector('.card', { timeout: 20000 }); await mp.waitForTimeout(800);
check('mobile home: no sideways scrolling', (await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
await mp.screenshot({ path: OUT + '/sb-home-mobile.jpg', type: 'jpeg', quality: 70 });
await cartWith(mp, 'mens-2'); await mp.waitForSelector('#placeBtn:not([disabled])', { timeout: 20000 });
check('mobile checkout: no sideways scrolling', (await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);

check('no JavaScript errors in any page', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
sql(`UPDATE app.security_settings SET require_staff_mfa = false`);
console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
