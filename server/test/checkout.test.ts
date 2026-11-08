import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, Agent, json, guest } from './helpers.js';
import { releaseExpiredReservations } from '../src/orders/reservations.js';

let app: FastifyInstance;
beforeAll(async () => { ({ app } = await makeApp()); });
afterAll(async () => { await app.close(); });

const stock = async (sku: string) => (await app.db.query(`SELECT on_hand, reserved FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = $1`, [sku])).rows[0];
const setStock = (sku: string, n: number) => app.db.query(`UPDATE inventory SET on_hand = $2, reserved = 0 FROM product_variants v WHERE v.id = inventory.variant_id AND v.sku = $1`, [sku, n]);
const order = (a: Agent, items: any[], payment = 'cod', extra: any = {}) => a.post('/api/v1/orders', { items, customer: guest, payment, ...extra });

describe('server-side pricing', () => {
  it('quote uses database prices and ignores anything the browser says', async () => {
    const r = await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'mens-1', size: 'M', qty: 2 }] });
    expect(r.statusCode).toBe(200);
    const q = json(r);
    const db = (await app.db.query(`SELECT price_cents FROM products WHERE slug = 'mens-1'`)).rows[0].price_cents;
    expect(q.lines[0].price).toBe(db / 100);
    expect(q.subtotal).toBe(2 * db / 100);
    const tampered = await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'mens-1', size: 'M', qty: 2, price: 1 }] });
    expect(tampered.statusCode).toBe(400);   // unknown field rejected outright
  });
  it('free delivery threshold and fee come from shipping_rates', async () => {
    const small = json(await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'accessories-1', size: '', qty: 1 }] }));
    expect(small.shipping).toBe(350);
    const big = json(await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'mens-1', size: 'M', qty: 9 }] }));
    if (big.subtotal >= 10000) expect(big.shipping).toBe(0);
  });
  it('an order whose expected total no longer matches is refused (price changed)', async () => {
    const r = await order(new Agent(app), [{ id: 'mens-3', size: 'L', qty: 1 }], 'cod', { expectedTotal: 1 });
    expect(r.statusCode).toBe(409); expect(json(r).error).toBe('price_changed');
  });
  it('promo codes are validated and applied on the server', async () => {
    await app.db.query(`INSERT INTO coupons (code, kind, value, min_subtotal_cents) VALUES ('SAVE10','percent',10,0) ON CONFLICT DO NOTHING`);
    const q = json(await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'mens-4', size: 'M', qty: 1 }], coupon: 'save10' }));
    expect(q.coupon).toBe('SAVE10');
    expect(q.discount).toBe(Math.floor(q.subtotal * 100 * 0.1) / 100);
    const bad = json(await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'mens-4', size: 'M', qty: 1 }], coupon: 'NOPE99' }));
    expect(bad.discount).toBe(0); expect(bad.couponError).toBeTruthy();
  });
});

describe('orders and stock', () => {
  it('Cash on Delivery takes stock immediately and records it in the inventory history', async () => {
    await setStock('MENS-5-M', 5);
    const r = await order(new Agent(app), [{ id: 'mens-5', size: 'M', qty: 2 }]);
    expect(r.statusCode).toBe(201);
    const o = json(r);
    expect(o.orderNumber).toMatch(/^SC-\d{6}-[A-Z0-9]{6}$/); expect(o.trackingToken.length).toBeGreaterThan(20);
    expect(o.status).toBe('confirmed'); expect(o.paymentStatus).toBe('cod_pending');
    expect(await stock('MENS-5-M')).toEqual({ on_hand: 3, reserved: 0 });
  });
  it('asking for more than is in stock is refused', async () => {
    await setStock('MENS-6-M', 1);
    const r = await order(new Agent(app), [{ id: 'mens-6', size: 'M', qty: 2 }]);
    expect(r.statusCode).toBe(409); expect(json(r).error).toBe('stock_changed');
    expect(await stock('MENS-6-M')).toEqual({ on_hand: 1, reserved: 0 });
  });
  it('two buyers racing for the LAST item: exactly one succeeds, stock never goes below 0', async () => {
    await setStock('MENS-7-32', 1);
    const tries = await Promise.all(Array.from({ length: 8 }, (_, i) => order(new Agent(app, '10.1.1.' + (i + 1)), [{ id: 'mens-7', size: '32', qty: 1 }])));
    const codes = tries.map(t => t.statusCode).sort();
    expect(codes.filter(c => c === 201)).toHaveLength(1);
    expect(codes.filter(c => c === 409)).toHaveLength(7);
    expect(await stock('MENS-7-32')).toEqual({ on_hand: 0, reserved: 0 });
  });
  it('racing card checkouts: reservations never exceed stock', async () => {
    await setStock('MENS-8-32', 3);
    const tries = await Promise.all(Array.from({ length: 6 }, (_, i) => order(new Agent(app, '10.2.2.' + (i + 1)), [{ id: 'mens-8', size: '32', qty: 1 }], 'payhere')));
    expect(tries.filter(t => t.statusCode === 201)).toHaveLength(3);
    expect(await stock('MENS-8-32')).toEqual({ on_hand: 3, reserved: 3 });
  });
  it('the same Idempotency-Key cannot create two orders (double click / retry)', async () => {
    await setStock('MENS-9-M', 10);
    const a = new Agent(app); const key = 'idem-key-1234567890abcdef';
    const one = await a.post('/api/v1/orders', { items: [{ id: 'mens-9', size: 'M', qty: 1 }], customer: guest, payment: 'cod' }, { 'idempotency-key': key });
    const two = await a.post('/api/v1/orders', { items: [{ id: 'mens-9', size: 'M', qty: 1 }], customer: guest, payment: 'cod' }, { 'idempotency-key': key });
    expect(one.statusCode).toBe(201); expect(two.statusCode).toBe(409);
    expect(json(two).details.orderNumber).toBe(json(one).orderNumber);
    expect(await stock('MENS-9-M')).toEqual({ on_hand: 9, reserved: 0 });
  });
  it('an unpaid card order releases its stock when the reservation expires', async () => {
    await setStock('MENS-10-M', 2);
    const o = json(await order(new Agent(app), [{ id: 'mens-10', size: 'M', qty: 2 }], 'payhere'));
    expect(await stock('MENS-10-M')).toEqual({ on_hand: 2, reserved: 2 });
    await app.db.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`, [o.orderNumber]);
    expect(await releaseExpiredReservations(app.db)).toBeGreaterThanOrEqual(1);
    expect(await stock('MENS-10-M')).toEqual({ on_hand: 2, reserved: 0 });
    const row = (await app.db.query(`SELECT status, payment_status FROM orders WHERE order_number = $1`, [o.orderNumber])).rows[0];
    expect(row).toEqual({ status: 'expired', payment_status: 'cancelled' });
  });
  it('validates customer details (Sri Lankan phone, district, address)', async () => {
    const r = await new Agent(app).post('/api/v1/orders', { items: [{ id: 'mens-1', size: 'M', qty: 1 }], customer: { ...guest, phone: '12', district: 'Atlantis' }, payment: 'cod' });
    expect(r.statusCode).toBe(400);
  });
  it('disabled payment methods cannot be used', async () => {
    await app.db.query(`UPDATE payment_settings SET enabled = false WHERE method = 'bank_transfer'`);
    const r = await order(new Agent(app), [{ id: 'mens-1', size: 'M', qty: 1 }], 'bank_transfer');
    expect(r.statusCode).toBe(400);
    await app.db.query(`UPDATE payment_settings SET enabled = true WHERE method = 'bank_transfer'`);
  });
});

describe('order privacy', () => {
  it('the order number alone reveals nothing; the private token or matching phone is needed', async () => {
    await setStock('WOMENS-1-M', 5);
    const o = json(await order(new Agent(app), [{ id: 'womens-1', size: 'M', qty: 1 }]));
    expect((await new Agent(app).post('/api/v1/orders/track', { number: o.orderNumber })).statusCode).toBe(404);
    expect((await new Agent(app).post('/api/v1/orders/track', { number: o.orderNumber, token: 'guess' })).statusCode).toBe(404);
    expect((await new Agent(app).post('/api/v1/orders/track', { number: o.orderNumber, phone: '0779999999' })).statusCode).toBe(404);
    const full = json(await new Agent(app).post('/api/v1/orders/track', { number: o.orderNumber, token: o.trackingToken }));
    expect(full.customer.address).toBe(guest.address);
    const limited = json(await new Agent(app).post('/api/v1/orders/track', { number: o.orderNumber, phone: '+94 77 123 4567' }));
    expect(limited.status).toBe('confirmed'); expect(limited.customer.address).toBeUndefined();
  });
  it('customer A cannot see customer B orders', async () => {
    const reg = async (email: string) => { const a = new Agent(app); const r = await a.post('/api/v1/customers/register', { name: 'C ' + email, email, phone: '0771111111', password: 'Customer-Pass-123' }); expect(r.statusCode).toBe(200); return a; };
    const A = await reg('a-' + Date.now() + '@example.com'), B = await reg('b-' + Date.now() + '@example.com');
    await setStock('WOMENS-2-M', 5);
    const oa = json(await A.post('/api/v1/orders', { items: [{ id: 'womens-2', size: 'M', qty: 1 }], customer: guest, payment: 'cod' }));
    expect(oa.orderNumber).toBeTruthy();
    expect(json(await A.get('/api/v1/account/orders')).map((x: any) => x.number)).toContain(oa.orderNumber);
    expect(json(await B.get('/api/v1/account/orders'))).toEqual([]);
    expect((await B.get('/api/v1/account/orders/' + oa.orderNumber)).statusCode).toBe(404);
  });
  it('a signed-in customer must send the CSRF token to place orders', async () => {
    const a = new Agent(app);
    await a.post('/api/v1/customers/register', { name: 'Csrf Test', email: 'csrf-' + Date.now() + '@example.com', password: 'Customer-Pass-123' });
    const r = await a.req('POST', '/api/v1/orders', { items: [{ id: 'womens-3', size: 'M', qty: 1 }], customer: guest, payment: 'cod' }, { 'x-csrf-token': 'nope' });
    expect(r.statusCode).toBe(403);
  });
  it('email verification and password reset use single-use tokens', async () => {
    const a = new Agent(app); const email = 'verify-' + Date.now() + '@example.com';
    await a.post('/api/v1/customers/register', { name: 'Verify Me', email, password: 'Customer-Pass-123' });
    const mail = app.mailer.outbox!.filter(m => m.to === email).pop()!;
    const token = mail.text.split('#verify/')[1];
    expect((await new Agent(app).post('/api/v1/customers/verify-email', { token })).statusCode).toBe(200);
    expect((await new Agent(app).post('/api/v1/customers/verify-email', { token })).statusCode).toBe(400);
    expect(json(await a.get('/api/v1/customers/me')).customer.verified).toBe(true);
  });
});
