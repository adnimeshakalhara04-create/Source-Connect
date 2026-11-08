import type { FastifyInstance } from 'fastify';
import { releaseExpiredReservations } from '../orders/reservations.js';

/**
 * Background jobs run inside the API process. Each run takes a PostgreSQL advisory lock,
 * so when several API instances run only one does the work.
 */
export function startJobs(app: FastifyInstance) {
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, lockId: number, name: string, fn: () => Promise<unknown>) => {
    const run = async () => {
      const c = await app.db.connect();
      try {
        const got = (await c.query('SELECT pg_try_advisory_lock($1) AS ok', [lockId])).rows[0].ok;
        if (!got) return;
        try { const r = await fn(); if (r) app.log.info({ job: name, result: r }, 'job ran'); }
        finally { await c.query('SELECT pg_advisory_unlock($1)', [lockId]); }
      } catch (err) { app.log.error({ err, job: name }, 'job failed'); }
      finally { c.release(); }
    };
    timers.push(setInterval(run, ms));
    setTimeout(run, 2_000).unref();
  };
  every(60_000, 727101, 'release-expired-reservations', async () => {
    const n = await releaseExpiredReservations(app.db);
    return n ? { released: n } : null;
  });
  return { stop: () => timers.forEach(clearInterval) };
}
