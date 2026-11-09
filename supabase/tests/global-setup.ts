import { execSync } from 'node:child_process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

export const PW = 'Test-Password-2026!';
export const STAFF: [string, string[], string[]][] = [
  ['owner1', ['owner'], []], ['support1', ['support'], []], ['finance1', ['finance'], []], ['fulfil1', ['fulfillment'], []],
  ['editor1', ['catalog_editor'], []], ['shoesguy', ['shop_staff'], ['shoes']],
];

/** Fresh local Supabase database (migrations + seed), then staff test accounts through real Supabase Auth. */
export default async function setup({ provide }: any) {
  const root = new URL('../..', import.meta.url).pathname;
  if (!process.env.SKIP_DB_RESET) execSync('npx -y supabase@2 db reset', { cwd: root, stdio: 'inherit' });
  const env = Object.fromEntries(execSync('npx -y supabase@2 status -o env', { cwd: root }).toString().split('\n')
    .map(l => /^([A-Z_]+)="(.*)"$/.exec(l)).filter(Boolean).map(m => [m![1], m![2]]));
  const cfg = { url: env.API_URL, anon: env.ANON_KEY, service: env.SERVICE_ROLE_KEY, db: env.DB_URL };
  const admin = createClient(cfg.url, cfg.service, { auth: { persistSession: false } });
  const db = new pg.Client({ connectionString: cfg.db }); await db.connect();
  for (const [u, roles, shops] of STAFF) {
    const { data, error } = await admin.auth.admin.createUser({ email: `${u}@staff.test`, password: PW, email_confirm: true, app_metadata: { kind: 'staff' } });
    if (error) throw error;
    const id = data.user!.id;
    await db.query(`INSERT INTO app.staff_users (id, username, email, display_name) VALUES ($1, $2, $3, $4)`, [id, u, `${u}@staff.test`, u]);
    for (const r of roles) await db.query(`INSERT INTO app.staff_roles (staff_id, role_id) SELECT $1, id FROM app.roles WHERE code = $2`, [id, r]);
    for (const s of shops) await db.query(`INSERT INTO app.staff_shop_access (staff_id, shop_id) SELECT $1, id FROM app.shops WHERE slug = $2`, [id, s]);
  }
  // most tests run without MFA; the MFA tests switch it on for themselves
  await db.query(`UPDATE app.security_settings SET require_staff_mfa = false`);
  // a sandbox merchant is "configured" for the tests, card payments switched on
  await db.query(`UPDATE app.ops_settings SET payhere_configured = true`);
  await db.query(`ALTER ROLE sc_worker WITH LOGIN PASSWORD 'local-worker-test-only'`);   // local stack only: lets the VPS worker test log in as sc_worker
  await db.query(`UPDATE app.payment_settings SET enabled = true WHERE method = 'payhere'`);
  await db.end();
  provide('cfg', cfg);
}
