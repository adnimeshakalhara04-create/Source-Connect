// POST /functions/v1/admin-staff — staff accounts (needs the caller's Supabase Auth token).
// The caller's permission (staff.manage) is checked by the DATABASE using the caller's own token;
// the service role is used only for the Supabase Auth admin calls that a browser can never make.
//   {action:"create", username, displayName, email, roles[], shops[], temporaryPassword}
//   {action:"update", id, displayName?, roles?, shops?, status?, resetPassword?}
//   {action:"change-own-password", currentPassword, newPassword}   (any staff member, clears the temporary-password flag)
import { clientIp, dbError, env, json, preflight, rateLimited, readBody, rpc, userFrom } from '../_shared/common.ts';

const AUTH = `${env('SUPABASE_URL')}/auth/v1`;
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = (path: string, method: string, body?: unknown) =>
  fetch(`${AUTH}/admin${path}`, { method, headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
function passwordProblem(pw: unknown, username = ''): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and numbers.';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return 'Do not include the username in the password.';
  if (new Set(pw).size < 6) return 'Use a mix of different characters.';
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
  if (await rateLimited('admin-staff:' + clientIp(req), 20, 60)) return json(req, 429, { error: 'rate_limited', message: 'Too many requests.' });
  const caller = await userFrom(req);
  if (!caller || caller === 'invalid') return json(req, 401, { error: 'unauthorized', message: 'Please sign in.' });
  let b: any; try { b = JSON.parse((await readBody(req, 10_000)) ?? ''); } catch { return json(req, 400, { error: 'bad_request', message: 'The request could not be read.' }); }

  if (b?.action === 'change-own-password') {
    const me = await (await fetch(`${AUTH}/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), authorization: `Bearer ${caller.token}` } })).json();
    if (me?.app_metadata?.kind !== 'staff') return json(req, 403, { error: 'forbidden', message: 'Not a staff account.' });
    const problem = passwordProblem(b.newPassword, String(me.email ?? '').split('@')[0]);
    if (problem) return json(req, 400, { error: 'bad_request', message: problem });
    if (b.newPassword === b.currentPassword) return json(req, 400, { error: 'bad_request', message: 'Choose a different password.' });
    const check = await fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: env('SUPABASE_ANON_KEY'), 'content-type': 'application/json' }, body: JSON.stringify({ email: me.email, password: String(b.currentPassword ?? '') }) });
    if (!check.ok) return json(req, 400, { error: 'bad_request', message: 'Your current password is not correct.' });
    const u = await admin(`/users/${me.id}`, 'PUT', { password: b.newPassword, app_metadata: { ...me.app_metadata, must_change_password: false } });
    if (!u.ok) return json(req, 400, { error: 'bad_request', message: (await u.json())?.msg ?? 'Password not accepted.' });
    return json(req, 200, { ok: true, message: 'Password changed. Sign in again.' });
  }

  if (b?.action === 'create') {
    // permission check first (database, caller's token), before anything is created
    const pre = await rpc('admin_staff_list', {}, caller.token);
    if (!pre.ok) return dbError(req, pre);
    const problem = passwordProblem(b.temporaryPassword, b.username);
    if (problem) return json(req, 400, { error: 'bad_request', message: problem });
    const email = String(b.email || `${b.username}@staff.invalid`).trim().toLowerCase();
    const cu = await admin('/users', 'POST', { email, password: b.temporaryPassword, email_confirm: true, app_metadata: { kind: 'staff', must_change_password: true } });
    const created = await cu.json();
    if (!cu.ok) return json(req, cu.status === 422 ? 409 : 400, { error: 'bad_request', message: created?.msg ?? 'Could not create the sign-in account.' });
    const s = await rpc('admin_staff_save', { p_staff_id: created.id, p_data: { username: b.username, displayName: b.displayName, email: b.email || '', roles: b.roles, shops: b.shops ?? [] } }, caller.token);
    if (!s.ok) { await admin(`/users/${created.id}`, 'DELETE'); return dbError(req, s); }   // undo: no half-created accounts
    return json(req, 200, { id: created.id });
  }

  if (b?.action === 'update' && typeof b.id === 'string') {
    const data: Record<string, unknown> = {};
    for (const k of ['displayName', 'roles', 'shops', 'status']) if (b[k] !== undefined) data[k] = b[k];
    const s = await rpc('admin_staff_save', { p_staff_id: b.id, p_data: data }, caller.token);   // permission + validation in the database
    if (!s.ok) return dbError(req, s);
    const cur = await (await admin(`/users/${b.id}`, 'GET')).json();
    if (b.resetPassword) {
      const problem = passwordProblem(b.resetPassword); if (problem) return json(req, 400, { error: 'bad_request', message: problem });
      await admin(`/users/${b.id}`, 'PUT', { password: b.resetPassword, app_metadata: { ...cur.app_metadata, must_change_password: true } });
    }
    // disabled staff: blocked in the database at once (status check) and cannot sign in or refresh any more
    if (b.status === 'disabled') await admin(`/users/${b.id}`, 'PUT', { ban_duration: '876000h' });
    if (b.status === 'active') await admin(`/users/${b.id}`, 'PUT', { ban_duration: 'none' });
    return json(req, 200, { ok: true });
  }
  return json(req, 400, { error: 'bad_request', message: 'Unknown action.' });
});
