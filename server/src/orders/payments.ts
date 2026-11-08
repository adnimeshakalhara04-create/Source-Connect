import type { Pool, PoolClient } from 'pg';
import { tx } from '../db/pool.js';
import { sha256 } from '../lib/crypto.js';
import { parseAmount } from '../lib/money.js';
import { audit, type Actor } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { consumeReservations, releaseReservations, restock } from './reservations.js';
import { STATUS, sanitizeNotify, verifyNotifySignature } from '../payments/payhere.js';
import type { Config } from '../config.js';

export type NotifyResult = { http: 200 | 400; result: string };

const history = (c: PoolClient, orderId: string, from: string | null, to: string, actor: string, note = '') =>
  c.query(`INSERT INTO order_status_history (order_id, from_status, to_status, actor, note) VALUES ($1,$2,$3,$4,$5)`, [orderId, from, to, actor, note]);

/** Takes stock for an order whose reservation already expired (late payment). Returns false if not enough stock. */
async function retakeStock(c: PoolClient, orderId: string): Promise<boolean> {
  const items = await c.query(`SELECT variant_id, quantity FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL ORDER BY variant_id`, [orderId]);
  const inv = await c.query(`SELECT variant_id, on_hand - reserved AS a FROM inventory WHERE variant_id = ANY($1) ORDER BY variant_id FOR UPDATE`, [items.rows.map(r => r.variant_id)]);
  const avail = new Map(inv.rows.map(r => [r.variant_id, Number(r.a)]));
  if (items.rows.some(r => (avail.get(r.variant_id) ?? 0) < r.quantity)) return false;
  for (const r of items.rows) {
    await c.query(`UPDATE inventory SET on_hand = on_hand - $2 WHERE variant_id = $1`, [r.variant_id, r.quantity]);
    await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, reason, order_id, note) VALUES ($1,$2,'order_consumed',$3,'late payment')`, [r.variant_id, -r.quantity, orderId]);
  }
  return true;
}

async function markSold(c: PoolClient, orderId: string) {
  await c.query(`UPDATE products SET sold_count = sold_count + x.q FROM (SELECT product_id, sum(quantity)::int q FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL GROUP BY product_id) x WHERE products.id = x.product_id`, [orderId]);
}

/**
 * Handles a PayHere server notification. Order of checks:
 * 1. md5sig (constant-time)  2. merchant_id  3. order exists  4. currency  5. exact amount
 * 6. de-duplication (unique dedupe_key)  7. valid state transition.
 * Every notification, valid or not, is stored (sanitised) in payment_events.
 */
export async function handlePayhereNotify(db: Pool, cfg: Config, fields: Record<string, string>, meta: { ip: string; requestId: string }): Promise<NotifyResult> {
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields || {})) if (typeof v === 'string') f[k] = v;
  const sigOk = verifyNotifySignature(f, cfg.PAYHERE_MERCHANT_SECRET);
  const code = Number.parseInt(f.status_code ?? '', 10);
  const payload = sanitizeNotify(f);
  const dedupe = sha256(['payhere', f.payment_id || '', f.order_id || '', f.status_code || '', (f.md5sig || '').toUpperCase()].join('|'));
  const actor: Actor = { type: 'payhere', label: 'payhere notify', ip: meta.ip, requestId: meta.requestId };

  const record = async (c: Pool | PoolClient, paymentId: string | null, result: string) => {
    const r = await c.query(`INSERT INTO payment_events (payment_id, provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
      VALUES ($1,'payhere',$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [paymentId, dedupe, f.order_id?.slice(0, 60) || null, f.payment_id?.slice(0, 60) || null, Number.isFinite(code) ? code : null, sigOk, f.payhere_amount?.slice(0, 30) || null, f.payhere_currency?.slice(0, 5) || null, JSON.stringify(payload), result]);
    return (r.rowCount ?? 0) > 0;
  };
  const reject = async (reason: string): Promise<NotifyResult> => {
    // rejected events use a distinct key so a later genuine notification is not blocked as a duplicate
    await db.query(`INSERT INTO payment_events (provider, dedupe_key, merchant_order_ref, provider_payment_id, status_code, signature_valid, amount_text, currency, payload, result)
      VALUES ('payhere',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [sha256(dedupe + '|rejected|' + meta.requestId), f.order_id?.slice(0, 60) || null, f.payment_id?.slice(0, 60) || null, Number.isFinite(code) ? code : null, sigOk, f.payhere_amount?.slice(0, 30) || null, f.payhere_currency?.slice(0, 5) || null, JSON.stringify(payload), 'rejected:' + reason]);
    await audit(db, actor, 'payment.notify_rejected', 'order', f.order_id?.slice(0, 60) || null, undefined, { reason });
    return { http: 400, result: 'rejected:' + reason };
  };

  if (!sigOk) return reject('bad_signature');
  if (f.merchant_id !== cfg.PAYHERE_MERCHANT_ID) return reject('wrong_merchant');
  if (!Number.isInteger(code) || ![2, 0, -1, -2, -3].includes(code)) return reject('unknown_status');

  return tx(db, async c => {
    const o = await c.query(`SELECT o.id, o.status, o.payment_status, o.total_cents, o.currency, p.id AS payment_id, p.provider_payment_id, p.status AS pay_state
      FROM orders o JOIN payments p ON p.order_id = o.id AND p.provider = 'payhere' WHERE o.order_number = $1 FOR UPDATE OF o, p`, [f.order_id]);
    const ord = o.rows[0];
    if (!ord) { await record(c, null, 'rejected:unknown_order'); return { http: 400 as const, result: 'rejected:unknown_order' }; }
    if (f.payhere_currency !== ord.currency) { await record(c, ord.payment_id, 'rejected:wrong_currency'); return { http: 400 as const, result: 'rejected:wrong_currency' }; }
    const amt = parseAmount(f.payhere_amount ?? '');
    if (amt === null || amt !== Number(ord.total_cents)) { await record(c, ord.payment_id, 'rejected:wrong_amount'); return { http: 400 as const, result: 'rejected:wrong_amount' }; }

    // Duplicate delivery of the same notification -> acknowledge, change nothing.
    // The order row is locked above, so two copies arriving together are handled one after the other.
    const seen = await c.query(`SELECT 1 FROM payment_events WHERE dedupe_key = $1`, [dedupe]);
    if (seen.rowCount) return { http: 200 as const, result: 'duplicate' };
    // payment_events is append-only: one row per notification, written with its final result
    const outcome = async (r: string) => { await record(c, ord.payment_id, r); return r; };

    if (ord.provider_payment_id && f.payment_id && ord.provider_payment_id !== f.payment_id && code === STATUS.SUCCESS && ord.payment_status === 'paid') {
      await c.query(`UPDATE orders SET needs_review = true, review_reason = 'second successful PayHere payment ' || $2 WHERE id = $1`, [ord.id, f.payment_id]);
      await audit(c, actor, 'payment.second_success', 'order', ord.id, undefined, { payment_id: f.payment_id });
      return { http: 200 as const, result: await outcome('review:second_payment') };
    }

    if (code === STATUS.SUCCESS) {
      if (ord.payment_status === 'paid') return { http: 200 as const, result: await outcome('ignored:already_paid') };
      let stockOk = await consumeReservations(c, ord.id);
      let review = '';
      if (!stockOk) { stockOk = await retakeStock(c, ord.id); if (!stockOk) review = 'paid after reservation expired and stock is no longer available — refund or restock needed'; }
      const newStatus = stockOk ? 'confirmed' : ord.status;
      await c.query(`UPDATE payments SET status = 'paid', provider_payment_id = coalesce($2, provider_payment_id), method = $3, card_mask = $4, paid_at = now() WHERE id = $1`,
        [ord.payment_id, f.payment_id || null, payload.method || null, payload.card_no || null]);
      await c.query(`UPDATE orders SET payment_status = 'paid', paid_at = now(), status = $2, needs_review = needs_review OR $3, review_reason = CASE WHEN $3 THEN $4 ELSE review_reason END WHERE id = $1`,
        [ord.id, newStatus, !!review, review]);
      if (stockOk) await markSold(c, ord.id);
      if (newStatus !== ord.status) await history(c, ord.id, ord.status, newStatus, 'payhere', 'payment confirmed by PayHere ' + (f.payment_id || ''));
      await audit(c, actor, 'payment.paid', 'order', ord.id, undefined, { payment_id: f.payment_id, review: review || undefined });
      return { http: 200 as const, result: await outcome(review ? 'applied:paid_needs_review' : 'applied:paid') };
    }
    if (code === STATUS.PENDING) {
      if (ord.payment_status !== 'pending') return { http: 200 as const, result: await outcome('ignored:not_pending') };
      await c.query(`UPDATE payments SET status = 'pending', provider_payment_id = coalesce($2, provider_payment_id) WHERE id = $1`, [ord.payment_id, f.payment_id || null]);
      return { http: 200 as const, result: await outcome('applied:pending') };
    }
    if (code === STATUS.CANCELLED || code === STATUS.FAILED) {
      // a late "cancelled/failed" must never undo a confirmed payment
      if (ord.payment_status === 'paid' || ord.payment_status === 'chargeback' || ord.payment_status === 'refunded') return { http: 200 as const, result: await outcome('ignored:already_final') };
      const ps = code === STATUS.FAILED ? 'failed' : 'cancelled';
      await releaseReservations(c, ord.id);
      await c.query(`UPDATE payments SET status = $2, provider_payment_id = coalesce($3, provider_payment_id) WHERE id = $1`, [ord.payment_id, ps, f.payment_id || null]);
      await c.query(`UPDATE orders SET payment_status = $2, status = 'cancelled', cancelled_at = now() WHERE id = $1`, [ord.id, ps]);
      if (ord.status !== 'cancelled') await history(c, ord.id, ord.status, 'cancelled', 'payhere', 'payment ' + ps);
      await audit(c, actor, 'payment.' + ps, 'order', ord.id);
      return { http: 200 as const, result: await outcome('applied:' + ps) };
    }
    // chargeback: money taken back by the bank. Do not auto-restock: staff decide (goods may already be delivered).
    await c.query(`UPDATE payments SET status = 'chargeback' WHERE id = $1`, [ord.payment_id]);
    await c.query(`UPDATE orders SET payment_status = 'chargeback', needs_review = true, review_reason = 'chargeback received from PayHere' WHERE id = $1`, [ord.id]);
    await audit(c, actor, 'payment.chargeback', 'order', ord.id);
    return { http: 200 as const, result: await outcome('applied:chargeback') };
  });
}

// ---------------- staff actions ----------------

async function lockOrder(c: PoolClient, number: string) {
  const r = await c.query(`SELECT * FROM orders WHERE order_number = $1 FOR UPDATE`, [number]);
  if (!r.rowCount) throw notFound('Order not found.');
  return r.rows[0];
}

/** Finance confirms a bank transfer arrived in the bank account (checked in the bank, not from a screenshot). */
export async function verifyBankTransfer(db: Pool, number: string, reference: string, actor: Actor & { id: string }) {
  return tx(db, async c => {
    const o = await lockOrder(c, number);
    if (o.payment_method !== 'bank_transfer') throw badRequest('This order is not a bank transfer order.');
    if (o.payment_status === 'paid') throw conflict('This transfer was already confirmed.');
    if (!['awaiting_bank_transfer', 'expired'].includes(o.status)) throw badRequest('This order cannot be confirmed in its current status.');
    let ok = await consumeReservations(c, o.id);
    if (!ok) ok = await retakeStock(c, o.id);
    if (!ok) throw conflict('Not enough stock left for this order. Restock first, or cancel and refund the transfer.');
    await c.query(`UPDATE payments SET status = 'verified', reference = $2, verified_by = $3, verified_at = now(), paid_at = now() WHERE order_id = $1 AND provider = 'bank_transfer'`, [o.id, reference, actor.id]);
    await c.query(`UPDATE orders SET payment_status = 'paid', paid_at = now(), status = 'confirmed' WHERE id = $1`, [o.id]);
    await markSold(c, o.id);
    await history(c, o.id, o.status, 'confirmed', 'staff:' + actor.label, 'bank transfer verified, ref ' + reference);
    await audit(c, actor, 'payment.bank_verified', 'order', o.id, undefined, { reference });
  });
}

/** Courier handed over the cash for a COD order. */
export async function markCodCollected(db: Pool, number: string, actor: Actor & { id: string }) {
  return tx(db, async c => {
    const o = await lockOrder(c, number);
    if (o.payment_method !== 'cod') throw badRequest('This is not a Cash on Delivery order.');
    if (o.payment_status === 'cod_collected') throw conflict('Cash was already recorded as collected.');
    if (o.status === 'cancelled') throw badRequest('This order is cancelled.');
    await c.query(`UPDATE payments SET status = 'cod_collected', verified_by = $2, verified_at = now(), paid_at = now() WHERE order_id = $1 AND provider = 'cod'`, [o.id, actor.id]);
    await c.query(`UPDATE orders SET payment_status = 'cod_collected', paid_at = now() WHERE id = $1`, [o.id]);
    await audit(c, actor, 'payment.cod_collected', 'order', o.id);
  });
}

const FLOW = ['confirmed', 'processing', 'shipped', 'arrived_lk', 'delivered'];
/** Fulfilment status changes (forward only, or one step back to fix a mistake). Payment must be settled for card/bank orders. */
export async function setFulfilmentStatus(db: Pool, number: string, to: string, note: string, actor: Actor & { id: string }) {
  if (!FLOW.includes(to)) throw badRequest('Unknown status.');
  return tx(db, async c => {
    const o = await lockOrder(c, number);
    const from = FLOW.indexOf(o.status);
    if (from < 0) throw badRequest(`An order that is "${o.status.replace(/_/g, ' ')}" cannot be moved to ${to}.`);
    const target = FLOW.indexOf(to);
    if (target > from + 1 && o.payment_method !== 'cod' && o.payment_status !== 'paid') throw badRequest('Payment is not confirmed yet.');
    if (target < from - 1) throw badRequest('You can only move an order one step back.');
    if (target === from) return;
    await c.query(`UPDATE orders SET status = $2 WHERE id = $1`, [o.id, to]);
    await history(c, o.id, o.status, to, 'staff:' + actor.label, note);
    await audit(c, actor, 'order.status', 'order', o.id, { status: o.status }, { status: to, note });
  });
}

/** Cancel an order. Paid orders need a refund record (refunds.create permission is checked by the route). */
export async function cancelOrder(db: Pool, number: string, reason: string, actor: Actor & { id: string }, refund?: { amountCents: number; restock: boolean }) {
  return tx(db, async c => {
    const o = await lockOrder(c, number);
    if (['cancelled', 'expired', 'refunded'].includes(o.status)) throw conflict('This order is already closed.');
    if (o.status === 'delivered' && !refund) throw badRequest('Delivered orders are closed with a refund/return, not a cancel.');
    const paid = o.payment_status === 'paid' || o.payment_status === 'cod_collected';
    if (paid && !refund) throw badRequest('This order is paid. Record a refund to cancel it.');
    if (refund && (refund.amountCents <= 0 || refund.amountCents > Number(o.total_cents))) throw badRequest('Refund amount must be between 0 and the order total.');
    await releaseReservations(c, o.id, 'reservation_released');
    if (!refund || refund.restock) await restock(c, o.id, actor.id, refund ? 'return' : 'order_cancelled');
    let newPay = o.payment_status;
    if (refund) {
      const pay = await c.query(`SELECT id FROM payments WHERE order_id = $1 ORDER BY created_at LIMIT 1`, [o.id]);
      await c.query(`INSERT INTO refunds (order_id, payment_id, amount_cents, reason, restock, staff_id) VALUES ($1,$2,$3,$4,$5,$6)`, [o.id, pay.rows[0]?.id || null, refund.amountCents, reason, refund.restock, actor.id]);
      newPay = refund.amountCents === Number(o.total_cents) ? 'refunded' : 'partially_refunded';
    } else if (['pending', 'unpaid', 'cod_pending'].includes(o.payment_status)) newPay = 'cancelled';
    const newStatus = refund && refund.amountCents === Number(o.total_cents) ? 'refunded' : 'cancelled';
    await c.query(`UPDATE orders SET status = $2, payment_status = $3, cancelled_at = now() WHERE id = $1`, [o.id, newStatus, newPay]);
    await c.query(`UPDATE payments SET status = CASE WHEN $2 THEN 'refunded' ELSE 'cancelled' END WHERE order_id = $1 AND status NOT IN ('chargeback')`, [o.id, !!refund]);
    await history(c, o.id, o.status, newStatus, 'staff:' + actor.label, reason);
    await audit(c, actor, refund ? 'order.refund' : 'order.cancel', 'order', o.id, undefined, { reason, refund });
  });
}
