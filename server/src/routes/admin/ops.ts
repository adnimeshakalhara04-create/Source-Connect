import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { requireStaff, actorOf } from '../../auth/staff.js';
import { audit } from '../../lib/audit.js';

const rs = (c: number) => c / 100;

export default async function adminOps(app: FastifyInstance) {
  const db = app.db, cfg = app.config;

  async function backupHealth() {
    const r = await db.query(`SELECT DISTINCT ON (kind) kind, status, started_at, finished_at, detail FROM backup_job_status ORDER BY kind, started_at DESC`);
    const by = Object.fromEntries(r.rows.map(x => [x.kind, x]));
    const lastOk = await db.query(`SELECT max(finished_at) AS t FROM backup_job_status WHERE kind IN ('full','diff','incr') AND status = 'ok'`);
    const t = lastOk.rows[0].t ? new Date(lastOk.rows[0].t) : null;
    const ageH = t ? (Date.now() - t.getTime()) / 3.6e6 : null;
    const problems: string[] = [];
    if (!t) problems.push('No successful backup has been recorded yet.');
    else if (ageH! > cfg.BACKUP_MAX_AGE_HOURS) problems.push(`Last successful backup is ${Math.round(ageH!)} hours old.`);
    if (by.check?.status === 'failed') problems.push('The last backup check (WAL archiving) failed.');
    if (by.restore_test && by.restore_test.status === 'failed') problems.push('The last restore test failed.');
    return { ok: problems.length === 0, problems, lastSuccessfulBackupAt: t, latest: by };
  }

  app.get('/dashboard', { preHandler: requireStaff(db, 'dashboard.view'), schema: { tags: ['admin-ops'] } }, async (req) => {
    const shopIds = req.staff!.shopIds;
    const sf = shopIds === null ? '' : ` AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.shop_id = ANY($1))`;
    const args = shopIds === null ? [] : [shopIds];
    const [sum, byStatus, days, low, review, pay] = await Promise.all([
      db.query(`SELECT coalesce(sum(total_cents) FILTER (WHERE payment_status IN ('paid','cod_collected')), 0) AS received,
          coalesce(sum(total_cents) FILTER (WHERE status NOT IN ('cancelled','expired','refunded','pending_payment')), 0) AS booked,
          count(*) FILTER (WHERE status NOT IN ('cancelled','expired')) AS orders FROM orders o WHERE true${sf}`, args),
      db.query(`SELECT status, count(*)::int n FROM orders o WHERE true${sf} GROUP BY status`, args),
      db.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(sum(o.total_cents) FILTER (WHERE o.status NOT IN ('cancelled','expired','pending_payment')), 0) AS total
          FROM generate_series((now() AT TIME ZONE 'Asia/Colombo')::date - 6, (now() AT TIME ZONE 'Asia/Colombo')::date, interval '1 day') d
          LEFT JOIN orders o ON (o.placed_at AT TIME ZONE 'Asia/Colombo')::date = d::date${sf} GROUP BY d ORDER BY d`, args),
      db.query(`SELECT p.slug, p.name, v.size, i.on_hand - i.reserved AS available, i.reorder_level FROM inventory i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
          WHERE p.status = 'active' AND v.active AND i.on_hand - i.reserved <= i.reorder_level ${shopIds === null ? '' : 'AND p.shop_id = ANY($1)'} ORDER BY available, p.name LIMIT 50`, args),
      db.query(`SELECT count(*)::int n FROM orders o WHERE needs_review${sf}`, args),
      db.query(`SELECT count(*) FILTER (WHERE status = 'awaiting_bank_transfer')::int AS bank, count(*) FILTER (WHERE payment_status = 'cod_pending' AND status = 'delivered')::int AS cod_uncollected,
          count(*) FILTER (WHERE status = 'pending_payment')::int AS card_pending FROM orders o WHERE true${sf}`, args),
    ]);
    const s = sum.rows[0];
    const can = (p: string) => req.staff!.permissions.has(p);
    return {
      received: rs(Number(s.received)), booked: rs(Number(s.booked)), orders: Number(s.orders),
      byStatus: Object.fromEntries(byStatus.rows.map(r => [r.status, r.n])), last7days: days.rows.map(r => ({ day: r.day, total: rs(Number(r.total)) })),
      lowStock: low.rows, needsReview: review.rows[0].n, payments: pay.rows[0],
      backups: can('backups.read') ? await backupHealth() : undefined,
      payhere: { mode: cfg.PAYHERE_MODE, configured: !!(cfg.PAYHERE_MERCHANT_ID && cfg.PAYHERE_MERCHANT_SECRET) },
    };
  });

  app.get('/customers', { preHandler: requireStaff(db, 'customers.read'), schema: { tags: ['admin-ops'] } }, async (req) => {
    const q = parse(z.strictObject({ q: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    // one row per phone number (guests) or account
    const r = await db.query(`
      SELECT coalesce(c.id::text, 'phone:' || o.ship_phone) AS key, max(coalesce(c.name, o.ship_name)) AS name, max(o.ship_phone) AS phone, max(coalesce(c.email, o.ship_email)) AS email,
             bool_or(c.id IS NOT NULL) AS account, bool_or(c.email_verified_at IS NOT NULL) AS verified,
             count(o.id)::int AS orders, coalesce(sum(o.total_cents) FILTER (WHERE o.payment_status IN ('paid','cod_collected')), 0) AS spent, max(o.placed_at) AS last_order
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ($1::text IS NULL OR o.ship_name ILIKE '%' || $1 || '%' OR o.ship_phone ILIKE '%' || $1 || '%' OR o.ship_email ILIKE '%' || $1 || '%')
       GROUP BY 1 ORDER BY max(o.placed_at) DESC LIMIT $2 OFFSET $3`, [q.q ?? null, q.limit, q.offset]);
    await audit(db, actorOf(req), 'customers.list', 'customers', null, undefined, { q: q.q ?? null });
    return r.rows.map(x => ({ ...x, spent: rs(Number(x.spent)) }));
  });

  app.get('/audit', { preHandler: requireStaff(db, 'audit.read'), schema: { tags: ['admin-ops'] } }, async (req) => {
    const q = parse(z.strictObject({ before: z.coerce.number().int().optional(), action: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    const r = await db.query(`SELECT id, actor_type, actor_label, action, entity_type, entity_id, before, after, ip, created_at FROM audit_logs
      WHERE ($1::bigint IS NULL OR id < $1) AND ($2::text IS NULL OR action LIKE $2 || '%') ORDER BY id DESC LIMIT $3`, [q.before ?? null, q.action ?? null, q.limit]);
    return r.rows;
  });

  app.get('/backups', { preHandler: requireStaff(db, 'backups.read'), schema: { tags: ['admin-ops'], summary: 'Read-only backup health (no credentials)' } }, async () => {
    const h = await backupHealth();
    const recent = await db.query(`SELECT kind, status, started_at, finished_at, detail FROM backup_job_status ORDER BY started_at DESC LIMIT 50`);
    return { ...h, recent: recent.rows };
  });

  // ---------- promo codes ----------
  app.get('/coupons', { preHandler: requireStaff(db, 'settings.write'), schema: { tags: ['admin-ops'] } }, async () => {
    const r = await db.query(`SELECT c.*, (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id)::int AS used FROM coupons c ORDER BY created_at DESC`);
    return r.rows.map(c => ({ ...c, value: c.kind === 'fixed' ? rs(Number(c.value)) : Number(c.value), min_subtotal: rs(Number(c.min_subtotal_cents)) }));
  });
  app.post('/coupons', { preHandler: requireStaff(db, 'settings.write'), schema: { tags: ['admin-ops'] } }, async (req) => {
    const b = parse(z.strictObject({ code: z.string().regex(/^[A-Za-z0-9_-]{3,30}$/), kind: z.enum(['percent', 'fixed']), value: z.number().positive(), minSubtotal: z.number().min(0).default(0),
      startsAt: z.string().datetime({ offset: true }).optional(), endsAt: z.string().datetime({ offset: true }).optional(), maxRedemptions: z.number().int().positive().optional(), active: z.boolean().default(true) }), req.body);
    if (b.kind === 'percent' && (b.value < 1 || b.value > 90 || !Number.isInteger(b.value))) throw badRequest('Percent discounts must be a whole number from 1 to 90.');
    const value = b.kind === 'percent' ? b.value : Math.round(b.value * 100);
    const r = await db.query(`INSERT INTO coupons (code, kind, value, min_subtotal_cents, starts_at, ends_at, max_redemptions, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.code, b.kind, value, Math.round(b.minSubtotal * 100), b.startsAt ?? null, b.endsAt ?? null, b.maxRedemptions ?? null, b.active]);
    await audit(db, actorOf(req), 'coupon.create', 'coupon', r.rows[0].id, undefined, b);
    return { id: r.rows[0].id };
  });
  app.put('/coupons/:id', { preHandler: requireStaff(db, 'settings.write'), schema: { tags: ['admin-ops'] } }, async (req) => {
    const { id } = parse(z.strictObject({ id: z.string().uuid() }), req.params);
    const b = parse(z.strictObject({ active: z.boolean() }), req.body);
    await db.query(`UPDATE coupons SET active = $2 WHERE id = $1`, [id, b.active]);
    await audit(db, actorOf(req), 'coupon.update', 'coupon', id, undefined, b);
    return { ok: true };
  });
}
