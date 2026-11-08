import crypto from 'node:crypto';
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
export const md5Upper = (s: string): string => crypto.createHash('md5').update(s).digest('hex').toUpperCase();
/** Constant-time comparison of two strings (false when lengths differ). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function orderNumber(d = new Date()): string {
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = crypto.randomBytes(6);
  let s = ''; for (const b of bytes) s += ALPH[b % ALPH.length];
  return `SC-${ymd}-${s}`;
}
