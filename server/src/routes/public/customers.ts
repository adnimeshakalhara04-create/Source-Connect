import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { badRequest, unauthorized, HttpError } from '../../lib/errors.js';
import { hashPassword, verifyPassword, burnTime, passwordProblem } from '../../auth/passwords.js';
import { CUSTOMER_COOKIE, createCustomerSession, withCustomer } from '../../auth/customer.js';
import { cookieOpts } from '../../auth/staff.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { audit } from '../../lib/audit.js';
import { tx } from '../../db/pool.js';

const Email = z.string().trim().toLowerCase().pipe(z.string().email().max(200));

export default async function customers(app: FastifyInstance) {
  const db = app.db, cfg = app.config, mail = app.mailer;
  const setSession = async (reply: any, id: string) => {
    const { sid, csrf } = await createCustomerSession(db, cfg, id);
    reply.setCookie(CUSTOMER_COOKIE, sid, cookieOpts(cfg, '/api/v1', cfg.CUSTOMER_SESSION_DAYS * 86400));
    return csrf;
  };
  const sendVerify = async (id: string, email: string) => {
    const t = randomToken(24);
    await db.query(`INSERT INTO customer_tokens (token_hash, customer_id, purpose, expires_at) VALUES ($1,$2,'verify_email', now() + interval '2 days')`, [sha256(t), id]);
    await mail.send(email, 'Confirm your email — Source Connect Global', `Open this link to confirm your email: ${cfg.PUBLIC_SITE_URL}/#verify/${t}`);
  };
  const me = (c: any) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, verified: !!(c.verified ?? c.email_verified_at) });

  app.post('/customers/register', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }, schema: { tags: ['customers'] } }, async (req, reply) => {
    const b = parse(z.strictObject({ name: z.string().trim().min(2).max(80), email: Email, phone: z.string().trim().max(20).default(''), password: z.string().max(200) }), req.body);
    const p = passwordProblem(b.password); if (p) throw badRequest(p);
    const hash = await hashPassword(b.password);
    let id: string;
    try {
      id = await tx(db, async c => {
        const r = await c.query(`INSERT INTO customers (email, phone, name) VALUES ($1,$2,$3) RETURNING id`, [b.email, b.phone || null, b.name]);
        await c.query(`INSERT INTO customer_auth_identities (customer_id, provider, provider_subject, password_hash) VALUES ($1,'password',$2,$3)`, [r.rows[0].id, b.email, hash]);
        return r.rows[0].id;
      });
    } catch (e: any) {
      if (e.code === '23505') throw new HttpError(409, 'exists', 'An account with this email already exists. Please sign in.');
      throw e;
    }
    await sendVerify(id, b.email);
    await audit(db, { type: 'customer', id, ip: req.ip }, 'customer.register', 'customer', id);
    const csrfToken = await setSession(reply, id);
    return { csrfToken, customer: { id, name: b.name, email: b.email, phone: b.phone || null, verified: false } };
  });

  app.post('/customers/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }, schema: { tags: ['customers'] } }, async (req, reply) => {
    const b = parse(z.strictObject({ email: Email, password: z.string().max(200) }), req.body);
    const r = await db.query(`SELECT c.*, i.password_hash FROM customer_auth_identities i JOIN customers c ON c.id = i.customer_id WHERE i.provider = 'password' AND i.provider_subject = $1`, [b.email]);
    const c = r.rows[0];
    if (!c || c.status !== 'active') { await burnTime(b.password); throw unauthorized('Incorrect email or password.'); }
    if (!(await verifyPassword(c.password_hash, b.password))) { await audit(db, { type: 'customer', id: c.id, ip: req.ip }, 'customer.login_failed', 'customer', c.id); throw unauthorized('Incorrect email or password.'); }
    const csrfToken = await setSession(reply, c.id);
    return { csrfToken, customer: me(c) };
  });

  app.post('/customers/logout', { preHandler: withCustomer(db, true), schema: { tags: ['customers'] } }, async (req, reply) => {
    await db.query(`UPDATE customer_sessions SET revoked_at = now() WHERE id_hash = $1`, [req.customer!.sessionHash]);
    reply.clearCookie(CUSTOMER_COOKIE, cookieOpts(cfg, '/api/v1'));
    return { ok: true };
  });

  app.get('/customers/me', { preHandler: withCustomer(db, true), schema: { tags: ['customers'] } }, async (req) => {
    // new CSRF token for this browser tab
    const t = randomToken(24);
    await db.query(`UPDATE customer_sessions SET csrf_hash = $2 WHERE id_hash = $1`, [req.customer!.sessionHash, sha256(t)]);
    const addr = await db.query(`SELECT a.name, a.phone, a.line1, a.city, d.name AS district FROM customer_addresses a JOIN districts d ON d.code = a.district_code WHERE a.customer_id = $1 AND a.is_default`, [req.customer!.id]);
    return { csrfToken: t, customer: { ...me(req.customer), address: addr.rows[0] || null } };
  });

  app.put('/customers/me', { preHandler: withCustomer(db, true), schema: { tags: ['customers'] } }, async (req) => {
    const b = parse(z.strictObject({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).default(''),
      address: z.strictObject({ line1: z.string().trim().min(4).max(200), city: z.string().trim().min(2).max(60), district: z.string().max(40) }).optional() }), req.body);
    const id = req.customer!.id;
    await tx(db, async c => {
      await c.query(`UPDATE customers SET name = $2, phone = $3 WHERE id = $1`, [id, b.name, b.phone || null]);
      if (b.address) {
        const d = await c.query(`SELECT code FROM districts WHERE code = $1 OR lower(name) = lower($1)`, [b.address.district]);
        if (!d.rowCount) throw badRequest('Please choose your district.');
        await c.query(`DELETE FROM customer_addresses WHERE customer_id = $1 AND is_default`, [id]);
        await c.query(`INSERT INTO customer_addresses (customer_id, name, phone, line1, city, district_code, is_default) VALUES ($1,$2,$3,$4,$5,$6,true)`, [id, b.name, b.phone || '', b.address.line1, b.address.city, d.rows[0].code]);
      }
    });
    return { ok: true };
  });

  app.post('/customers/verify-email', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { tags: ['customers'] } }, async (req) => {
    const b = parse(z.strictObject({ token: z.string().min(10).max(100) }), req.body);
    const r = await db.query(`UPDATE customer_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now() RETURNING customer_id`, [sha256(b.token)]);
    if (!r.rowCount) throw badRequest('This link is invalid or has expired.');
    await db.query(`UPDATE customers SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1`, [r.rows[0].customer_id]);
    return { ok: true };
  });

  app.post('/customers/password-reset/request', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: { tags: ['customers'] } }, async (req) => {
    const b = parse(z.strictObject({ email: Email }), req.body);
    const r = await db.query(`SELECT customer_id FROM customer_auth_identities WHERE provider = 'password' AND provider_subject = $1`, [b.email]);
    if (r.rowCount) {
      const t = randomToken(24);
      await db.query(`INSERT INTO customer_tokens (token_hash, customer_id, purpose, expires_at) VALUES ($1,$2,'reset_password', now() + interval '1 hour')`, [sha256(t), r.rows[0].customer_id]);
      await mail.send(b.email, 'Reset your password — Source Connect Global', `Open this link within 1 hour to choose a new password: ${cfg.PUBLIC_SITE_URL}/#reset/${t}`);
    }
    return { ok: true };   // same answer whether or not the email exists
  });

  app.post('/customers/password-reset/confirm', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }, schema: { tags: ['customers'] } }, async (req) => {
    const b = parse(z.strictObject({ token: z.string().min(10).max(100), password: z.string().max(200) }), req.body);
    const p = passwordProblem(b.password); if (p) throw badRequest(p);
    const hash = await hashPassword(b.password);
    await tx(db, async c => {
      const r = await c.query(`UPDATE customer_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now() RETURNING customer_id`, [sha256(b.token)]);
      if (!r.rowCount) throw badRequest('This link is invalid or has expired.');
      const id = r.rows[0].customer_id;
      await c.query(`UPDATE customer_auth_identities SET password_hash = $2 WHERE customer_id = $1 AND provider = 'password'`, [id, hash]);
      await c.query(`UPDATE customer_sessions SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL`, [id]);
      // receiving the reset email proves the address
      await c.query(`UPDATE customers SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1`, [id]);
    });
    return { ok: true };
  });
}
