import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staff, customer, rpc, q1, db } from './helpers.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Admin PIN as the second sign-in step (instead of the authenticator app), checked in the database.
const id = async (u: string) => (await q1(`SELECT id FROM app.staff_users WHERE username = $1`, [u])).id as string;
let owner: SupabaseClient, editorId: string, ownerId: string;

beforeAll(async () => {
  await db().query(`UPDATE app.security_settings SET require_staff_mfa = false, staff_second_step = 'totp'`);
  owner = await staff('owner1'); editorId = await id('editor1'); ownerId = await id('owner1');
});
afterAll(async () => {
  await db().query(`UPDATE app.security_settings SET require_staff_mfa = false, staff_second_step = 'totp'`);
  await db().query(`DELETE FROM app.staff_pins; DELETE FROM app.staff_pin_sessions`);
});

describe('admin PIN (second sign-in step)', () => {
  it('owner sets PINs; weak or malformed PINs are refused; the PIN is stored only as a hash and never logged', async () => {
    for (const bad of ['1234', '0000', '98765', '12a4', '123', '123456789']) {
      expect((await rpc(owner, 'admin_set_staff_pin', { p_staff_id: editorId, p_pin: bad })).error, bad).not.toBeNull();
    }
    expect((await rpc(owner, 'admin_set_staff_pin', { p_staff_id: editorId, p_pin: '0722' })).data).toEqual({ ok: true, hasPin: true });
    expect((await rpc(owner, 'admin_set_staff_pin', { p_staff_id: ownerId, p_pin: '5081' })).error).toBeNull();
    const h = (await q1(`SELECT pin_hash FROM app.staff_pins WHERE staff_id = $1`, [editorId])).pin_hash as string;
    expect(h.startsWith('$2')).toBe(true); expect(h).not.toContain('0722');
    const logged = await q1(`SELECT count(*)::int n FROM app.audit_logs WHERE action LIKE 'staff.pin%' AND (coalesce(before::text, '') || coalesce(after::text, '')) LIKE '%0722%'`);
    expect(logged.n).toBe(0);
    expect((await q1(`SELECT count(*)::int n FROM app.audit_logs WHERE action = 'staff.pin_set' AND entity_id = 'editor1'`)).n).toBeGreaterThan(0);
  });

  it('only the owner (staff.manage) sets PINs or switches the mode; customers cannot check PINs', async () => {
    const ed = await staff('editor1');
    expect((await rpc(ed, 'admin_set_staff_pin', { p_staff_id: editorId, p_pin: '4071' })).error?.code).toBe('42501');
    expect((await rpc(ed, 'admin_set_second_step', { p_mode: 'pin' })).error?.code).toBe('42501');
    expect((await rpc(ed, 'admin_sign_in_settings')).error?.code).toBe('42501');
    const c = await customer();
    expect((await rpc(c.c, 'staff_verify_pin', { p_pin: '0722' })).error?.code).toBe('42501');
  });

  it('in PIN mode a password-only session can do nothing until the right PIN; each new sign-in needs it again', async () => {
    expect((await rpc(owner, 'admin_set_second_step', { p_mode: 'pin' })).data).toEqual({ ok: true, secondStep: 'pin' });
    await db().query(`UPDATE app.security_settings SET require_staff_mfa = true`);

    const s1 = await staff('editor1');
    const r0 = await rpc(s1, 'admin_state');
    expect(r0.error?.code).toBe('42501'); expect(r0.error?.hint).toBe('pin_required');
    expect((await rpc(s1, 'admin_me')).data).toMatchObject({ secondStep: 'pin', secondStepOk: false, hasPin: true, permissions: [] });
    expect((await rpc(s1, 'staff_verify_pin', { p_pin: '1111' })).data).toMatchObject({ ok: false, error: 'wrong_pin', attemptsLeft: 4 });
    expect((await rpc(s1, 'admin_state')).error?.hint).toBe('pin_required');
    expect((await rpc(s1, 'staff_verify_pin', { p_pin: '0722' })).data).toEqual({ ok: true });
    expect((await rpc(s1, 'admin_state')).error).toBeNull();
    expect((await rpc(s1, 'admin_me')).data.secondStepOk).toBe(true);

    const s2 = await staff('editor1');   // another browser / a new sign-in
    expect((await rpc(s2, 'admin_state')).error?.hint).toBe('pin_required');
    // another staff member's correct PIN does not open this account
    expect((await rpc(s2, 'staff_verify_pin', { p_pin: '5081' })).data.ok).toBe(false);
  });

  it('5 wrong PINs lock it for 15 minutes, even for the right PIN', async () => {
    await db().query(`UPDATE app.staff_pins SET failed = 0, locked_until = NULL WHERE staff_id = $1`, [editorId]);
    const s = await staff('editor1');
    for (let i = 1; i <= 4; i++) expect((await rpc(s, 'staff_verify_pin', { p_pin: '9090' })).data.attemptsLeft).toBe(5 - i);
    expect((await rpc(s, 'staff_verify_pin', { p_pin: '9090' })).data).toMatchObject({ ok: false, error: 'locked' });
    expect((await rpc(s, 'staff_verify_pin', { p_pin: '0722' })).data).toMatchObject({ ok: false, error: 'locked' });
    expect((await rpc(s, 'admin_state')).error?.hint).toBe('pin_required');
    const lock = await q1(`SELECT extract(epoch FROM locked_until - now())::int s FROM app.staff_pins WHERE staff_id = $1`, [editorId]);
    expect(lock.s).toBeGreaterThan(14 * 60); expect(lock.s).toBeLessThanOrEqual(15 * 60);
    await db().query(`UPDATE app.staff_pins SET locked_until = now() - interval '1 second' WHERE staff_id = $1`, [editorId]);
    expect((await rpc(s, 'staff_verify_pin', { p_pin: '0722' })).data).toEqual({ ok: true });
  });

  it('owner cannot switch to PIN without an own PIN; changing a PIN signs that person out of PIN sessions; back to the app', async () => {
    await db().query(`UPDATE app.security_settings SET require_staff_mfa = false, staff_second_step = 'totp'`);
    await db().query(`DELETE FROM app.staff_pins WHERE staff_id = $1`, [ownerId]);
    expect((await rpc(owner, 'admin_set_second_step', { p_mode: 'pin' })).error?.message).toMatch(/own PIN/);
    expect((await rpc(owner, 'admin_set_second_step', { p_mode: 'sms' })).error).not.toBeNull();
    const before = (await q1(`SELECT count(*)::int n FROM app.staff_pin_sessions WHERE staff_id = $1`, [editorId])).n;
    expect(before).toBeGreaterThan(0);
    expect((await rpc(owner, 'admin_set_staff_pin', { p_staff_id: editorId, p_pin: '3170' })).error).toBeNull();
    expect((await q1(`SELECT count(*)::int n FROM app.staff_pin_sessions WHERE staff_id = $1`, [editorId])).n).toBe(0);
    // with the authenticator app chosen, the PIN does not work as a second step
    const s = await staff('editor1');
    expect((await rpc(s, 'staff_verify_pin', { p_pin: '3170' })).error?.message).toMatch(/not switched on/);
  });
});
