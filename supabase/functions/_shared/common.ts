// Shared helpers for the Edge Functions. No third-party imports: only fetch + Web APIs.
import { md5Upper } from './md5.ts';

export const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('SUPABASE_ANON_KEY');

// Browser origins allowed to call these functions (the website and admin on Cloudflare Pages).
const ORIGINS = env('SITE_ORIGINS', 'http://127.0.0.1:8000,http://localhost:8000').split(',').map(s => s.trim()).filter(Boolean);
export function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return ORIGINS.includes(o)
    ? { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, apikey, content-type, idempotency-key, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '600', vary: 'origin' }
    : { vary: 'origin' };
}
export const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
export const preflight = (req: Request) => req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: cors(req) }) : null;

/** Client IP for rate limits. A caller can put anything at the START of X-Forwarded-For, so never trust the first
 *  entry: use X-Real-IP (set by the gateway) or the LAST entry, which the gateway appends itself.
 *  (Confirm on the hosted project which header carries the real client IP before launch.) */
export function clientIp(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

export interface RpcResult { ok: boolean; status: number; data: any; error?: { code?: string; message?: string; hint?: string; details?: string } }
/** Calls a database function through the REST API. Default: service role (server only); pass a user token to act as that user. */
export async function rpc(fn: string, args: unknown, userToken?: string): Promise<RpcResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: userToken ? ANON_KEY : SERVICE_KEY, authorization: `Bearer ${userToken ?? SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return res.ok ? { ok: true, status: res.status, data: body } : { ok: false, status: res.status, data: null, error: body ?? undefined };
}

/** The signed-in user behind a request (validated by Supabase Auth), or null for guests. */
export async function userFrom(req: Request): Promise<{ id: string; token: string } | null | 'invalid'> {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token || token === ANON_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } });
  if (!res.ok) return 'invalid';
  const u = await res.json();
  return u?.id ? { id: u.id, token } : 'invalid';
}

export async function rateLimited(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const r = await rpc('hit_rate_limit_public', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  return r.ok && r.data === false;
}

/** Maps a database error (HINT carries the code) to an HTTP answer. */
export function dbError(req: Request, r: RpcResult) {
  const code = r.error?.hint ?? '';
  const status = ({ bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, stock_changed: 409, price_changed: 409, duplicate_order: 409, mfa_required: 403 } as Record<string, number>)[code]
    ?? (r.error?.code === '42501' ? 403 : r.error?.code === '22023' ? 400 : 500);
  let details: unknown; try { details = r.error?.details ? JSON.parse(r.error.details) : undefined; } catch { details = undefined; }
  if (status === 500) console.error('database error', JSON.stringify(r.error));
  return json(req, status, { error: code || (status === 500 ? 'server_error' : 'error'), message: status === 500 ? 'Something went wrong on our side. Please try again.' : r.error?.message, details });
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// ---- PayHere (Sri Lanka) Checkout API ----
// hash   = UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(merchant_secret))))
// md5sig = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(merchant_secret))))
export const payhere = {
  mode: () => env('PAYHERE_MODE', 'sandbox') === 'live' ? 'live' : 'sandbox',
  ready: () => !!env('PAYHERE_MERCHANT_ID') && !!env('PAYHERE_MERCHANT_SECRET') && (env('PAYHERE_MODE', 'sandbox') !== 'live' || env('PAYHERE_LIVE_APPROVED') === 'true'),
  action: () => env('PAYHERE_MODE', 'sandbox') === 'live' ? 'https://www.payhere.lk/pay/checkout' : 'https://sandbox.payhere.lk/pay/checkout',
  hash: (orderId: string, amount: string, currency = 'LKR') => md5Upper(env('PAYHERE_MERCHANT_ID') + orderId + amount + currency + md5Upper(env('PAYHERE_MERCHANT_SECRET'))),
  verify(f: Record<string, string>): boolean {
    const secret = env('PAYHERE_MERCHANT_SECRET');
    if (!secret || !f.md5sig) return false;
    const expected = md5Upper((f.merchant_id ?? '') + (f.order_id ?? '') + (f.payhere_amount ?? '') + (f.payhere_currency ?? '') + (f.status_code ?? '') + md5Upper(secret));
    return safeEqual(expected, String(f.md5sig).toUpperCase());
  },
};

export async function readBody(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > max) return null;
  const t = await req.text();
  return t.length > max ? null : t;
}
