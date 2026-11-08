import type { Pool } from 'pg';
import { z } from 'zod';
import { tx } from '../db/pool.js';
import { CartLine, priceCart } from './pricing.js';
import { reserve, takeStock, StockError } from './reservations.js';
import { orderNumber, randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { Config } from '../config.js';
import { checkoutHash, PAYHERE_URLS } from '../payments/payhere.js';
import { formatAmount } from '../lib/money.js';

const Phone = z.string().transform(s => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^(\+94|0)?7\d{8}$|^(\+94|0)\d{9}$/, 'enter a Sri Lankan phone number, e.g. 077 123 4567'));
const T = (min: number, max: number) => z.string().transform(s => s.trim()).pipe(z.string().min(min).max(max));

export const OrderInput = z.strictObject({
  items: z.array(CartLine).min(1).max(50),
  customer: z.strictObject({
    name: T(2, 80), phone: Phone, email: z.string().trim().max(200).pipe(z.string().email().or(z.literal(''))).default(''),
    address: T(4, 200), city: T(2, 60), district: z.string().max(40), note: z.string().trim().max(500).default(''),
  }),
  payment: z.enum(['payhere', 'cod', 'bank_transfer']),
  coupon: z.string().max(30).optional().nullable(),
  // the prices the customer saw; the order is refused if the server total differs (price changed)
  expectedTotal: z.number().nonnegative().optional(),
});
export type OrderInputT = z.infer<typeof OrderInput>;

export interface Created {
  orderNumber: string; trackingToken: string; status: string; paymentStatus: string; total: number;
  payhere?: { action: string; fields: Record<string, string> };
  bankInstructions?: string;
}

export async function createOrder(db: Pool, cfg: Config, input: OrderInputT, ctx: { customerId?: string | null; idempotencyKey?: string | null; ip: string; ua: string; requestId: string }): Promise<Created> {
  // idempotency: the same key returns the order created earlier (e.g. double click / network retry)
  if (ctx.idempotencyKey) {
    const ex = await db.query(`SELECT order_number, status, payment_status, total_cents, customer_id FROM orders WHERE idempotency_key = $1`, [ctx.idempotencyKey]);
    if (ex.rowCount) {
      const o = ex.rows[0];
      if ((o.customer_id || null) !== (ctx.customerId || null)) throw conflict('This checkout was already used.');
      throw new HttpError(409, 'duplicate_order', 'This order was already placed.', { orderNumber: o.order_number });
    }
  }
  const district = await db.query(`SELECT code FROM districts WHERE code = $1 OR lower(name) = lower($1)`, [input.customer.district]);
  if (!district.rowCount) throw badRequest('Please choose your district.');
  const pay = await db.query(`SELECT enabled, instructions FROM payment_settings WHERE method = $1`, [input.payment]);
  if (!pay.rows[0]?.enabled) throw badRequest('This payment method is not available right now.');
  if (input.payment === 'payhere' && (!cfg.PAYHERE_MERCHANT_ID || !cfg.PAYHERE_MERCHANT_SECRET)) throw badRequest('Card payment is not set up yet. Please choose another payment method.');
  if (input.payment === 'payhere' && !input.customer.email) throw badRequest('Please enter your email address for card payments (PayHere sends your receipt there).');

  const trackingToken = randomToken(24);
  try {
    return await tx(db, async c => {
      const q = await priceCart(c, input.items, { couponCode: input.coupon, lock: true });
      if (q.issues.length) throw new HttpError(409, 'stock_changed', 'Some items in your cart changed. Please check your cart again.', { issues: q.issues });
      if (input.coupon && !q.coupon) throw badRequest(q.couponError || 'This promo code is not valid.');
      if (!q.lines.length || q.totalCents <= 0) throw badRequest('Your cart is empty.');
      if (input.expectedTotal != null && Math.round(input.expectedTotal * 100) !== q.totalCents)
        throw new HttpError(409, 'price_changed', 'Prices changed since you opened checkout. Please review the new total.', { total: q.totalCents / 100 });

      const status = input.payment === 'payhere' ? 'pending_payment' : input.payment === 'bank_transfer' ? 'awaiting_bank_transfer' : 'confirmed';
      const payStatus = input.payment === 'cod' ? 'cod_pending' : 'pending';
      let number = '', orderId = '';
      for (let i = 0; i < 5 && !orderId; i++) {
        number = orderNumber();
        const r = await c.query(`INSERT INTO orders (order_number, customer_id, tracking_token_hash, idempotency_key, ship_name, ship_phone, ship_email, ship_line1, ship_city, ship_district, note,
              subtotal_cents, discount_cents, shipping_cents, total_cents, coupon_id, payment_method, status, payment_status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (order_number) DO NOTHING RETURNING id`,
          [number, ctx.customerId || null, sha256(trackingToken), ctx.idempotencyKey || null, input.customer.name, input.customer.phone, input.customer.email || null,
            input.customer.address, input.customer.city, district.rows[0].code, input.customer.note, q.subtotalCents, q.discountCents, q.shippingCents, q.totalCents,
            q.coupon?.id || null, input.payment, status, payStatus]);
        if (r.rowCount) orderId = r.rows[0].id;
      }
      if (!orderId) throw new Error('could not allocate an order number');
      for (const l of q.lines) {
        await c.query(`INSERT INTO order_items (order_id, product_id, variant_id, shop_id, sku, product_slug, product_name, variant_label, origin_code, unit_price_cents, quantity, line_total_cents)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [orderId, l.productId, l.variantId, l.shopId, l.sku, l.slug, l.name, l.size ? 'Size ' + l.size : '', l.origin, l.unitCents, l.qty, l.lineCents]);
      }
      const items = q.lines.map(l => ({ variantId: l.variantId, qty: l.qty }));
      if (input.payment === 'cod') await takeStock(c, orderId, items);
      else await reserve(c, orderId, items, input.payment === 'payhere' ? cfg.RESERVATION_MINUTES : cfg.BANK_RESERVATION_HOURS * 60);
      if (input.payment === 'cod') await c.query(`UPDATE products SET sold_count = sold_count + x.q FROM (SELECT product_id, sum(quantity)::int q FROM order_items WHERE order_id = $1 GROUP BY product_id) x WHERE products.id = x.product_id`, [orderId]);

      const payStatusRow = input.payment === 'payhere' ? 'initiated' : input.payment === 'bank_transfer' ? 'awaiting_receipt' : 'cod_pending';
      await c.query(`INSERT INTO payments (order_id, provider, merchant_order_ref, expected_amount_cents, status) VALUES ($1,$2,$3,$4,$5)`, [orderId, input.payment, number, q.totalCents, payStatusRow]);
      if (q.coupon) await c.query(`INSERT INTO coupon_redemptions (coupon_id, order_id, customer_id) VALUES ($1,$2,$3)`, [q.coupon.id, orderId, ctx.customerId || null]);
      await c.query(`INSERT INTO order_status_history (order_id, from_status, to_status, actor, note) VALUES ($1, NULL, $2, 'customer', $3)`, [orderId, status, 'order placed (' + input.payment + ')']);
      await audit(c, { type: ctx.customerId ? 'customer' : 'system', id: ctx.customerId || null, label: ctx.customerId ? 'customer' : 'guest', ip: ctx.ip, ua: ctx.ua, requestId: ctx.requestId },
        'order.create', 'order', orderId, undefined, { number, total: q.totalCents, payment: input.payment });

      const out: Created = { orderNumber: number, trackingToken, status, paymentStatus: payStatus, total: q.totalCents / 100 };
      if (input.payment === 'payhere') {
        const [first, ...rest] = input.customer.name.split(/\s+/);
        const fields: Record<string, string> = {
          merchant_id: cfg.PAYHERE_MERCHANT_ID,
          return_url: `${cfg.PUBLIC_SITE_URL}/#order/${number}`,
          cancel_url: `${cfg.PUBLIC_SITE_URL}/#order/${number}`,
          notify_url: `${cfg.PUBLIC_API_URL}/api/v1/payments/payhere/notify`,
          order_id: number, items: `Source Connect order ${number}`, currency: 'LKR', amount: formatAmount(q.totalCents),
          first_name: first || 'Customer', last_name: rest.join(' ') || '-', email: input.customer.email, phone: input.customer.phone,
          address: input.customer.address, city: input.customer.city, country: 'Sri Lanka',
        };
        fields.hash = checkoutHash(cfg.PAYHERE_MERCHANT_ID, number, q.totalCents, 'LKR', cfg.PAYHERE_MERCHANT_SECRET);
        out.payhere = { action: PAYHERE_URLS[cfg.PAYHERE_MODE], fields };
      }
      if (input.payment === 'bank_transfer') out.bankInstructions = pay.rows[0].instructions;
      return out;
    });
  } catch (e) {
    if (e instanceof StockError) throw new HttpError(409, 'stock_changed', 'Sorry, an item just sold out. Please check your cart again.');
    if ((e as any).code === '23505' && String((e as any).constraint).includes('idempotency')) throw new HttpError(409, 'duplicate_order', 'This order was already placed.');
    throw e;
  }
}
