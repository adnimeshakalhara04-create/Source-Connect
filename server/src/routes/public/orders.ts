import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { notFound } from '../../lib/errors.js';
import { CartLine, priceCart, quoteForClient } from '../../orders/pricing.js';
import { OrderInput, createOrder } from '../../orders/create.js';
import { handlePayhereNotify } from '../../orders/payments.js';
import { withCustomer } from '../../auth/customer.js';
import { sha256, safeEqual } from '../../lib/crypto.js';

const OrderNo = z.string().trim().toUpperCase().pipe(z.string().regex(/^SC-[0-9]{6}-[A-Z0-9]{6}$/, 'order number looks like SC-261108-ABC123'));

/** Order details for the buyer. `full` adds the delivery address (token or account owner only). */
export async function orderView(db: Pool, id: string, full: boolean) {
  const o = (await db.query(`SELECT o.*, d.name AS district_name FROM orders o JOIN districts d ON d.code = o.ship_district WHERE o.id = $1`, [id])).rows[0];
  const items = await db.query(`SELECT product_slug, product_name, variant_label, quantity, unit_price_cents, line_total_cents, origin_code FROM order_items WHERE order_id = $1 ORDER BY product_name`, [id]);
  const hist = await db.query(`SELECT to_status, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at`, [id]);
  const ship = await db.query(`SELECT carrier, tracking_number, status, shipped_at, delivered_at FROM shipments WHERE order_id = $1 ORDER BY created_at`, [id]);
  const bank = o.payment_method === 'bank_transfer' && o.status === 'awaiting_bank_transfer'
    ? (await db.query(`SELECT instructions FROM payment_settings WHERE method = 'bank_transfer'`)).rows[0]?.instructions : undefined;
  const rs = (c: number) => c / 100;
  return {
    number: o.order_number, placedAt: o.placed_at, status: o.status, paymentStatus: o.payment_status, paymentMethod: o.payment_method,
    items: items.rows.map(i => ({ id: i.product_slug, name: i.product_name, variant: i.variant_label, qty: i.quantity, price: rs(i.unit_price_cents), lineTotal: rs(i.line_total_cents), origin: i.origin_code })),
    subtotal: rs(o.subtotal_cents), discount: rs(o.discount_cents), shipping: rs(o.shipping_cents), total: rs(o.total_cents),
    timeline: hist.rows.map(h => ({ status: h.to_status, at: h.created_at })),
    shipments: ship.rows.map(s => ({ carrier: s.carrier, trackingNumber: s.tracking_number, status: s.status, shippedAt: s.shipped_at, deliveredAt: s.delivered_at })),
    bankInstructions: bank,
    customer: full ? { name: o.ship_name, phone: o.ship_phone, email: o.ship_email, address: o.ship_line1, city: o.ship_city, district: o.district_name } : { name: String(o.ship_name).split(' ')[0] },
  };
}

export default async function publicOrders(app: FastifyInstance) {
  const db = app.db, cfg = app.config;

  app.post('/cart/quote', { preHandler: withCustomer(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['checkout'], summary: 'Server prices, stock and totals for a cart' } }, async (req) => {
    const b = parse(z.strictObject({ items: z.array(CartLine).max(50), coupon: z.string().max(30).optional().nullable() }), req.body);
    return quoteForClient(await priceCart(db, b.items, { couponCode: b.coupon }));
  });

  app.post('/orders', { preHandler: withCustomer(db), config: { rateLimit: { max: cfg.ORDER_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } }, schema: { tags: ['checkout'], summary: 'Place an order (stock is reserved or taken in one transaction)' } }, async (req, reply) => {
    const input = parse(OrderInput, req.body);
    const key = req.headers['idempotency-key'];
    const idem = typeof key === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(key) ? key : null;
    const out = await createOrder(db, cfg, input, { customerId: req.customer?.id ?? null, idempotencyKey: idem, ip: req.ip, ua: String(req.headers['user-agent'] || ''), requestId: req.id });
    reply.status(201);
    return out;
  });

  // Track with the private token from the confirmation (full details) or order number + phone (status only).
  app.post('/orders/track', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }, schema: { tags: ['checkout'] } }, async (req) => {
    const b = parse(z.strictObject({ number: OrderNo, token: z.string().max(100).optional(), phone: z.string().max(20).optional() }), req.body);
    const r = await db.query(`SELECT id, tracking_token_hash, ship_phone FROM orders WHERE order_number = $1`, [b.number]);
    const o = r.rows[0];
    const digits = (s: string) => s.replace(/\D/g, '').replace(/^94/, '0');
    if (o && b.token && safeEqual(sha256(b.token), o.tracking_token_hash)) return orderView(db, o.id, true);
    if (o && b.phone && digits(b.phone).length >= 9 && digits(b.phone) === digits(o.ship_phone)) return orderView(db, o.id, false);
    throw notFound('We could not find an order with those details.');
  });

  app.get('/account/orders', { preHandler: withCustomer(db, true), schema: { tags: ['customers'] } }, async (req) => {
    const r = await db.query(`SELECT id FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 50`, [req.customer!.id]);
    return Promise.all(r.rows.map(x => orderView(db, x.id, true)));
  });
  app.get('/account/orders/:number', { preHandler: withCustomer(db, true), schema: { tags: ['customers'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const r = await db.query(`SELECT id FROM orders WHERE order_number = $1 AND customer_id = $2`, [number, req.customer!.id]);
    if (!r.rowCount) throw notFound('Order not found.');   // other customers' orders look exactly like missing ones
    return orderView(db, r.rows[0].id, true);
  });

  // PayHere server-to-server notification. Not rate limited per IP (PayHere retries), body size is capped by formbody.
  app.post('/payments/payhere/notify', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { tags: ['payments'], summary: 'PayHere notify_url (form-encoded, md5sig verified)' } }, async (req, reply) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    const r = await handlePayhereNotify(db, cfg, body, { ip: req.ip, requestId: req.id });
    req.log.info({ order: String(body.order_id || '').slice(0, 40), status: body.status_code, result: r.result }, 'payhere notify');
    reply.status(r.http).type('text/plain');
    return r.http === 200 ? 'OK' : 'REJECTED';
  });
}
