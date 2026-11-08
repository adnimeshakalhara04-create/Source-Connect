import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { hashPassword } from '../src/auth/passwords.js';

/**
 * Creates a brand-new database for this test run on the server in TEST_PG_ADMIN_URL
 * (default: the local dev cluster from scripts/dev-db.sh), migrates and seeds it,
 * and creates staff test accounts. Dropped again after the run.
 */
export default async function setup({ provide }: any) {
  const admin = process.env.TEST_PG_ADMIN_URL || 'postgres://postgres@127.0.0.1:5433/postgres';
  const name = 'sc_test_' + process.pid + '_' + Date.now().toString(36);
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`CREATE DATABASE ${name}`);
  const url = admin.replace(/\/[^/]*$/, '/' + name);
  await migrate(url);
  await seed(url);
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const pw = 'Test-Password-2026!';
  const users: [string, string[], string[]][] = [
    ['owner1', ['owner'], []], ['support1', ['support'], []], ['finance1', ['finance'], []], ['fulfil1', ['fulfillment'], []],
    ['editor1', ['catalog_editor'], []], ['shoesguy', ['shop_staff'], ['shoes']], ['victim1', ['catalog_editor'], []],
  ];
  const hash = await hashPassword(pw);
  for (const [u, roles, shops] of users) {
    const r = await db.query(`INSERT INTO staff_users (username, display_name, password_hash) VALUES ($1,$3,$2) RETURNING id`, [u, hash, u]);
    for (const role of roles) await db.query(`INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, [r.rows[0].id, role]);
    for (const s of shops) await db.query(`INSERT INTO staff_shop_access (staff_id, shop_id) SELECT $1, id FROM shops WHERE slug = $2`, [r.rows[0].id, s]);
  }
  // tests run with a fake sandbox merchant configured, so card payments are switched on
  await db.query(`UPDATE payment_settings SET enabled = true WHERE method = 'payhere'`);
  await db.end();
  process.env.TEST_DATABASE_URL = url;
  provide?.('databaseUrl', url);
  return async () => {
    await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
    if (!process.env.KEEP_TEST_DB) await c.query(`DROP DATABASE IF EXISTS ${name}`);
    await c.end();
  };
}
