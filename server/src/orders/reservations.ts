import type { Pool, PoolClient } from 'pg';
import { tx } from '../db/pool.js';

/** Reserve stock for an order (inside the order transaction, rows already locked by priceCart). */
export async function reserve(c: PoolClient, orderId: string, items: { variantId: string; qty: number }[], minutes: number) {
  for (const it of items) {
    const u = await c.query(`UPDATE inventory SET reserved = reserved + $2 WHERE variant_id = $1 AND on_hand - reserved >= $2`, [it.variantId, it.qty]);
    if (u.rowCount !== 1) throw new StockError();
    await c.query(`INSERT INTO stock_reservations (order_id, variant_id, quantity, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))`, [orderId, it.variantId, it.qty, minutes]);
    await c.query(`INSERT INTO inventory_movements (variant_id, delta_reserved, reason, order_id) VALUES ($1,$2,'order_reserved',$3)`, [it.variantId, it.qty, orderId]);
  }
}

/** Take stock straight away (Cash on Delivery). */
export async function takeStock(c: PoolClient, orderId: string, items: { variantId: string; qty: number }[], staffId: string | null = null) {
  for (const it of items) {
    const u = await c.query(`UPDATE inventory SET on_hand = on_hand - $2 WHERE variant_id = $1 AND on_hand - reserved >= $2`, [it.variantId, it.qty]);
    if (u.rowCount !== 1) throw new StockError();
    await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, reason, order_id, staff_id) VALUES ($1,$2,'order_consumed',$3,$4)`, [it.variantId, -it.qty, orderId, staffId]);
  }
}

/** Payment confirmed: turn active reservations into sold stock. Returns false if they had already expired. */
export async function consumeReservations(c: PoolClient, orderId: string): Promise<boolean> {
  const r = await c.query(`SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = $1 AND state = 'active' ORDER BY variant_id FOR UPDATE`, [orderId]);
  if (!r.rowCount) return false;
  for (const x of r.rows) {
    await c.query(`UPDATE inventory SET on_hand = on_hand - $2, reserved = reserved - $2 WHERE variant_id = $1`, [x.variant_id, x.quantity]);
    await c.query(`UPDATE stock_reservations SET state = 'consumed' WHERE id = $1`, [x.id]);
    await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, delta_reserved, reason, order_id) VALUES ($1,$2,$3,'order_consumed',$4)`, [x.variant_id, -x.quantity, -x.quantity, orderId]);
  }
  return true;
}

/** Give reserved stock back (cancelled, failed or expired payment). Returns the number released. */
export async function releaseReservations(c: PoolClient, orderId: string, reason = 'reservation_released'): Promise<number> {
  const r = await c.query(`SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = $1 AND state = 'active' ORDER BY variant_id FOR UPDATE`, [orderId]);
  for (const x of r.rows) {
    await c.query(`UPDATE inventory SET reserved = reserved - $2 WHERE variant_id = $1`, [x.variant_id, x.quantity]);
    await c.query(`UPDATE stock_reservations SET state = 'released' WHERE id = $1`, [x.id]);
    await c.query(`INSERT INTO inventory_movements (variant_id, delta_reserved, reason, order_id) VALUES ($1,$2,$3,$4)`, [x.variant_id, -x.quantity, reason, orderId]);
  }
  return r.rowCount ?? 0;
}

/** Put sold stock back on the shelf (cancelled COD order, refund with restock). */
export async function restock(c: PoolClient, orderId: string, staffId: string | null, reason: 'order_cancelled' | 'return') {
  const sold = await c.query(`
    SELECT variant_id, -sum(delta_on_hand)::int AS qty FROM inventory_movements
     WHERE order_id = $1 AND reason IN ('order_consumed','order_cancelled','return') AND variant_id IS NOT NULL
     GROUP BY variant_id HAVING -sum(delta_on_hand) > 0 ORDER BY variant_id`, [orderId]);
  for (const x of sold.rows) {
    await c.query(`UPDATE inventory SET on_hand = on_hand + $2 WHERE variant_id = $1`, [x.variant_id, x.qty]);
    await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, reason, order_id, staff_id) VALUES ($1,$2,$3,$4,$5)`, [x.variant_id, x.qty, reason, orderId, staffId]);
  }
  return sold.rowCount ?? 0;
}

/** Background job: expire unpaid orders whose reservation time is over. */
export async function releaseExpiredReservations(db: Pool): Promise<number> {
  const due = await db.query(`SELECT DISTINCT order_id FROM stock_reservations WHERE state = 'active' AND expires_at <= now() LIMIT 200`);
  let n = 0;
  for (const { order_id } of due.rows) {
    n += await tx(db, async c => {
      const o = await c.query(`SELECT id, status, payment_status FROM orders WHERE id = $1 FOR UPDATE SKIP LOCKED`, [order_id]);
      const ord = o.rows[0];
      if (!ord) return 0;
      const still = await c.query(`SELECT 1 FROM stock_reservations WHERE order_id = $1 AND state = 'active' AND expires_at <= now() LIMIT 1`, [order_id]);
      if (!still.rowCount) return 0;
      const released = await releaseReservations(c, order_id);
      if (ord.status === 'pending_payment' || ord.status === 'awaiting_bank_transfer') {
        await c.query(`UPDATE orders SET status = 'expired', payment_status = CASE WHEN payment_status IN ('pending','unpaid') THEN 'cancelled' ELSE payment_status END WHERE id = $1`, [order_id]);
        await c.query(`UPDATE payments SET status = 'cancelled' WHERE order_id = $1 AND status IN ('initiated','pending','awaiting_receipt')`, [order_id]);
        await c.query(`INSERT INTO order_status_history (order_id, from_status, to_status, actor, note) VALUES ($1,$2,'expired','system','payment not received in time; stock released')`, [order_id, ord.status]);
      }
      return released ? 1 : 0;
    });
  }
  return n;
}

export class StockError extends Error { constructor() { super('stock changed'); } }
