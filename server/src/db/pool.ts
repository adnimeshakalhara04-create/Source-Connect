import pg from 'pg';

// bigint (int8) columns hold money in cents and counts; parse to JS numbers.
// Safe because every amount is far below Number.MAX_SAFE_INTEGER (9e15 cents).
pg.types.setTypeParser(20, v => Number(v));
// numeric (ratings) -> number
pg.types.setTypeParser(1700, v => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000, statement_timeout: 15_000, application_name: 'source-connect-api' });
  pool.on('error', () => { /* idle client errors are reported by the next query */ });
  return pool;
}

/** Run fn inside a transaction. Rolls back on any error. */
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>, isolation: 'READ COMMITTED' | 'SERIALIZABLE' = 'READ COMMITTED'): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL ' + isolation);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
