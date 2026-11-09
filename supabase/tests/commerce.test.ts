import { describe, it, expect } from 'vitest';
import { anon, service, staff, customer, rpc, q1, db, setStock, stock, order, placeOrder, guest } from './helpers.js';

const fields = (num: string, amount: string, status: number, paymentId = '3200' + Math.floor(Math.random() * 1e6)) =>
  ({ merchant_id: '1211149', order_id: num, payment_id: paymentId, payhere_amount: amount, payhere_currency: 'LKR', status_code: String(status), md5sig: 'X' + Math.random(), method: 'VISA', card_no: '************1292' });
const notify = (f: any, sig = true, merchant = true) => rpc(service(), 'apply_payhere_notification', { p_fields: f, p_signature_valid: sig, p_merchant_ok: merchant, p_request_id: 'test' });
async function cardOrder(sku: string, slug: string, size: string, qty = 1) {
  await setStock(sku, 5);
  const r = await placeOrder([{ id: slug, size, qty }], 'payhere');
  expect(r.error).toBeNull();
  return r.data;
}

describe('server-side pricing', () => {
  it('uses database prices; unknown fields (like a browser "price") are rejected', async () => {
    const p = await q1(`SELECT price_cents FROM app.products WHERE slug = 'mens-1'`);
    await setStock('MENS-1-M', 10);
    const r = await rpc(anon(), 'quote_cart', { p_items: [{ id: 'mens-1', size: 'M', qty: 2 }] });
    expect(r.data.lines[0].price).toBe(p.price_cents / 100);
    expect(r.data.subtotal).toBe(2 * p.price_cents / 100);
    expect((await rpc(anon(), 'quote_cart', { p_items: [{ id: 'mens-1', size: 'M', qty: 2, price: 1 }] })).error).not.toBeNull();
  });
  it('shipping fee and free-delivery threshold come from the database', async () => {
    const rate = await q1(`SELECT fee_cents, free_over_cents FROM app.shipping_rates WHERE code = 'standard'`);
    const r = (await rpc(anon(), 'quote_cart', { p_items: [{ id: 'accessories-1', size: '', qty: 1 }] })).data;
    expect(r.shipping).toBe(r.subtotal * 100 >= rate.free_over_cents ? 0 : rate.fee_cents / 100);
  });
  it('promo codes are checked on the server', async () => {
    await db().query(`INSERT INTO app.coupons (code, kind, value) VALUES ('SAVE10', 'percent', 10) ON CONFLICT DO NOTHING`);
    await setStock('MENS-4-M', 10);
    const ok = (await rpc(anon(), 'quote_cart', { p_items: [{ id: 'mens-4', size: 'M', qty: 1 }], p_coupon: 'save10' })).data;
    expect(ok.coupon).toBe('SAVE10'); expect(ok.discount).toBe(Math.floor(ok.subtotal * 100 * 0.1) / 100);
    const bad = (await rpc(anon(), 'quote_cart', { p_items: [{ id: 'mens-4', size: 'M', qty: 1 }], p_coupon: 'NOPE99' })).data;
    expect(bad.discount).toBe(0); expect(bad.couponError).toBeTruthy();
  });
  it('an expected total that no longer matches is refused (price changed)', async () => {
    await setStock('MENS-3-L', 10);
    expect((await placeOrder([{ id: 'mens-3', size: 'L', qty: 1 }], 'cod', { expectedTotal: 1 })).code).toBe('price_changed');
  });
});

describe('orders and stock (atomic)', () => {
  it('browsers cannot call place_order or read tables directly', async () => {
    const a = anon();
    expect((await rpc(a, 'place_order', { p_input: {} })).error).not.toBeNull();
    const { error } = await a.from('orders').select('*');
    expect(error).not.toBeNull();
    const c = await customer();
    expect((await rpc(c.c, 'place_order', { p_input: {} })).error).not.toBeNull();
  });
  it('Cash on Delivery takes stock at once', async () => {
    await setStock('MENS-5-M', 5);
    const r = await placeOrder([{ id: 'mens-5', size: 'M', qty: 2 }]);
    expect(r.error).toBeNull();
    expect(r.data.orderNumber).toMatch(/^SC-\d{6}-[A-Z0-9]{6}$/); expect(r.data.trackingToken.length).toBeGreaterThan(20);
    expect(r.data.status).toBe('confirmed'); expect(r.data.paymentStatus).toBe('cod_pending');
    expect(await stock('MENS-5-M')).toEqual({ on_hand: 3, reserved: 0 });
  });
  it('more than in stock is refused and nothing changes', async () => {
    await setStock('MENS-6-M', 1);
    expect((await placeOrder([{ id: 'mens-6', size: 'M', qty: 2 }])).code).toBe('stock_changed');
    expect(await stock('MENS-6-M')).toEqual({ on_hand: 1, reserved: 0 });
  });
  it('8 buyers racing for the LAST item: exactly one wins, stock never below 0', async () => {
    await setStock('MENS-7-32', 1);
    const rs = await Promise.all(Array.from({ length: 8 }, () => placeOrder([{ id: 'mens-7', size: '32', qty: 1 }])));
    expect(rs.filter(r => !r.error)).toHaveLength(1);
    expect(rs.filter(r => r.code === 'stock_changed')).toHaveLength(7);
    expect(await stock('MENS-7-32')).toEqual({ on_hand: 0, reserved: 0 });
  });
  it('racing card checkouts: reservations never exceed stock', async () => {
    await setStock('MENS-8-32', 3);
    const rs = await Promise.all(Array.from({ length: 6 }, () => placeOrder([{ id: 'mens-8', size: '32', qty: 1 }], 'payhere')));
    expect(rs.filter(r => !r.error)).toHaveLength(3);
    expect(await stock('MENS-8-32')).toEqual({ on_hand: 3, reserved: 3 });
  });
  it('the same idempotency key cannot create two orders', async () => {
    await setStock('MENS-9-M', 10);
    const key = 'idem-key-1234567890abcdef';
    const one = await placeOrder([{ id: 'mens-9', size: 'M', qty: 1 }], 'cod', {}, null, key);
    const two = await placeOrder([{ id: 'mens-9', size: 'M', qty: 1 }], 'cod', {}, null, key);
    expect(one.error).toBeNull(); expect(two.code).toBe('duplicate_order');
    expect(JSON.parse(two.error!.details).orderNumber).toBe(one.data.orderNumber);
    expect(await stock('MENS-9-M')).toEqual({ on_hand: 9, reserved: 0 });
  });
  it('unpaid card orders release stock when the hold expires (pg_cron job)', async () => {
    await setStock('MENS-10-M', 2);
    const o = (await placeOrder([{ id: 'mens-10', size: 'M', qty: 2 }], 'payhere')).data;
    expect(await stock('MENS-10-M')).toEqual({ on_hand: 2, reserved: 2 });
    await db().query(`UPDATE app.stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)`, [o.orderNumber]);
    expect((await q1(`SELECT app.release_expired_reservations() n`)).n).toBeGreaterThanOrEqual(1);
    expect(await stock('MENS-10-M')).toEqual({ on_hand: 2, reserved: 0 });
    expect(await order(o.orderNumber)).toMatchObject({ status: 'expired', payment_status: 'cancelled' });
    const job = await q1(`SELECT schedule FROM cron.job WHERE jobname = 'release-expired-reservations'`);
    expect(job.schedule).toBe('* * * * *');
  });
  it('customer details are validated (phone, district, address)', async () => {
    const r = await rpc(service(), 'place_order', { p_input: { items: [{ id: 'mens-1', size: 'M', qty: 1 }], customer: { ...guest, phone: '12', district: 'Atlantis' }, payment: 'cod' } });
    expect(r.code).toBe('bad_request');
  });
  it('disabled payment methods and unconfigured PayHere are refused', async () => {
    await db().query(`UPDATE app.payment_settings SET enabled = false WHERE method = 'bank_transfer'`);
    expect((await placeOrder([{ id: 'mens-1', size: 'M', qty: 1 }], 'bank_transfer')).code).toBe('bad_request');
    await db().query(`UPDATE app.payment_settings SET enabled = true WHERE method = 'bank_transfer'`);
    await db().query(`UPDATE app.ops_settings SET payhere_configured = false`);
    expect((await placeOrder([{ id: 'mens-1', size: 'M', qty: 1 }], 'payhere')).code).toBe('bad_request');
    await db().query(`UPDATE app.ops_settings SET payhere_configured = true`);
  });
});

describe('PayHere notifications (signature already checked by the Edge Function)', () => {
  it('valid success: paid, reservation becomes a sale', async () => {
    const o = await cardOrder('KIDS-3-4-5Y', 'kids-3', '4-5Y', 2);
    expect(await stock('KIDS-3-4-5Y')).toEqual({ on_hand: 5, reserved: 2 });
    const r = await notify(fields(o.orderNumber, o.amount, 2, '320000001'));
    expect(r.data).toEqual({ http: 200, result: 'applied:paid' });
    expect(await order(o.orderNumber)).toEqual({ status: 'confirmed', payment_status: 'paid', needs_review: false });
    expect(await stock('KIDS-3-4-5Y')).toEqual({ on_hand: 3, reserved: 0 });
  });
  it('duplicates, sequential and simultaneous, apply once', async () => {
    const o = await cardOrder('KIDS-4-4-5Y', 'kids-4', '4-5Y');
    const f = fields(o.orderNumber, o.amount, 2, '320000002');
    const rs = await Promise.all([notify(f), notify(f), notify(f)]);
    expect(rs.map(r => r.data.result).sort()).toEqual(['applied:paid', 'duplicate', 'duplicate']);
    await notify(f);
    expect(await stock('KIDS-4-4-5Y')).toEqual({ on_hand: 4, reserved: 0 });
    expect((await q1(`SELECT sold_count FROM app.products WHERE slug = 'kids-4'`)).sold_count).toBe(1);
  });
  it('forged or wrong notifications never create a paid order', async () => {
    const o = await cardOrder('KIDS-5-4-5Y', 'kids-5', '4-5Y');
    const bad = [
      await notify(fields(o.orderNumber, o.amount, 2), false),                       // bad signature
      await notify(fields(o.orderNumber, o.amount, 2), true, false),                 // other merchant
      await notify(fields(o.orderNumber, '1.00', 2)),                                // wrong amount
      await notify({ ...fields(o.orderNumber, o.amount, 2), payhere_currency: 'USD' }),
      await notify(fields('SC-000000-ZZZZZZ', o.amount, 2)),                         // unknown order
      await notify(fields(o.orderNumber, o.amount, 7)),                              // unknown status
      await notify(fields(o.orderNumber, o.amount, 2), null as any),                 // missing verdict = invalid
    ];
    expect(bad.every(r => r.data.http === 400)).toBe(true);
    expect(await order(o.orderNumber)).toEqual({ status: 'pending_payment', payment_status: 'pending', needs_review: false });
  });
  it('failed payment releases stock; a late "cancelled" never undoes a payment', async () => {
    const a = await cardOrder('KIDS-6-4-5Y', 'kids-6', '4-5Y', 3);
    await notify(fields(a.orderNumber, a.amount, -2));
    expect(await order(a.orderNumber)).toEqual({ status: 'cancelled', payment_status: 'failed', needs_review: false });
    expect(await stock('KIDS-6-4-5Y')).toEqual({ on_hand: 5, reserved: 0 });
    const b = await cardOrder('KIDS-7-4-5Y', 'kids-7', '4-5Y');
    await notify(fields(b.orderNumber, b.amount, 2, '320000007'));
    expect((await notify(fields(b.orderNumber, b.amount, -1, '320000007'))).data.result).toBe('ignored:already_final');
    expect(await order(b.orderNumber)).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
  });
  it('chargeback flags for review without restocking', async () => {
    const o = await cardOrder('KIDS-8-4-5Y', 'kids-8', '4-5Y');
    await notify(fields(o.orderNumber, o.amount, 2, '320000008'));
    await notify(fields(o.orderNumber, o.amount, -3, '320000008'));
    expect(await order(o.orderNumber)).toEqual({ status: 'confirmed', payment_status: 'chargeback', needs_review: true });
    expect(await stock('KIDS-8-4-5Y')).toEqual({ on_hand: 4, reserved: 0 });
  });
  it('late payment after expiry: retakes stock, or flags review when stock is gone', async () => {
    const o = await cardOrder('KIDS-9-4-5Y', 'kids-9', '4-5Y');
    await db().query(`UPDATE app.stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)`, [o.orderNumber]);
    await db().query(`SELECT app.release_expired_reservations()`);
    await notify(fields(o.orderNumber, o.amount, 2, '320000009'));
    expect(await order(o.orderNumber)).toEqual({ status: 'confirmed', payment_status: 'paid', needs_review: false });
    const o2 = await cardOrder('KIDS-10-4-5Y', 'kids-10', '4-5Y');
    await db().query(`UPDATE app.stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = (SELECT id FROM app.orders WHERE order_number = $1)`, [o2.orderNumber]);
    await db().query(`SELECT app.release_expired_reservations()`);
    await setStock('KIDS-10-4-5Y', 0);
    await notify(fields(o2.orderNumber, o2.amount, 2, '320000010'));
    expect(await order(o2.orderNumber)).toEqual({ status: 'expired', payment_status: 'paid', needs_review: true });
  });
});

describe('Bank transfer, COD, cancel and refund (staff, permissions in the database)', () => {
  it('bank transfer: support cannot confirm; finance must tick "checked the bank"; second confirm refused', async () => {
    await setStock('SHOES-1-40', 3);
    const o = (await placeOrder([{ id: 'shoes-1', size: '40', qty: 1 }], 'bank_transfer')).data;
    expect(o.status).toBe('awaiting_bank_transfer'); expect(o.bankInstructions).toBeTruthy();
    expect(await stock('SHOES-1-40')).toEqual({ on_hand: 3, reserved: 1 });
    const sup = await staff('support1');
    expect((await rpc(sup, 'admin_verify_bank_transfer', { p_number: o.orderNumber, p_reference: 'TRX123', p_confirm_checked: true })).error?.code).toBe('42501');
    const fin = await staff('finance1');
    expect((await rpc(fin, 'admin_verify_bank_transfer', { p_number: o.orderNumber, p_reference: 'TRX123', p_confirm_checked: false })).code).toBe('bad_request');
    expect((await rpc(fin, 'admin_verify_bank_transfer', { p_number: o.orderNumber, p_reference: 'TRX123', p_confirm_checked: true })).error).toBeNull();
    expect(await order(o.orderNumber)).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect(await stock('SHOES-1-40')).toEqual({ on_hand: 2, reserved: 0 });
    expect((await rpc(fin, 'admin_verify_bank_transfer', { p_number: o.orderNumber, p_reference: 'TRX123', p_confirm_checked: true })).code).toBe('conflict');
  });
  it('COD is never "paid" until cash is recorded', async () => {
    await setStock('SHOES-2-40', 3);
    const o = (await placeOrder([{ id: 'shoes-2', size: '40', qty: 1 }])).data;
    expect(await order(o.orderNumber)).toMatchObject({ payment_status: 'cod_pending' });
    expect((await rpc(await staff('finance1'), 'admin_cod_collected', { p_number: o.orderNumber })).error).toBeNull();
    expect(await order(o.orderNumber)).toMatchObject({ payment_status: 'cod_collected' });
  });
  it('cancel COD restocks; paid orders need a refund by finance; fulfilment cannot refund', async () => {
    await setStock('SHOES-3-40', 3);
    const o = (await placeOrder([{ id: 'shoes-3', size: '40', qty: 2 }])).data;
    const ful = await staff('fulfil1');
    expect((await rpc(ful, 'admin_cancel_order', { p_number: o.orderNumber, p_reason: 'customer asked' })).error).toBeNull();
    expect(await stock('SHOES-3-40')).toEqual({ on_hand: 3, reserved: 0 });
    const p = await cardOrder('SHOES-4-40', 'shoes-4', '40');
    await notify(fields(p.orderNumber, p.amount, 2, '320000044'));
    expect((await rpc(ful, 'admin_cancel_order', { p_number: p.orderNumber, p_reason: 'customer return', p_refund: { amount: 1, restock: true } })).error?.code).toBe('42501');
    expect((await rpc(ful, 'admin_cancel_order', { p_number: p.orderNumber, p_reason: 'customer return' })).code).toBe('bad_request');
    const fin = await staff('finance1');
    expect((await rpc(fin, 'admin_cancel_order', { p_number: p.orderNumber, p_reason: 'returned', p_refund: { amount: Number(p.amount), restock: true } })).error).toBeNull();
    expect(await order(p.orderNumber)).toMatchObject({ status: 'refunded', payment_status: 'refunded' });
    expect(await stock('SHOES-4-40')).toEqual({ on_hand: 5, reserved: 0 });
  });
  it('fulfilment cannot ship an unpaid card order, and moves one step at a time', async () => {
    const o = await cardOrder('SHOES-5-40', 'shoes-5', '40');
    const ful = await staff('fulfil1');
    expect((await rpc(ful, 'admin_set_order_status', { p_number: o.orderNumber, p_status: 'shipped' })).code).toBe('bad_request');
    await setStock('SHOES-6-40', 3);
    const c = (await placeOrder([{ id: 'shoes-6', size: '40', qty: 1 }])).data;
    expect((await rpc(ful, 'admin_set_order_status', { p_number: c.orderNumber, p_status: 'processing' })).error).toBeNull();
    expect((await rpc(ful, 'admin_set_order_status', { p_number: c.orderNumber, p_status: 'delivered' })).code).toBe('bad_request');
  });
});

describe('privacy and tracking', () => {
  it('order number alone reveals nothing; token = full, matching phone = status only', async () => {
    await setStock('WOMENS-1-M', 5);
    const o = (await placeOrder([{ id: 'womens-1', size: 'M', qty: 1 }])).data;
    const s = service();
    expect((await rpc(s, 'track_order', { p_number: o.orderNumber })).data).toBeNull();
    expect((await rpc(s, 'track_order', { p_number: o.orderNumber, p_token: 'guess-guess-guess' })).data).toBeNull();
    expect((await rpc(s, 'track_order', { p_number: o.orderNumber, p_phone: '0779999999' })).data).toBeNull();
    expect((await rpc(s, 'track_order', { p_number: o.orderNumber, p_token: o.trackingToken })).data.customer.address).toBe(guest.address);
    const lim = (await rpc(s, 'track_order', { p_number: o.orderNumber, p_phone: '+94 77 123 4567' })).data;
    expect(lim.status).toBe('confirmed'); expect(lim.customer.address).toBeUndefined();
    expect((await rpc(anon(), 'track_order', { p_number: o.orderNumber, p_token: o.trackingToken })).error).not.toBeNull();   // only via the rate-limited Edge Function
  });
  it('customer A cannot see customer B orders; sign-ups become customers, not staff', async () => {
    const A = await customer('Alice A'), B = await customer('Bob B');
    await setStock('WOMENS-2-M', 5);
    const o = (await placeOrder([{ id: 'womens-2', size: 'M', qty: 1 }], 'cod', {}, A.id)).data;
    expect((await rpc(A.c, 'my_orders')).data.map((x: any) => x.number)).toContain(o.orderNumber);
    expect((await rpc(B.c, 'my_orders')).data).toEqual([]);
    expect((await rpc(B.c, 'my_order', { p_number: o.orderNumber })).data).toBeNull();
    expect((await rpc(A.c, 'admin_orders')).error).not.toBeNull();
    expect((await rpc(A.c, 'my_profile')).data.name).toBe('Alice A');
    expect(await q1(`SELECT count(*)::int n FROM app.staff_users WHERE id = $1`, [A.id])).toEqual({ n: 0 });
  });
});
