import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { HttpError, badRequest, unauthorized } from '../../lib/errors.js';
import { hashPassword, verifyPassword, burnTime, passwordProblem } from '../../auth/passwords.js';
import { STAFF_COOKIE, createStaffSession, cookieOpts, requireStaff, actorOf } from '../../auth/staff.js';
import { audit } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';

const MAX_FAILS = 5;

export default async function adminAuth(app: FastifyInstance) {
  const db = app.db, cfg = app.config;
  const path = '/api/v1/admin';

  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['admin-auth'], summary: 'Staff sign in (sets an HttpOnly session cookie, returns a CSRF token)' },
  }, async (req, reply) => {
    const body = parse(z.strictObject({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }), req.body);
    const sys = { type: 'system' as const, label: body.username.slice(0, 60), ip: req.ip, ua: String(req.headers['user-agent'] || ''), requestId: req.id };
    const r = await db.query(`SELECT id, username, display_name, password_hash, status, failed_logins, locked_until, must_change_password FROM staff_users WHERE username = $1`, [body.username]);
    const u = r.rows[0];
    if (!u || u.status !== 'active') {
      await burnTime(body.password);
      await audit(db, sys, 'auth.login_failed', 'staff', null, undefined, { reason: u ? 'disabled' : 'unknown_user' });
      throw unauthorized('Incorrect username or password.');
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      await audit(db, sys, 'auth.login_locked', 'staff', u.id);
      throw new HttpError(429, 'locked', 'Too many wrong passwords. Try again in 15 minutes or ask the owner to unlock the account.');
    }
    if (!(await verifyPassword(u.password_hash, body.password))) {
      const fails = u.failed_logins + 1;
      await db.query(`UPDATE staff_users SET failed_logins = $2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`, [u.id, fails, MAX_FAILS]);
      await audit(db, sys, 'auth.login_failed', 'staff', u.id, undefined, { reason: 'bad_password', fails });
      throw unauthorized('Incorrect username or password.');
    }
    await db.query(`UPDATE staff_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
    const { sid, csrf } = await createStaffSession(db, cfg, u.id, req.ip, String(req.headers['user-agent'] || ''));
    reply.setCookie(STAFF_COOKIE, sid, cookieOpts(cfg, path, cfg.STAFF_SESSION_HOURS * 3600));
    await audit(db, { ...sys, type: 'staff', id: u.id, label: u.username }, 'auth.login', 'staff', u.id);
    return { csrfToken: csrf, staff: { username: u.username, displayName: u.display_name, mustChangePassword: u.must_change_password } };
  });

  app.get('/auth/session', { preHandler: requireStaff(db), schema: { tags: ['admin-auth'] } }, async (req) => {
    const s = req.staff!;
    // Rotate the CSRF token on every session read so a reload of the admin gets a fresh one.
    const { randomToken } = await import('../../lib/crypto.js');
    const csrf = randomToken(24);
    await db.query(`UPDATE staff_sessions SET csrf_hash = $2 WHERE id_hash = $1`, [s.sessionHash, sha256(csrf)]);
    return { csrfToken: csrf, staff: { username: s.username, displayName: s.displayName, roles: s.roles, permissions: [...s.permissions].sort(), mustChangePassword: s.mustChangePassword, allShops: s.shopIds === null } };
  });

  app.post('/auth/logout', { preHandler: requireStaff(db), schema: { tags: ['admin-auth'] } }, async (req, reply) => {
    await db.query(`UPDATE staff_sessions SET revoked_at = now() WHERE id_hash = $1`, [req.staff!.sessionHash]);
    reply.clearCookie(STAFF_COOKIE, cookieOpts(cfg, path));
    await audit(db, actorOf(req), 'auth.logout', 'staff', req.staff!.id);
    return { ok: true };
  });

  app.post('/auth/password', { preHandler: requireStaff(db), config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['admin-auth'] } }, async (req) => {
    const b = parse(z.strictObject({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }), req.body);
    const s = req.staff!;
    const r = await db.query(`SELECT password_hash FROM staff_users WHERE id = $1`, [s.id]);
    if (!(await verifyPassword(r.rows[0].password_hash, b.currentPassword))) throw badRequest('Your current password is not correct.');
    const problem = passwordProblem(b.newPassword, s.username);
    if (problem) throw badRequest(problem);
    if (b.newPassword === b.currentPassword) throw badRequest('Choose a different password.');
    await db.query(`UPDATE staff_users SET password_hash = $2, must_change_password = false WHERE id = $1`, [s.id, await hashPassword(b.newPassword)]);
    // sign out every other session of this person
    await db.query(`UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = $1 AND id_hash <> $2 AND revoked_at IS NULL`, [s.id, s.sessionHash]);
    await audit(db, actorOf(req), 'auth.password_changed', 'staff', s.id);
    return { ok: true };
  });
}
