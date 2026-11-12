import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { anon, staff, rpc, q1 } from './helpers.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Service renewal reminders (Supabase Pro, VPS, domain, trials). Dates are Sri Lanka calendar days.
const due = async (first: string, cycle: string, today: string) =>
  (await q1(`SELECT app.renewal_due($1::date, $2, $3::date)::text d`, [first, cycle, today])).d;
const today = async () => (await q1(`SELECT app.colombo_today()::text d`)).d as string;
const plus = (ymd: string, n: number) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let owner: SupabaseClient;

beforeAll(async () => { owner = await staff('owner1'); });
afterAll(async () => { await q1(`DELETE FROM app.service_renewals WHERE name LIKE 'T %'`); });   // leave no reminders for the browser test

describe('service renewal reminders', () => {
  it('next date: monthly and yearly move on from the first date without drifting; one-time stays', async () => {
    expect(await due('2026-01-31', 'monthly', '2026-02-15')).toBe('2026-02-28');
    expect(await due('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');   // back to the 31st, not stuck on the 28th
    expect(await due('2026-01-31', 'monthly', '2026-04-30')).toBe('2026-04-30');
    expect(await due('2026-01-31', 'monthly', '2026-05-01')).toBe('2026-05-31');
    expect(await due('2025-12-20', 'monthly', '2026-01-05')).toBe('2026-01-20');   // across a year end
    expect(await due('2024-02-29', 'yearly', '2025-03-01')).toBe('2026-02-28');
    expect(await due('2024-02-29', 'yearly', '2028-02-29')).toBe('2028-02-29');
    expect(await due('2026-10-12', 'monthly', '2026-11-12')).toBe('2026-11-12');   // the day itself counts
    expect(await due('2026-11-13', 'monthly', '2026-11-12')).toBe('2026-11-13');   // first date still ahead
    expect(await due('2026-11-01', 'once', '2026-11-12')).toBe('2026-11-01');      // a trial end does not move
  });

  it('warns from N days before until the day; monthly moves on after the day; one-time becomes overdue', async () => {
    const t = await today();
    const add = async (name: string, dueOn: string, cycle: string, remind = 1) => {
      const r = await rpc(owner, 'admin_save_renewal', { p_id: null, p_name: name, p_provider: 'Test', p_due: dueOn, p_cycle: cycle, p_remind_days: remind, p_note: '', p_active: true });
      expect(r.error).toBeNull(); return r.data;
    };
    expect(await add('T tomorrow', plus(t, 1), 'monthly')).toMatchObject({ status: 'due_soon', daysLeft: 1, dueOn: plus(t, 1) });
    expect(await add('T today', t, 'monthly')).toMatchObject({ status: 'due_soon', daysLeft: 0 });
    expect(await add('T in 2 days', plus(t, 2), 'monthly')).toMatchObject({ status: 'ok', daysLeft: 2 });
    expect(await add('T in 2 days, warn 3', plus(t, 2), 'yearly', 3)).toMatchObject({ status: 'due_soon' });
    const passed = await add('T monthly passed', plus(t, -1), 'monthly');
    expect(passed.status).toBe('ok'); expect(passed.daysLeft).toBeGreaterThan(25);   // moved on to next month
    expect(await add('T trial ended', plus(t, -1), 'once')).toMatchObject({ status: 'overdue', daysLeft: -1 });
    const off = await add('T off', t, 'monthly');
    const offr = await rpc(owner, 'admin_save_renewal', { p_id: off.id, p_name: 'T off', p_provider: '', p_due: t, p_cycle: 'monthly', p_remind_days: 1, p_note: '', p_active: false });
    expect(offr.data.status).toBe('off');

    const list = await rpc(owner, 'admin_renewals'); expect(list.error).toBeNull();
    expect(list.data.today).toBe(t);
    const mine = list.data.items.filter((r: any) => r.name.startsWith('T '));
    expect(mine).toHaveLength(7);
    expect(list.data.alerts).toBe(4);   // tomorrow, today, warn-3, trial ended
    expect(mine[mine.length - 1].name).toBe('T off');   // switched-off reminders last
  });

  it('checks what is typed', async () => {
    const t = await today();
    const bad = async (args: Record<string, unknown>) => (await rpc(owner, 'admin_save_renewal', { p_id: null, p_name: 'X', p_provider: '', p_due: t, p_cycle: 'monthly', p_remind_days: 1, p_note: '', p_active: true, ...args })).error;
    expect((await bad({ p_name: '  ' }))?.message).toMatch(/name/i);
    expect((await bad({ p_cycle: 'weekly' }))?.message).toMatch(/monthly/i);
    expect((await bad({ p_remind_days: 31 }))?.message).toMatch(/0 to 30/);
    expect((await bad({ p_due: null }))?.message).toMatch(/date/i);
    expect((await bad({ p_note: 'x'.repeat(201) }))?.message).toMatch(/too long/i);
    expect((await rpc(owner, 'admin_delete_renewal', { p_id: '00000000-0000-0000-0000-000000000000' })).error?.message).toMatch(/not found/i);
  });

  it('only the owner can see or change reminders; the website cannot; every change is in the audit log', async () => {
    const t = await today();
    for (const u of ['finance1', 'support1', 'editor1', 'fulfil1', 'shoesguy']) {
      const c = await staff(u);
      expect((await rpc(c, 'admin_renewals')).error?.code).toBe('42501');
      expect((await rpc(c, 'admin_save_renewal', { p_id: null, p_name: 'X', p_provider: '', p_due: t, p_cycle: 'once', p_remind_days: 1, p_note: '', p_active: true })).error?.code).toBe('42501');
    }
    expect((await rpc(anon(), 'admin_renewals')).error).not.toBeNull();
    expect((await anon().schema('app' as any).from('service_renewals').select('*')).data).toBeFalsy();

    const r = (await rpc(owner, 'admin_save_renewal', { p_id: null, p_name: 'T audit', p_provider: '', p_due: t, p_cycle: 'once', p_remind_days: 1, p_note: '', p_active: true })).data;
    expect((await rpc(owner, 'admin_delete_renewal', { p_id: r.id })).error).toBeNull();
    const a = await q1(`SELECT string_agg(action, ',' ORDER BY id) acts FROM app.audit_logs WHERE entity_type = 'renewal' AND entity_id = $1`, [r.id]);
    expect(a.acts).toBe('renewal.create,renewal.delete');
  });
});
