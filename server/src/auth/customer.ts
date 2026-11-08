import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { HttpError, unauthorized } from '../lib/errors.js';
import type { Config } from '../config.js';

export const CUSTOMER_COOKIE = 'sc_cust';
export interface CustomerPrincipal { id: string; email: string | null; name: string; phone: string | null; verified: boolean; sessionHash: string; csrfHash: string }
declare module 'fastify' { interface FastifyRequest { customer?: CustomerPrincipal | null } }

export async function createCustomerSession(db: Pool, cfg: Config, customerId: string) {
  const sid = randomToken(32), csrf = randomToken(24);
  await db.query(`INSERT INTO customer_sessions (id_hash, customer_id, csrf_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(days => $4))`, [sha256(sid), customerId, sha256(csrf), cfg.CUSTOMER_SESSION_DAYS]);
  return { sid, csrf };
}

export async function loadCustomer(db: Pool, sid: string | undefined): Promise<CustomerPrincipal | null> {
  if (!sid) return null;
  const r = await db.query(`SELECT s.id_hash, s.csrf_hash, c.id, c.email, c.name, c.phone, c.email_verified_at FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id AND c.status = 'active' WHERE s.id_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [sha256(sid)]);
  const x = r.rows[0];
  return x ? { id: x.id, email: x.email, name: x.name, phone: x.phone, verified: !!x.email_verified_at, sessionHash: x.id_hash, csrfHash: x.csrf_hash } : null;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Optional customer: sets req.customer when signed in. Writes with a session cookie must carry the CSRF token. */
export function withCustomer(db: Pool, required = false) {
  return async (req: FastifyRequest) => {
    const c = await loadCustomer(db, req.cookies[CUSTOMER_COOKIE]);
    if (c && !SAFE.has(req.method)) {
      const t = String(req.headers['x-csrf-token'] || '');
      if (!t || !safeEqual(sha256(t), c.csrfHash)) throw new HttpError(403, 'csrf', 'Security check failed. Reload the page and try again.');
    }
    if (required && !c) throw unauthorized('Please sign in to your account.');
    req.customer = c;
  };
}
