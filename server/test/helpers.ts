import { inject } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig, type Config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { buildApp } from '../src/app.js';
import { createHash } from 'node:crypto';

export const PW = 'Test-Password-2026!';
export const MERCHANT_ID = '1211149';                  // PayHere's public sandbox demo merchant id format; secret below is a test value only
export const MERCHANT_SECRET = 'test-secret-not-real-0123456789';

export async function makeApp(over: Record<string, string> = {}): Promise<{ app: FastifyInstance; cfg: Config }> {
  const url = (inject as any)('databaseUrl') as string;
  const cfg = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: url, LOG_LEVEL: 'silent', PAYHERE_MERCHANT_ID: MERCHANT_ID, PAYHERE_MERCHANT_SECRET: MERCHANT_SECRET,
    CORS_ORIGINS: 'http://shop.test', ...over,
  } as any);
  const db = createPool(url, 20);
  const app = await buildApp(cfg, db);
  app.addHook('onClose', async () => { await db.end(); });
  await app.ready();
  return { app, cfg };
}

export class Agent {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(public app: FastifyInstance, public ip = '10.0.0.' + Math.floor(Math.random() * 200 + 1)) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf && !h['x-csrf-token'] && method !== 'GET') h['x-csrf-token'] = this.csrf;
    const res = await this.app.inject({ method: method as any, url, payload: body as any, headers: h, remoteAddress: this.ip });
    const set = res.headers['set-cookie'];
    for (const c of ([] as string[]).concat(set || [])) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!v || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const j = safeJson(res.body);
    if (j && typeof j.csrfToken === 'string') this.csrf = j.csrfToken;
    return res;
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b?: unknown, h?: Record<string, string>) => this.req('POST', u, b ?? {}, h);
  put = (u: string, b?: unknown) => this.req('PUT', u, b ?? {});
  async staffLogin(username: string, password = PW) {
    const r = await this.post('/api/v1/admin/auth/login', { username, password });
    if (r.statusCode !== 200) throw new Error('login failed for ' + username + ': ' + r.body);
    return this;
  }
}
export const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
export const json = (r: LightMyRequestResponse) => safeJson(r.body);

export const md5U = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();
/** Builds a PayHere notification exactly as PayHere would sign it. */
export function payhereNotify(orderId: string, amount: string, status: number, opts: { paymentId?: string; currency?: string; merchantId?: string; secret?: string } = {}) {
  const merchant_id = opts.merchantId ?? MERCHANT_ID, currency = opts.currency ?? 'LKR';
  const md5sig = md5U(merchant_id + orderId + amount + currency + String(status) + md5U(opts.secret ?? MERCHANT_SECRET));
  return new URLSearchParams({ merchant_id, order_id: orderId, payment_id: opts.paymentId ?? '320027' + Math.floor(Math.random() * 1e6), payhere_amount: amount,
    payhere_currency: currency, status_code: String(status), md5sig, method: 'VISA', status_message: 'Successfully completed', card_holder_name: 'Test', card_no: '************1292' }).toString();
}
export const guest = { name: 'Nimal Perera', phone: '0771234567', email: 'nimal@example.com', address: '12 Temple Road', city: 'Kandy', district: 'Kandy', note: '' };
