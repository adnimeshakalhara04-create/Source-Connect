import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, Agent, json, guest, payhereNotify, MERCHANT_ID, MERCHANT_SECRET, md5U } from './helpers.js';
import { checkoutHash } from '../src/payments/payhere.js';
import { releaseExpiredReservations } from '../src/orders/reservations.js';

let app: FastifyInstance;
beforeAll(async () => { ({ app } = await makeApp()); });
afterAll(async () => { await app.close(); });

const setStock = (sku: string, n: number) => app.db.query(`UPDATE inventory SET on_hand = $2, reserved = 0 FROM product_variants v WHERE v.id = inventory.variant_id AND v.sku = $1`, [sku, n]);
const stock = async (sku: string) => (await app.db.query(`SELECT on_hand, reserved FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = $1`, [sku])).rows[0];
const ord = async (n: string) => (await app.db.query(`SELECT status, payment_status, needs_review FROM orders WHERE order_number = $1`, [n])).rows[0];
const notify = (body: string) => app.inject({ method: 'POST', url: '/api/v1/payments/payhere/notify', payload: body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
async function cardOrder(sku: string, slug: string, size = 'M', qty = 1) {
  await setStock(sku, 5);
  const r = await new Agent(app).post('/api/v1/orders', { items: [{ id: slug, size, qty }], customer: guest, payment: 'payhere' });
  expect(r.statusCode).toBe(201);
  return json(r);
}

describe('PayHere checkout parameters', () => {
  it('hash follows the documented formula and the secret never leaves the server', async () => {
    const o = await cardOrder('KIDS-1-4-5Y', 'kids-1', '4-5Y');
    const f = o.payhere.fields;
    expect(o.payhere.action).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(f.amount).toMatch(/^\d+\.\d{2}$/);
    expect(f.hash).toBe(md5U(MERCHANT_ID + o.orderNumber + f.amount + 'LKR' + md5U(MERCHANT_SECRET)));
    expect(f.notify_url).toMatch(/\/api\/v1\/payments\/payhere\/notify$/);
    expect(JSON.stringify(o)).not.toContain(MERCHANT_SECRET);
    expect(checkoutHash('M1', 'O1', 100000, 'LKR', 's')).toBe(md5U('M1' + 'O1' + '1000.00' + 'LKR' + md5U('s')));
  });
});

describe('PayHere notifications', () => {
  it('browser return alone does NOT mark the order paid', async () => {
    const o = await cardOrder('KIDS-2-4-5Y', 'kids-2', '4-5Y');
    const t = json(await new Agent(app).post('/api/v1/orders/track', { number: o.orderNumber, token: o.trackingToken }));
    expect(t.paymentStatus).toBe('pending'); expect(t.status).toBe('pending_payment');
  });
  it('a valid success notification marks it paid and turns the reservation into a sale', async () => {
    const o = await cardOrder('KIDS-3-4-5Y', 'kids-3', '4-5Y', 2);
    expect(await stock('KIDS-3-4-5Y')).toEqual({ on_hand: 5, reserved: 2 });
    const r = await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, 2, { paymentId: '320000001' }));
    expect(r.statusCode).toBe(200); expect(r.body).toBe('OK');
    expect(await ord(o.orderNumber)).toEqual({ status: 'confirmed', payment_status: 'paid', needs_review: false });
    expect(await stock('KIDS-3-4-5Y')).toEqual({ on_hand: 3, reserved: 0 });
  });
  it('duplicate notifications (sent one after another or at the same time) change nothing twice', async () => {
    const o = await cardOrder('KIDS-4-4-5Y', 'kids-4', '4-5Y', 1);
    const body = payhereNotify(o.orderNumber, o.payhere.fields.amount, 2, { paymentId: '320000002' });
    const rs = await Promise.all([notify(body), notify(body), notify(body)]);
    expect(rs.every(r => r.statusCode === 200)).toBe(true);
    await notify(body);
    expect(await stock('KIDS-4-4-5Y')).toEqual({ on_hand: 4, reserved: 0 });
    const ev = await app.db.query(`SELECT result FROM payment_events WHERE merchant_order_ref = $1`, [o.orderNumber]);
    expect(ev.rows.map(r => r.result)).toEqual(['applied:paid']);
    const sold = (await app.db.query(`SELECT sold_count FROM products WHERE slug = 'kids-4'`)).rows[0].sold_count;
    expect(sold).toBe(1);
  });
  it('forged / wrong notifications never create a paid order', async () => {
    const o = await cardOrder('KIDS-5-4-5Y', 'kids-5', '4-5Y');
    const amt = o.payhere.fields.amount;
    const bad = [
      payhereNotify(o.orderNumber, amt, 2, { secret: 'attacker-guess' }),                      // bad signature
      payhereNotify(o.orderNumber, '1.00', 2),                                                   // wrong amount (validly signed!)
      payhereNotify(o.orderNumber, amt, 2, { currency: 'USD' }),                                 // wrong currency
      payhereNotify(o.orderNumber, amt, 2, { merchantId: '9999999' }),                           // other merchant
      payhereNotify('SC-000000-ZZZZZZ', amt, 2),                                                 // unknown order
      payhereNotify(o.orderNumber, amt, 7),                                                      // unknown status
      new URLSearchParams({ order_id: o.orderNumber, status_code: '2' }).toString(),             // no signature at all
    ];
    for (const b of bad) expect((await notify(b)).statusCode).toBe(400);
    expect(await ord(o.orderNumber)).toEqual({ status: 'pending_payment', payment_status: 'pending', needs_review: false });
    const rej = await app.db.query(`SELECT count(*)::int n FROM payment_events WHERE result LIKE 'rejected:%'`);
    expect(rej.rows[0].n).toBeGreaterThanOrEqual(6);
  });
  it('cancelled / failed payment releases the reserved stock', async () => {
    const o = await cardOrder('KIDS-6-4-5Y', 'kids-6', '4-5Y', 3);
    expect((await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, -2))).statusCode).toBe(200);
    expect(await ord(o.orderNumber)).toEqual({ status: 'cancelled', payment_status: 'failed', needs_review: false });
    expect(await stock('KIDS-6-4-5Y')).toEqual({ on_hand: 5, reserved: 0 });
  });
  it('a late "cancelled" after success never undoes the payment (out-of-order delivery)', async () => {
    const o = await cardOrder('KIDS-7-4-5Y', 'kids-7', '4-5Y');
    await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, 2, { paymentId: '320000007' }));
    expect((await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, -1, { paymentId: '320000007' }))).statusCode).toBe(200);
    expect(await ord(o.orderNumber)).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect(await stock('KIDS-7-4-5Y')).toEqual({ on_hand: 4, reserved: 0 });
  });
  it('chargeback flags the order for review without silently restocking', async () => {
    const o = await cardOrder('KIDS-8-4-5Y', 'kids-8', '4-5Y');
    await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, 2, { paymentId: '320000008' }));
    await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, -3, { paymentId: '320000008' }));
    expect(await ord(o.orderNumber)).toEqual({ status: 'confirmed', payment_status: 'chargeback', needs_review: true });
    expect(await stock('KIDS-8-4-5Y')).toEqual({ on_hand: 4, reserved: 0 });
  });
  it('payment arriving after the reservation expired: re-takes stock if available, otherwise flags for review', async () => {
    const o = await cardOrder('KIDS-9-4-5Y', 'kids-9', '4-5Y');
    await app.db.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`, [o.orderNumber]);
    await releaseExpiredReservations(app.db);
    expect(await ord(o.orderNumber)).toMatchObject({ status: 'expired' });
    await notify(payhereNotify(o.orderNumber, o.payhere.fields.amount, 2, { paymentId: '320000009' }));
    expect(await ord(o.orderNumber)).toEqual({ status: 'confirmed', payment_status: 'paid', needs_review: false });
    expect(await stock('KIDS-9-4-5Y')).toEqual({ on_hand: 4, reserved: 0 });

    const o2 = await cardOrder('KIDS-10-4-5Y', 'kids-10', '4-5Y');
    await app.db.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`, [o2.orderNumber]);
    await releaseExpiredReservations(app.db);
    await setStock('KIDS-10-4-5Y', 0);
    await notify(payhereNotify(o2.orderNumber, o2.payhere.fields.amount, 2, { paymentId: '320000010' }));
    expect(await ord(o2.orderNumber)).toEqual({ status: 'expired', payment_status: 'paid', needs_review: true });
  });
});

describe('Bank transfer and Cash on Delivery (separate workflows)', () => {
  it('bank transfer waits for finance; support staff cannot confirm it; finance can', async () => {
    await setStock('SHOES-1-40', 3);
    const o = json(await new Agent(app).post('/api/v1/orders', { items: [{ id: 'shoes-1', size: '40', qty: 1 }], customer: guest, payment: 'bank_transfer' }));
    expect(o.status).toBe('awaiting_bank_transfer'); expect(o.bankInstructions).toBeTruthy();
    expect(await stock('SHOES-1-40')).toEqual({ on_hand: 3, reserved: 1 });
    const support = await new Agent(app).staffLogin('support1');
    expect((await support.post(`/api/v1/admin/orders/${o.orderNumber}/verify-bank-transfer`, { reference: 'TRX123', confirmChecked: true })).statusCode).toBe(403);
    const fin = await new Agent(app).staffLogin('finance1');
    expect((await fin.post(`/api/v1/admin/orders/${o.orderNumber}/verify-bank-transfer`, { reference: 'TRX123' })).statusCode).toBe(400);   // must confirm they checked the bank
    expect((await fin.post(`/api/v1/admin/orders/${o.orderNumber}/verify-bank-transfer`, { reference: 'TRX123', confirmChecked: true })).statusCode).toBe(200);
    expect(await ord(o.orderNumber)).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect(await stock('SHOES-1-40')).toEqual({ on_hand: 2, reserved: 0 });
    expect((await fin.post(`/api/v1/admin/orders/${o.orderNumber}/verify-bank-transfer`, { reference: 'TRX123', confirmChecked: true })).statusCode).toBe(409);
  });
  it('COD: never "paid" until cash is recorded as collected', async () => {
    await setStock('SHOES-2-40', 3);
    const o = json(await new Agent(app).post('/api/v1/orders', { items: [{ id: 'shoes-2', size: '40', qty: 1 }], customer: guest, payment: 'cod' }));
    expect(await ord(o.orderNumber)).toMatchObject({ payment_status: 'cod_pending' });
    const fin = await new Agent(app).staffLogin('finance1');
    expect((await fin.post(`/api/v1/admin/orders/${o.orderNumber}/cod-collected`)).statusCode).toBe(200);
    expect(await ord(o.orderNumber)).toMatchObject({ payment_status: 'cod_collected' });
  });
  it('cancelling a COD order puts stock back; paid orders need a refund by finance', async () => {
    await setStock('SHOES-3-40', 3);
    const o = json(await new Agent(app).post('/api/v1/orders', { items: [{ id: 'shoes-3', size: '40', qty: 2 }], customer: guest, payment: 'cod' }));
    const ful = await new Agent(app).staffLogin('fulfil1');
    expect((await ful.post(`/api/v1/admin/orders/${o.orderNumber}/cancel`, { reason: 'customer asked' })).statusCode).toBe(200);
    expect(await stock('SHOES-3-40')).toEqual({ on_hand: 3, reserved: 0 });

    const p = await cardOrder('SHOES-4-40', 'shoes-4', '40');
    await notify(payhereNotify(p.orderNumber, p.payhere.fields.amount, 2, { paymentId: '320000044' }));
    expect((await ful.post(`/api/v1/admin/orders/${p.orderNumber}/cancel`, { reason: 'customer return', refund: { amount: 1, restock: true } })).statusCode).toBe(403);
    expect((await ful.post(`/api/v1/admin/orders/${p.orderNumber}/cancel`, { reason: 'cust' })).statusCode).toBe(400);
    const fin = await new Agent(app).staffLogin('finance1');
    const total = Number(p.payhere.fields.amount);
    expect((await fin.post(`/api/v1/admin/orders/${p.orderNumber}/cancel`, { reason: 'returned', refund: { amount: total, restock: true } })).statusCode).toBe(200);
    expect(await ord(p.orderNumber)).toMatchObject({ status: 'refunded', payment_status: 'refunded' });
    expect(await stock('SHOES-4-40')).toEqual({ on_hand: 5, reserved: 0 });
  });
  it('fulfilment cannot ship an unpaid card order', async () => {
    const o = await cardOrder('SHOES-5-40', 'shoes-5', '40');
    const ful = await new Agent(app).staffLogin('fulfil1');
    const r = await ful.post(`/api/v1/admin/orders/${o.orderNumber}/status`, { status: 'shipped' });
    expect(r.statusCode).toBe(400);
  });
});
