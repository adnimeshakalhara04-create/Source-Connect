import { md5Upper, safeEqual } from '../lib/crypto.js';
import { formatAmount } from '../lib/money.js';

/**
 * PayHere Checkout API (Sri Lanka) — https://support.payhere.lk/api-&-mobile-sdk/checkout-api
 *
 * Checkout form hash:
 *   hash = UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(merchant_secret))))
 * Payment notification (server → server, POST application/x-www-form-urlencoded to notify_url):
 *   md5sig = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(merchant_secret))))
 * status_code: 2 = success, 0 = pending, -1 = cancelled, -2 = failed, -3 = chargeback
 * The amount is formatted with exactly two decimals (e.g. 1000.00) and no thousands separators.
 */
export const PAYHERE_URLS = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
} as const;

export function checkoutHash(merchantId: string, orderId: string, amountCents: number, currency: string, secret: string): string {
  return md5Upper(merchantId + orderId + formatAmount(amountCents) + currency + md5Upper(secret));
}

export function notifySignature(f: { merchant_id: string; order_id: string; payhere_amount: string; payhere_currency: string; status_code: string }, secret: string): string {
  return md5Upper(f.merchant_id + f.order_id + f.payhere_amount + f.payhere_currency + f.status_code + md5Upper(secret));
}

export function verifyNotifySignature(f: Record<string, string>, secret: string): boolean {
  if (!secret || !f.md5sig) return false;
  const expected = notifySignature({ merchant_id: f.merchant_id ?? '', order_id: f.order_id ?? '', payhere_amount: f.payhere_amount ?? '', payhere_currency: f.payhere_currency ?? '', status_code: f.status_code ?? '' }, secret);
  return safeEqual(expected, String(f.md5sig).toUpperCase());
}

export const STATUS = { SUCCESS: 2, PENDING: 0, CANCELLED: -1, FAILED: -2, CHARGEBACK: -3 } as const;

/** Keeps only fields that are safe to store (no secrets; card number is already masked by PayHere). */
export function sanitizeNotify(f: Record<string, unknown>) {
  const keep = ['merchant_id', 'order_id', 'payment_id', 'payhere_amount', 'payhere_currency', 'status_code', 'status_message', 'method', 'card_holder_name', 'card_no', 'card_expiry', 'recurring', 'custom_1', 'custom_2'];
  const o: Record<string, string> = {};
  for (const k of keep) if (f[k] != null) o[k] = String(f[k]).slice(0, 200);
  if (o.card_no && !/^\*+\d{0,4}$/.test(o.card_no)) o.card_no = '****';     // never store anything that looks like a full number
  delete o.card_expiry;
  return o;
}
