// POST /functions/v1/checkout — places an order. Guests and signed-in customers.
// Prices, stock and totals are decided by the database (place_order); the PayHere hash is made here
// because the merchant secret must never reach the browser.
import { clientIp, dbError, env, json, payhere, preflight, rateLimited, readBody, rpc, userFrom } from '../_shared/common.ts';

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
  if (await rateLimited('checkout:' + clientIp(req), Number(env('ORDER_RATE_LIMIT_PER_MIN', '10')), 60))
    return json(req, 429, { error: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' });
  const raw = await readBody(req, 50_000);
  if (raw === null) return json(req, 413, { error: 'too_large', message: 'The request is too large.' });
  let input: any; try { input = JSON.parse(raw); } catch { return json(req, 400, { error: 'bad_request', message: 'The request could not be read.' }); }
  if (!input || typeof input !== 'object') return json(req, 400, { error: 'bad_request', message: 'Some details are missing.' });

  const user = await userFrom(req);
  if (user === 'invalid') return json(req, 401, { error: 'unauthorized', message: 'Your session has ended. Please sign in again.' });
  if (input.payment === 'payhere' && !payhere.ready()) return json(req, 400, { error: 'bad_request', message: 'Card payment is not set up yet. Please choose another payment method.' });

  const key = req.headers.get('idempotency-key');
  const r = await rpc('place_order', { p_input: input, p_customer_id: user?.id ?? null, p_idempotency_key: key && /^[A-Za-z0-9_-]{16,80}$/.test(key) ? key : null, p_request_id: crypto.randomUUID() });
  if (!r.ok) return dbError(req, r);
  const o = r.data;
  const out: Record<string, unknown> = { orderNumber: o.orderNumber, trackingToken: o.trackingToken, status: o.status, paymentStatus: o.paymentStatus, total: o.total };
  if (o.bankInstructions) out.bankInstructions = o.bankInstructions;
  if (input.payment === 'payhere') {
    const site = env('PUBLIC_SITE_URL', 'http://127.0.0.1:8000').replace(/\/$/, '');
    const name = String(o.customer.name).split(/\s+/);
    const fields: Record<string, string> = {
      merchant_id: env('PAYHERE_MERCHANT_ID'), return_url: `${site}/#order/${o.orderNumber}`, cancel_url: `${site}/#order/${o.orderNumber}`,
      notify_url: env('PAYHERE_NOTIFY_URL', `${env('SUPABASE_URL')}/functions/v1/payhere-notify`),
      order_id: o.orderNumber, items: `Source Connect order ${o.orderNumber}`, currency: 'LKR', amount: o.amount,
      first_name: name[0] || 'Customer', last_name: name.slice(1).join(' ') || '-', email: o.customer.email, phone: o.customer.phone,
      address: o.customer.address, city: o.customer.city, country: 'Sri Lanka',
    };
    fields.hash = payhere.hash(o.orderNumber, o.amount);
    out.payhere = { action: payhere.action(), fields };
  }
  return json(req, 201, out);
});
