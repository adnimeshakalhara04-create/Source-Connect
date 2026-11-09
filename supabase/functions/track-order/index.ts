// POST /functions/v1/track-order — {number, token} (full details) or {number, phone} (status only). Rate limited per IP.
import { clientIp, dbError, json, preflight, rateLimited, readBody, rpc } from '../_shared/common.ts';

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
  if (await rateLimited('track:' + clientIp(req), 10, 300)) return json(req, 429, { error: 'rate_limited', message: 'Too many tries. Please wait a few minutes.' });
  const raw = await readBody(req, 2_000);
  let b: any; try { b = JSON.parse(raw ?? ''); } catch { return json(req, 400, { error: 'bad_request', message: 'The request could not be read.' }); }
  const r = await rpc('track_order', { p_number: String(b?.number ?? '').slice(0, 30), p_token: b?.token ? String(b.token).slice(0, 100) : null, p_phone: b?.phone ? String(b.phone).slice(0, 20) : null });
  if (!r.ok) return dbError(req, r);
  if (!r.data) return json(req, 404, { error: 'not_found', message: 'We could not find an order with those details.' });
  return json(req, 200, r.data);
});
