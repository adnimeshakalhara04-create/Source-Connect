import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { Slug } from '../lib/validate.js';

type Q = Pool | PoolClient;

export const CartLine = z.strictObject({
  id: Slug,                                         // product slug (legacy product id)
  size: z.string().max(20).default(''),
  color: z.string().max(20).optional(),             // visual only; ignored for stock/price
  qty: z.coerce.number().int().min(1).max(99),
});
export type CartLineT = z.infer<typeof CartLine>;

export interface PricedLine {
  slug: string; size: string; qty: number; requestedQty: number;
  variantId: string; productId: string; shopId: string; sku: string; name: string; origin: string;
  unitCents: number; lineCents: number; available: number;
}
export interface Quote {
  lines: PricedLine[];
  issues: { id: string; size: string; problem: 'not_found' | 'out_of_stock' | 'reduced'; available?: number }[];
  subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number;
  coupon: { id: string; code: string } | null; couponError?: string;
  freeShippingOverCents: number | null;
}

/**
 * Prices a cart from the database only. Quantities above available stock are reduced and reported.
 * When `lock` is true (inside the order transaction) inventory rows are locked FOR UPDATE in a fixed
 * order (by variant id) so concurrent checkouts cannot oversell and cannot deadlock.
 */
export async function priceCart(db: Q, lines: CartLineT[], opts: { couponCode?: string | null; lock?: boolean } = {}): Promise<Quote> {
  // merge duplicate lines
  const merged = new Map<string, CartLineT>();
  for (const l of lines) {
    const k = l.id + '|' + (l.size || '');
    const prev = merged.get(k);
    merged.set(k, { ...l, size: l.size || '', qty: Math.min(99, (prev?.qty || 0) + l.qty) });
  }
  const want = [...merged.values()];
  const issues: Quote['issues'] = [];
  const out: PricedLine[] = [];
  if (want.length) {
    const r = await db.query(`
      SELECT p.slug, v.size, v.id AS variant_id, p.id AS product_id, p.shop_id, v.sku, p.name, p.origin_code,
             coalesce(v.price_cents, p.price_cents) AS unit_cents
        FROM products p JOIN product_variants v ON v.product_id = p.id
       WHERE p.status = 'active' AND v.active AND p.slug = ANY($1)`, [want.map(w => w.id)]);
    const byKey = new Map(r.rows.map(x => [x.slug + '|' + x.size, x]));
    const found = want.map(w => ({ w, row: byKey.get(w.id + '|' + w.size) }));
    const ids = found.filter(f => f.row).map(f => f.row!.variant_id as string).sort();
    const inv = ids.length ? await db.query(
      `SELECT variant_id, on_hand - reserved AS available FROM inventory WHERE variant_id = ANY($1) ORDER BY variant_id ${opts.lock ? 'FOR UPDATE' : ''}`, [ids]) : { rows: [] as any[] };
    const avail = new Map(inv.rows.map(x => [x.variant_id, Number(x.available)]));
    for (const { w, row } of found) {
      if (!row) { issues.push({ id: w.id, size: w.size, problem: 'not_found' }); continue; }
      const a = Math.max(0, avail.get(row.variant_id) ?? 0);
      if (a <= 0) { issues.push({ id: w.id, size: w.size, problem: 'out_of_stock', available: 0 }); continue; }
      const qty = Math.min(w.qty, a);
      if (qty < w.qty) issues.push({ id: w.id, size: w.size, problem: 'reduced', available: a });
      out.push({ slug: w.id, size: w.size, qty, requestedQty: w.qty, variantId: row.variant_id, productId: row.product_id, shopId: row.shop_id, sku: row.sku,
        name: row.name, origin: row.origin_code, unitCents: Number(row.unit_cents), lineCents: Number(row.unit_cents) * qty, available: a });
    }
  }
  const subtotal = out.reduce((n, l) => n + l.lineCents, 0);

  // coupon
  let discount = 0, coupon: Quote['coupon'] = null, couponError: string | undefined;
  if (opts.couponCode) {
    const c = await db.query(`SELECT c.*, (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id)::int AS used FROM coupons c WHERE c.code = $1`, [opts.couponCode]);
    const cp = c.rows[0];
    const now = Date.now();
    if (!cp || !cp.active) couponError = 'This promo code is not valid.';
    else if (cp.starts_at && new Date(cp.starts_at).getTime() > now) couponError = 'This promo code is not active yet.';
    else if (cp.ends_at && new Date(cp.ends_at).getTime() < now) couponError = 'This promo code has expired.';
    else if (cp.max_redemptions != null && cp.used >= cp.max_redemptions) couponError = 'This promo code has been fully used.';
    else if (subtotal < Number(cp.min_subtotal_cents)) couponError = `Spend at least Rs. ${(Number(cp.min_subtotal_cents) / 100).toLocaleString('en-US')} to use this code.`;
    else {
      discount = cp.kind === 'percent' ? Math.floor(subtotal * Number(cp.value) / 100) : Math.min(subtotal, Number(cp.value));
      coupon = { id: cp.id, code: cp.code };
    }
  }

  const s = await db.query(`SELECT fee_cents, free_over_cents FROM shipping_rates WHERE code = 'standard' AND active`);
  const rate = s.rows[0];
  const freeOver = rate && rate.free_over_cents != null ? Number(rate.free_over_cents) : null;
  const shipping = !out.length || !rate ? 0 : (freeOver != null && freeOver > 0 && subtotal >= freeOver ? 0 : Number(rate.fee_cents));
  return { lines: out, issues, subtotalCents: subtotal, discountCents: discount, shippingCents: shipping, totalCents: subtotal - discount + shipping, coupon, couponError, freeShippingOverCents: freeOver };
}

export function quoteForClient(q: Quote) {
  const rs = (c: number) => c / 100;
  return {
    lines: q.lines.map(l => ({ id: l.slug, size: l.size, qty: l.qty, requestedQty: l.requestedQty, sku: l.sku, name: l.name, price: rs(l.unitCents), lineTotal: rs(l.lineCents), available: l.available })),
    issues: q.issues, subtotal: rs(q.subtotalCents), discount: rs(q.discountCents), shipping: rs(q.shippingCents), total: rs(q.totalCents),
    coupon: q.coupon?.code ?? null, couponError: q.couponError ?? null, freeShippingOver: q.freeShippingOverCents == null ? null : rs(q.freeShippingOverCents),
  };
}
