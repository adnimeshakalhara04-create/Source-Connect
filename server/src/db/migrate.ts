import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../migrations');

export interface MigrationResult { applied: string[]; skipped: string[] }

/**
 * Applies every migrations/NNNN_name.sql that has not run yet, in order, each in its own transaction.
 * A checksum guards against editing a migration after it ran (forward-only policy).
 * An advisory lock stops two deploys from migrating at the same time.
 */
export async function migrate(url: string, dir = MIGRATIONS_DIR, log: (m: string) => void = () => {}): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString: url, application_name: 'source-connect-migrate' });
  await client.connect();
  const out: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map<string, string>((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map(r => [r.version, r.checksum]));
    const files = fs.readdirSync(dir).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      const version = f.replace(/\.sql$/, '');
      if (done.has(version)) {
        if (done.get(version) !== sum) throw new Error(`Migration ${f} was changed after it was applied. Create a new migration instead.`);
        out.skipped.push(version); continue;
      }
      log('applying ' + f);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, sum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
      out.applied.push(version);
    }
    return out;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    await client.end();
  }
}

export async function pendingMigrations(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = fs.readdirSync(dir).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).map(f => f.replace(/\.sql$/, ''));
  const r = await pool.query(`SELECT version FROM schema_migrations`).catch(() => ({ rows: [] as { version: string }[] }));
  const done = new Set(r.rows.map(x => x.version));
  return files.filter(f => !done.has(f));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  migrate(url, MIGRATIONS_DIR, m => console.log(m))
    .then(r => { console.log(`migrations: ${r.applied.length} applied, ${r.skipped.length} already done`); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
