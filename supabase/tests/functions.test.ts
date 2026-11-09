import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { md5Hex } from '../functions/_shared/md5.ts';
import { cfg, anon, staff, rpc, q1, db, setStock, stock, order, guest } from './helpers.js';

const SECRET = 'local-test-secret-not-real', MID = '1211149';   // from supabase/functions/.env (test values only)
const md5U = (s: string) => crypto.createHash('md5').update(s).digest('hex').toUpperCase();
const fn = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${cfg().url}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg().anon, authorization: `Bearer ${cfg().anon}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const notifyBody = (num: string, amount: string, status: number, opts: { secret?: string; currency?: string; merchant?: string; paymentId?: string } = {}) => {
  const m = opts.merchant ?? MID, cur = opts.currency ?? 'LKR';
  return new URLSearchParams({ merchant_id: m, order_id: num, payment_id: opts.paymentId ?? String(Date.now()).slice(-9), payhere_amount: amount, payhere_currency: cur,
    status_code: String(status), md5sig: md5U(m + num + amount + cur + status + md5U(opts.secret ?? SECRET)), method: 'VISA', card_no: '************1292' }).toString();
};
const notify = (body: string) => fetch(`${cfg().url}/functions/v1/payhere-notify`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });

describe('MD5 used for PayHere signatures', () => {
  it('matches Node crypto for ASCII, Unicode and long input', () => {
    for (const s of ['', 'a', 'abc', 'message digest', '1211149SC-261109-ABCDEF1000.00LKR2', 'සිංහල ✓ 漢字', 'x'.repeat(1000)])
      expect(md5Hex(s)).toBe(crypto.createHash('md5').update(s).digest('hex'));
  });
});

describe('checkout Edge Function', () => {
  it('guest Cash on Delivery order (201) with server prices', async () => {
    await setStock('MENS-11-M', 5);
    const r = await fn('checkout', { items: [{ id: 'mens-11', size: 'M', qty: 1 }], customer: guest, payment: 'cod' });
    expect(r.status).toBe(201);
    const o = await r.json();
    expect(o.orderNumber).toMatch(/^SC-/); expect(o.status).toBe('confirmed');
    expect(await stock('MENS-11-M')).toEqual({ on_hand: 4, reserved: 0 });
  });
  it('card order: PayHere fields + hash made on the server, secret never sent; return URL alone is not payment', async () => {
    await setStock('MENS-12-M', 5);
    const r = await fn('checkout', { items: [{ id: 'mens-12', size: 'M', qty: 1 }], customer: guest, payment: 'payhere' });
    expect(r.status).toBe(201);
    const text = await r.text(); const o = JSON.parse(text);
    expect(text).not.toContain(SECRET);
    const f = o.payhere.fields;
    expect(o.payhere.action).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(f.hash).toBe(md5U(MID + o.orderNumber + f.amount + 'LKR' + md5U(SECRET)));
    expect(f.notify_url).toMatch(/\/functions\/v1\/payhere-notify$/);
    expect(await order(o.orderNumber)).toMatchObject({ status: 'pending_payment', payment_status: 'pending' });
  });
  it('maps database errors to clear HTTP answers', async () => {
    expect((await fn('checkout', { items: [{ id: 'mens-1', size: 'M', qty: 1 }], customer: { ...guest, phone: '1' }, payment: 'cod' })).status).toBe(400);
    expect((await fn('checkout', { items: [{ id: 'mens-1', size: 'M', qty: 1 }], customer: { ...guest, email: '' }, payment: 'payhere' })).status).toBe(400);
    await setStock('MENS-12-L', 0);
    const so = await fn('checkout', { items: [{ id: 'mens-12', size: 'L', qty: 1 }], customer: guest, payment: 'cod' });
    expect(so.status).toBe(409); expect((await so.json()).error).toBe('stock_changed');
    expect((await fn('checkout', 'not json')).status).toBe(400);
    expect((await fn('checkout', { items: [], customer: guest, payment: 'cod' }, { authorization: 'Bearer forged.token.value' })).status).toBe(401);
  });
  it('CORS logic of the functions: only the shop website origin is echoed (unit test of _shared/common.ts)', async () => {
    // The LOCAL gateway (Kong) adds "Access-Control-Allow-Origin: *" itself, so this checks the function code directly.
    // Sign-in uses bearer tokens (no cookies), so CORS is not the security boundary; hosted gateway behaviour is verified on staging.
    (globalThis as any).Deno = { env: { get: (k: string) => ({ SITE_ORIGINS: 'http://127.0.0.1:8000' } as any)[k] } };
    const { cors, clientIp } = await import('../functions/_shared/common.ts');
    expect(cors(new Request('http://x', { headers: { origin: 'http://127.0.0.1:8000' } }))['access-control-allow-origin']).toBe('http://127.0.0.1:8000');
    expect(cors(new Request('http://x', { headers: { origin: 'https://evil.example' } }))['access-control-allow-origin']).toBeUndefined();
    // rate limits use the gateway-added (last) X-Forwarded-For entry, not the caller-controlled first one
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }))).toBe('203.0.113.9');
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' } }))).toBe('198.51.100.7');
  });
});

describe('payhere-notify Edge Function (md5sig checked with the server secret)', () => {
  async function card(_sku: string, slug: string, _size: string) {
    // use a size that really exists for this product
    const v = await q1(`SELECT v.sku, v.size FROM app.product_variants v JOIN app.products p ON p.id = v.product_id WHERE p.slug = $1 AND v.active ORDER BY v.sort_order LIMIT 1`, [slug]);
    const sku = v.sku, size = v.size;
    await setStock(sku, 5);
    const o = await (await fn('checkout', { items: [{ id: slug, size, qty: 1 }], customer: guest, payment: 'payhere' })).json();
    return o;
  }
  it('a correctly signed success marks the order paid (once, even if sent three times)', async () => {
    const o = await card('WOMENS-7-M', 'womens-7', 'M');
    const body = notifyBody(o.orderNumber, o.payhere.fields.amount, 2, { paymentId: '320055501' });
    const rs = await Promise.all([notify(body), notify(body), notify(body)]);
    expect(rs.map(r => r.status)).toEqual([200, 200, 200]);
    expect(await order(o.orderNumber)).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect(await stock((await q1(`SELECT v.sku FROM app.product_variants v JOIN app.products p ON p.id = v.product_id WHERE p.slug = 'womens-7' AND v.active ORDER BY v.sort_order LIMIT 1`)).sku)).toEqual({ on_hand: 4, reserved: 0 });
  });
  it('wrong secret, other merchant, wrong amount/currency or no signature are rejected (400) and change nothing', async () => {
    const o = await card('WOMENS-8-M', 'womens-8', 'M');
    const amt = o.payhere.fields.amount;
    for (const b of [notifyBody(o.orderNumber, amt, 2, { secret: 'attacker-guess' }), notifyBody(o.orderNumber, amt, 2, { merchant: '9999999' }),
      notifyBody(o.orderNumber, '1.00', 2), notifyBody(o.orderNumber, amt, 2, { currency: 'USD' }), `order_id=${o.orderNumber}&status_code=2`])
      expect((await notify(b)).status).toBe(400);
    expect(await order(o.orderNumber)).toMatchObject({ status: 'pending_payment', payment_status: 'pending' });
    expect((await fetch(`${cfg().url}/functions/v1/payhere-notify`)).status).toBe(405);
  });
});

describe('track-order Edge Function', () => {
  it('token = details; guess = 404; too many tries = 429 even when the caller fakes X-Forwarded-For', async () => {
    await setStock('WOMENS-9-M', 5);
    const o = await (await fn('checkout', { items: [{ id: 'womens-9', size: 'M', qty: 1 }], customer: guest, payment: 'cod' })).json();
    const okr = await fn('track-order', { number: o.orderNumber, token: o.trackingToken }, { 'x-forwarded-for': '10.1.0.1' });
    expect(okr.status).toBe(200); expect((await okr.json()).customer.address).toBe(guest.address);
    expect((await fn('track-order', { number: o.orderNumber, token: 'guessing-guessing' }, { 'x-forwarded-for': '10.1.0.2' })).status).toBe(404);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await fn('track-order', { number: o.orderNumber, phone: '07' + i }, { 'x-forwarded-for': `10.9.${i}.1` })).status;
    expect(last).toBe(429);
  });
});

describe('admin-staff Edge Function', () => {
  it('owner creates staff; temporary password gives no access until changed; support cannot create; no half-made accounts', async () => {
    const owner = await staff('owner1');
    const tok = (await owner.auth.getSession()).data.session!.access_token;
    const call = (body: unknown, t = tok) => fetch(`${cfg().url}/functions/v1/admin-staff`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg().anon, authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
    const uname = 'packer' + Date.now().toString().slice(-6);
    expect((await call({ action: 'create', username: uname, displayName: 'Packer', email: `${uname}@staff.test`, roles: ['fulfillment'], temporaryPassword: 'short' })).status).toBe(400);
    const c = await call({ action: 'create', username: uname, displayName: 'Packer', email: `${uname}@staff.test`, roles: ['fulfillment'], temporaryPassword: 'Temporary-Pass-77' });
    expect(c.status).toBe(200);
    const nu = anon();
    expect((await nu.auth.signInWithPassword({ email: `${uname}@staff.test`, password: 'Temporary-Pass-77' })).error).toBeNull();
    expect((await rpc(nu, 'admin_orders')).error?.hint).toBe('password_change_required');
    const ntok = (await nu.auth.getSession()).data.session!.access_token;
    expect((await call({ action: 'change-own-password', currentPassword: 'Temporary-Pass-77', newPassword: 'My-Own-Strong-Pass-1' }, ntok)).status).toBe(200);
    const nu2 = anon();
    expect((await nu2.auth.signInWithPassword({ email: `${uname}@staff.test`, password: 'My-Own-Strong-Pass-1' })).error).toBeNull();
    expect((await rpc(nu2, 'admin_orders')).error).toBeNull();
    // support cannot create staff, and no sign-in account is left behind
    const sup = await staff('support1');
    const stok = (await sup.auth.getSession()).data.session!.access_token;
    const before = (await q1(`SELECT count(*)::int n FROM auth.users`)).n;
    expect((await call({ action: 'create', username: 'x' + uname, displayName: 'X', roles: ['owner'], temporaryPassword: 'Temporary-Pass-88' }, stok)).status).toBe(403);
    expect((await q1(`SELECT count(*)::int n FROM auth.users`)).n).toBe(before);
    // disabling: blocked in the database immediately, even with a still-valid token
    const id = (await q1(`SELECT id FROM app.staff_users WHERE username = $1`, [uname])).id;
    expect((await call({ action: 'update', id, status: 'disabled' })).status).toBe(200);
    expect((await rpc(nu2, 'admin_orders')).error).not.toBeNull();
    expect((await anon().auth.signInWithPassword({ email: `${uname}@staff.test`, password: 'My-Own-Strong-Pass-1' })).error).not.toBeNull();
  });
  it('needs a signed-in caller', async () => {
    expect((await fetch(`${cfg().url}/functions/v1/admin-staff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
  });
});
