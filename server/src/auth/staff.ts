import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { forbidden, unauthorized, HttpError } from '../lib/errors.js';
import type { Config } from '../config.js';

export const STAFF_COOKIE = 'sc_staff';
export const CSRF_HEADER = 'x-csrf-token';

export interface StaffPrincipal {
  id: string; username: string; displayName: string; mustChangePassword: boolean;
  roles: string[]; permissions: Set<string>; shopIds: string[] | null; // null = all shops
  sessionHash: string; csrfHash: string;
}

declare module 'fastify' {
  interface FastifyRequest { staff?: StaffPrincipal }
}

export function cookieOpts(cfg: Config, path: string, maxAgeSec?: number) {
  return { httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: cfg.COOKIE_SAMESITE, path, domain: cfg.COOKIE_DOMAIN || undefined, ...(maxAgeSec ? { maxAge: maxAgeSec } : {}) } as const;
}

/** Creates a session row and returns the raw cookie value and CSRF token (only hashes are stored). */
export async function createStaffSession(db: Pool, cfg: Config, staffId: string, ip: string, ua: string) {
  const sid = randomToken(32), csrf = randomToken(24);
  await db.query(`INSERT INTO staff_sessions (id_hash, staff_id, csrf_hash, expires_at, ip, user_agent)
    VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5, $6)`, [sha256(sid), staffId, sha256(csrf), cfg.STAFF_SESSION_HOURS, ip, ua.slice(0, 300)]);
  return { sid, csrf };
}

export async function loadStaffBySession(db: Pool, sid: string): Promise<StaffPrincipal | null> {
  const r = await db.query(`
    SELECT s.id_hash, s.csrf_hash, u.id, u.username, u.display_name, u.must_change_password,
           coalesce(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
           coalesce(array_agg(DISTINCT rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS perms,
           bool_and(coalesce(r.shop_scoped, true)) AS all_scoped,
           coalesce((SELECT array_agg(shop_id) FROM staff_shop_access a WHERE a.staff_id = u.id), '{}') AS shop_ids
      FROM staff_sessions s
      JOIN staff_users u ON u.id = s.staff_id AND u.status = 'active'
      LEFT JOIN staff_roles sr ON sr.staff_id = u.id
      LEFT JOIN roles r ON r.id = sr.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE s.id_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
     GROUP BY s.id_hash, s.csrf_hash, u.id`, [sha256(sid)]);
  const row = r.rows[0];
  if (!row) return null;
  // touch at most once a minute
  db.query(`UPDATE staff_sessions SET last_seen_at = now() WHERE id_hash = $1 AND last_seen_at < now() - interval '1 minute'`, [row.id_hash]).catch(() => {});
  return {
    id: row.id, username: row.username, displayName: row.display_name, mustChangePassword: row.must_change_password,
    roles: row.roles, permissions: new Set(row.perms), shopIds: row.all_scoped && row.roles.length ? row.shop_ids : null,
    sessionHash: row.id_hash, csrfHash: row.csrf_hash,
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** preHandler: requires a valid staff session, a CSRF token on writes, and the given permission(s). */
export function requireStaff(db: Pool, ...perms: string[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const sid = req.cookies[STAFF_COOKIE];
    if (!sid) throw unauthorized();
    const staff = await loadStaffBySession(db, sid);
    if (!staff) throw unauthorized('Your session has ended. Please sign in again.');
    if (!SAFE.has(req.method)) {
      const t = String(req.headers[CSRF_HEADER] || '');
      if (!t || !safeEqual(sha256(t), staff.csrfHash)) throw new HttpError(403, 'csrf', 'Security check failed. Reload the page and try again.');
    }
    if (staff.mustChangePassword && !req.url.includes('/admin/auth/')) throw new HttpError(403, 'password_change_required', 'Please set a new password first.');
    for (const p of perms) if (!staff.permissions.has(p)) throw forbidden();
    req.staff = staff;
  };
}

export function hasShopAccess(staff: StaffPrincipal, shopId: string): boolean {
  return staff.shopIds === null || staff.shopIds.includes(shopId);
}
export function actorOf(req: FastifyRequest) {
  return { type: 'staff' as const, id: req.staff?.id ?? null, label: req.staff?.username ?? '', ip: req.ip, ua: String(req.headers['user-agent'] || ''), requestId: req.id };
}
