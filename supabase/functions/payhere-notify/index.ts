// POST /functions/v1/payhere-notify — PayHere server-to-server notification (notify_url).
// Deployed WITHOUT JWT verification (PayHere cannot send a Supabase token); the md5sig signature is the proof.
// 1) md5sig (constant time) and merchant_id are checked here with the server-held secret,
// 2) order, currency, exact amount, de-duplication and the state change happen in ONE database transaction.
import { env, payhere, readBody, rpc } from '../_shared/common.ts';

const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text(405, 'METHOD NOT ALLOWED');
  const raw = await readBody(req, 20_000);
  if (raw === null) return text(413, 'TOO LARGE');
  const f: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) f[k] = v;
  const sigOk = payhere.verify(f);
  const merchantOk = !!env('PAYHERE_MERCHANT_ID') && f.merchant_id === env('PAYHERE_MERCHANT_ID');
  const requestId = crypto.randomUUID();
  const r = await rpc('apply_payhere_notification', { p_fields: f, p_signature_valid: sigOk, p_merchant_ok: merchantOk, p_request_id: requestId });
  if (!r.ok) { console.error('payhere notify failed', requestId, JSON.stringify(r.error)); return text(500, 'ERROR'); }   // PayHere will retry
  console.log(JSON.stringify({ msg: 'payhere notify', order: String(f.order_id ?? '').slice(0, 40), status: f.status_code, result: r.data.result, requestId }));
  return r.data.http === 200 ? text(200, 'OK') : text(400, 'REJECTED');
});
