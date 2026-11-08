import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { requireStaff, actorOf } from '../../auth/staff.js';
import { audit } from '../../lib/audit.js';
import { tx } from '../../db/pool.js';
import { verifyBankTransfer, markCodCollected, setFulfilmentStatus, cancelOrder } from '../../orders/payments.js';

const OrderNo = z.string().trim().toUpperCase().pipe(z.string().regex(/^SC-[0-9]{6}-[A-Z0-9]{6}$/));
const rs = (c: number) => c / 100;

export default async function adminOrders(app: FastifyInstance) {
  const db = app.db;
  const staffActor = (req: any) => ({ ...actorOf(req), id: req.staff!.id as string });
  const shopFilter = (req: any, args: unknown[]) => {
    if (req.staff!.shopIds === null) return '';
    args.push(req.staff!.shopIds);
    return ` AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.shop_id = ANY($${args.length}))`;
  };

  app.get('/orders', { preHandler: requireStaff(db, 'orders.read'), schema: { tags: ['admin-orders'] } }, async (req) => {
    const q = parse(z.strictObject({ status: z.string().max(30).optional(), payment: z.string().max(30).optional(), review: z.enum(['1']).optional(), q: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    const args: unknown[] = []; const where = ['true'];
    const a = (v: unknown) => { args.push(v); return '$' + args.length; };
    if (q.status) where.push(`o.status = ${a(q.status)}`);
    if (q.payment) where.push(`o.payment_status = ${a(q.payment)}`);
    if (q.review) where.push(`o.needs_review`);
    if (q.q) { const p = a('%' + q.q + '%'); where.push(`(o.order_number ILIKE ${p} OR o.ship_name ILIKE ${p} OR o.ship_phone ILIKE ${p} OR o.ship_email ILIKE ${p})`); }
    const sf = shopFilter(req, args);
    const lim = a(q.limit), off = a(q.offset);
    const r = await db.query(`SELECT o.order_number, o.placed_at, o.status, o.payment_status, o.payment_method, o.total_cents, o.ship_name, o.ship_phone, o.ship_city, d.name AS district, o.needs_review,
        (SELECT sum(quantity)::int FROM order_items WHERE order_id = o.id) AS items, count(*) OVER () AS total_count
      FROM orders o JOIN districts d ON d.code = o.ship_district WHERE ${where.join(' AND ')}${sf} ORDER BY o.placed_at DESC LIMIT ${lim} OFFSET ${off}`, args);
    const showPii = req.staff!.permissions.has('customers.read');
    return { total: r.rows[0]?.total_count ?? 0, items: r.rows.map(o => ({ number: o.order_number, placedAt: o.placed_at, status: o.status, paymentStatus: o.payment_status, paymentMethod: o.payment_method,
      total: rs(o.total_cents), items: o.items, needsReview: o.needs_review, customer: showPii ? { name: o.ship_name, phone: o.ship_phone, city: o.ship_city, district: o.district } : { name: String(o.ship_name).split(' ')[0] } })) };
  });

  app.get('/orders/:number', { preHandler: requireStaff(db, 'orders.read'), schema: { tags: ['admin-orders'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const args: unknown[] = [number];
    const r = await db.query(`SELECT o.*, d.name AS district FROM orders o JOIN districts d ON d.code = o.ship_district WHERE o.order_number = $1${shopFilter(req, args)}`, args);
    const o = r.rows[0]; if (!o) throw notFound('Order not found.');
    const [items, hist, pays, events, ships, refunds] = await Promise.all([
      db.query(`SELECT oi.*, s.name AS shop FROM order_items oi LEFT JOIN shops s ON s.id = oi.shop_id WHERE order_id = $1 ORDER BY product_name`, [o.id]),
      db.query(`SELECT from_status, to_status, actor, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at`, [o.id]),
      db.query(`SELECT p.provider, p.provider_payment_id, p.status, p.expected_amount_cents, p.method, p.card_mask, p.reference, p.paid_at, p.verified_at, u.username AS verified_by FROM payments p LEFT JOIN staff_users u ON u.id = p.verified_by WHERE order_id = $1`, [o.id]),
      req.staff!.permissions.has('payments.read') ? db.query(`SELECT status_code, signature_valid, amount_text, currency, result, received_at, provider_payment_id FROM payment_events WHERE merchant_order_ref = $1 ORDER BY received_at`, [o.order_number]) : Promise.resolve({ rows: [] as any[] }),
      db.query(`SELECT s.*, coalesce((SELECT json_agg(e ORDER BY e.occurred_at) FROM shipment_events e WHERE e.shipment_id = s.id), '[]') AS events FROM shipments s WHERE order_id = $1 ORDER BY created_at`, [o.id]),
      db.query(`SELECT r.amount_cents, r.reason, r.restock, r.created_at, u.username FROM refunds r LEFT JOIN staff_users u ON u.id = r.staff_id WHERE order_id = $1`, [o.id]),
    ]);
    const pii = req.staff!.permissions.has('customers.read');
    return {
      number: o.order_number, placedAt: o.placed_at, status: o.status, paymentStatus: o.payment_status, paymentMethod: o.payment_method, needsReview: o.needs_review, reviewReason: o.review_reason,
      subtotal: rs(o.subtotal_cents), discount: rs(o.discount_cents), shipping: rs(o.shipping_cents), total: rs(o.total_cents),
      customer: pii ? { name: o.ship_name, phone: o.ship_phone, email: o.ship_email, address: o.ship_line1, city: o.ship_city, district: o.district, note: o.note, account: !!o.customer_id } : { name: String(o.ship_name).split(' ')[0] },
      items: items.rows.map(i => ({ id: i.product_slug, sku: i.sku, name: i.product_name, variant: i.variant_label, qty: i.quantity, price: rs(i.unit_price_cents), lineTotal: rs(i.line_total_cents), origin: i.origin_code, shop: i.shop })),
      timeline: hist.rows, payments: pays.rows.map(p => ({ ...p, expected: rs(p.expected_amount_cents), expected_amount_cents: undefined })), paymentEvents: events.rows,
      shipments: ships.rows, refunds: refunds.rows.map(r => ({ ...r, amount: rs(r.amount_cents) })),
    };
  });

  app.post('/orders/:number/status', { preHandler: requireStaff(db, 'orders.update'), schema: { tags: ['admin-orders'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const b = parse(z.strictObject({ status: z.enum(['confirmed', 'processing', 'shipped', 'arrived_lk', 'delivered']), note: z.string().max(300).default('') }), req.body);
    await setFulfilmentStatus(db, number, b.status, b.note, staffActor(req));
    return { ok: true };
  });

  app.post('/orders/:number/shipments', { preHandler: requireStaff(db, 'orders.update'), schema: { tags: ['admin-orders'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const b = parse(z.strictObject({ carrier: z.string().trim().max(60), trackingNumber: z.string().trim().max(80), status: z.enum(['preparing', 'shipped_abroad', 'arrived_lk', 'out_for_delivery', 'delivered', 'returned']), location: z.string().max(80).default(''), note: z.string().max(200).default('') }), req.body);
    await tx(db, async c => {
      const o = await c.query(`SELECT id, status FROM orders WHERE order_number = $1`, [number]);
      if (!o.rowCount) throw notFound('Order not found.');
      if (['cancelled', 'expired', 'pending_payment', 'awaiting_bank_transfer'].includes(o.rows[0].status)) throw badRequest('Only confirmed orders can be shipped.');
      let s = await c.query(`SELECT id FROM shipments WHERE order_id = $1 AND tracking_number = $2`, [o.rows[0].id, b.trackingNumber]);
      if (!s.rowCount) s = await c.query(`INSERT INTO shipments (order_id, carrier, tracking_number, status) VALUES ($1,$2,$3,$4) RETURNING id`, [o.rows[0].id, b.carrier, b.trackingNumber, b.status]);
      await c.query(`UPDATE shipments SET status = $2, carrier = $3, shipped_at = coalesce(shipped_at, CASE WHEN $2 <> 'preparing' THEN now() END), delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END WHERE id = $1`, [s.rows[0].id, b.status, b.carrier]);
      await c.query(`INSERT INTO shipment_events (shipment_id, status, location, note, staff_id) VALUES ($1,$2,$3,$4,$5)`, [s.rows[0].id, b.status, b.location, b.note, req.staff!.id]);
      await audit(c, actorOf(req), 'shipment.update', 'order', o.rows[0].id, undefined, b);
    });
    return { ok: true };
  });

  app.post('/orders/:number/verify-bank-transfer', { preHandler: requireStaff(db, 'payments.verify'), schema: { tags: ['admin-orders'], summary: 'Finance confirms the money is in the bank account' } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const b = parse(z.strictObject({ reference: z.string().trim().min(3, 'enter the bank reference').max(80), confirmChecked: z.literal(true, { message: 'confirm that you checked the bank account' }) }), req.body);
    await verifyBankTransfer(db, number, b.reference, staffActor(req));
    return { ok: true };
  });
  app.post('/orders/:number/cod-collected', { preHandler: requireStaff(db, 'payments.verify'), schema: { tags: ['admin-orders'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    await markCodCollected(db, number, staffActor(req));
    return { ok: true };
  });
  // Cancelling needs orders.update; cancelling with a refund needs refunds.create (finance/owner).
  app.post('/orders/:number/cancel', { preHandler: requireStaff(db), schema: { tags: ['admin-orders'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const b = parse(z.strictObject({ reason: z.string().trim().min(3, 'give a reason').max(300),
      refund: z.strictObject({ amount: z.number().positive().max(10_000_000), restock: z.boolean() }).optional() }), req.body);
    if (b.refund && !req.staff!.permissions.has('refunds.create')) throw forbidden('Only finance or the owner can record refunds.');
    if (!b.refund && !req.staff!.permissions.has('orders.update')) throw forbidden();
    await cancelOrder(db, number, b.reason, staffActor(req), b.refund ? { amountCents: Math.round(b.refund.amount * 100), restock: b.refund.restock } : undefined);
    return { ok: true };
  });
  app.post('/orders/:number/resolve-review', { preHandler: requireStaff(db, 'payments.verify'), schema: { tags: ['admin-orders'] } }, async (req) => {
    const { number } = parse(z.strictObject({ number: OrderNo }), req.params);
    const b = parse(z.strictObject({ note: z.string().trim().min(3).max(300) }), req.body);
    const r = await db.query(`UPDATE orders SET needs_review = false WHERE order_number = $1 AND needs_review RETURNING id`, [number]);
    if (!r.rowCount) throw notFound('No open review on this order.');
    await audit(db, actorOf(req), 'order.review_resolved', 'order', r.rows[0].id, undefined, b);
    return { ok: true };
  });
}
