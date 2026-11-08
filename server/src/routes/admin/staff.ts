import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { hashPassword, passwordProblem } from '../../auth/passwords.js';
import { requireStaff, actorOf } from '../../auth/staff.js';
import { audit } from '../../lib/audit.js';
import { tx } from '../../db/pool.js';

export default async function adminStaff(app: FastifyInstance) {
  const db = app.db;
  const guard = requireStaff(db, 'staff.manage');

  app.get('/staff', { preHandler: guard, schema: { tags: ['admin-staff'] } }, async () => {
    const r = await db.query(`SELECT u.id, u.username, u.email, u.display_name, u.status, u.last_login_at, u.locked_until, u.must_change_password,
        coalesce(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
        coalesce(array_agg(DISTINCT sh.slug) FILTER (WHERE sh.slug IS NOT NULL), '{}') AS shops
      FROM staff_users u LEFT JOIN staff_roles sr ON sr.staff_id = u.id LEFT JOIN roles r ON r.id = sr.role_id
      LEFT JOIN staff_shop_access a ON a.staff_id = u.id LEFT JOIN shops sh ON sh.id = a.shop_id
      GROUP BY u.id ORDER BY u.created_at`);
    const roles = await db.query(`SELECT r.code, r.name, r.description, r.shop_scoped, array_agg(rp.permission ORDER BY rp.permission) AS permissions
      FROM roles r JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name`);
    return { staff: r.rows, roles: roles.rows };
  });

  const Body = z.strictObject({
    username: z.string().regex(/^[A-Za-z0-9._-]{3,40}$/),
    displayName: z.string().min(1).max(80),
    email: z.string().email().max(200).optional().or(z.literal('')),
    roles: z.array(z.string().max(40)).min(1).max(7),
    shops: z.array(z.string().max(80)).max(20).default([]),
    temporaryPassword: z.string().max(200),
  });
  app.post('/staff', { preHandler: guard, schema: { tags: ['admin-staff'], summary: 'Create a staff account (must change password at first login)' } }, async (req) => {
    const b = parse(Body, req.body);
    const problem = passwordProblem(b.temporaryPassword, b.username); if (problem) throw badRequest(problem);
    const hash = await hashPassword(b.temporaryPassword);
    const id = await tx(db, async c => {
      const u = await c.query(`INSERT INTO staff_users (username, email, display_name, password_hash, must_change_password) VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [b.username, b.email || null, b.displayName, hash]);
      await setRolesAndShops(c, u.rows[0].id, b.roles, b.shops);
      return u.rows[0].id as string;
    });
    await audit(db, actorOf(req), 'staff.create', 'staff', id, undefined, { username: b.username, roles: b.roles, shops: b.shops });
    return { id };
  });

  app.put('/staff/:id', { preHandler: guard, schema: { tags: ['admin-staff'] } }, async (req) => {
    const { id } = parse(z.strictObject({ id: z.string().uuid() }), req.params);
    const b = parse(z.strictObject({ displayName: z.string().min(1).max(80).optional(), roles: z.array(z.string()).min(1).max(7).optional(), shops: z.array(z.string()).max(20).optional(),
      status: z.enum(['active', 'disabled']).optional(), unlock: z.boolean().optional(), resetPassword: z.string().max(200).optional() }), req.body);
    if (id === req.staff!.id && (b.status === 'disabled' || (b.roles && !b.roles.includes('owner') && req.staff!.roles.includes('owner'))))
      throw badRequest('You cannot disable yourself or remove your own owner role.');
    await tx(db, async c => {
      const cur = await c.query(`SELECT id, username FROM staff_users WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur.rowCount) throw notFound('Staff member not found.');
      if (b.displayName) await c.query(`UPDATE staff_users SET display_name = $2 WHERE id = $1`, [id, b.displayName]);
      if (b.status) await c.query(`UPDATE staff_users SET status = $2 WHERE id = $1`, [id, b.status]);
      if (b.status === 'disabled') await c.query(`UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = $1 AND revoked_at IS NULL`, [id]);
      if (b.unlock) await c.query(`UPDATE staff_users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [id]);
      if (b.resetPassword) {
        const p = passwordProblem(b.resetPassword, cur.rows[0].username); if (p) throw badRequest(p);
        await c.query(`UPDATE staff_users SET password_hash = $2, must_change_password = true WHERE id = $1`, [id, await hashPassword(b.resetPassword)]);
        await c.query(`UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = $1 AND revoked_at IS NULL`, [id]);
      }
      if (b.roles || b.shops) await setRolesAndShops(c, id, b.roles, b.shops);
      // never leave the shop without an active owner
      const owners = await c.query(`SELECT count(*)::int AS n FROM staff_users u JOIN staff_roles sr ON sr.staff_id = u.id JOIN roles r ON r.id = sr.role_id WHERE r.code = 'owner' AND u.status = 'active'`);
      if (owners.rows[0].n < 1) throw badRequest('At least one active owner account is required.');
    });
    await audit(db, actorOf(req), 'staff.update', 'staff', id, undefined, { ...b, resetPassword: b.resetPassword ? '[set]' : undefined });
    return { ok: true };
  });
}

async function setRolesAndShops(c: import('pg').PoolClient, staffId: string, roles?: string[], shops?: string[]) {
  if (roles) {
    const r = await c.query(`SELECT id, code FROM roles WHERE code = ANY($1)`, [roles]);
    if (r.rowCount !== new Set(roles).size) throw badRequest('Unknown role.');
    await c.query(`DELETE FROM staff_roles WHERE staff_id = $1`, [staffId]);
    for (const row of r.rows) await c.query(`INSERT INTO staff_roles (staff_id, role_id) VALUES ($1,$2)`, [staffId, row.id]);
  }
  if (shops) {
    const s = await c.query(`SELECT id FROM shops WHERE slug = ANY($1)`, [shops]);
    if (s.rowCount !== new Set(shops).size) throw badRequest('Unknown department.');
    await c.query(`DELETE FROM staff_shop_access WHERE staff_id = $1`, [staffId]);
    for (const row of s.rows) await c.query(`INSERT INTO staff_shop_access (staff_id, shop_id) VALUES ($1,$2)`, [staffId, row.id]);
  }
}
