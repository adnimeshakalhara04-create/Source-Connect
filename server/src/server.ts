import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs/index.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL, cfg.DATABASE_POOL_MAX);
const app = await buildApp(cfg, db);
const jobs = startJobs(app);

let closing = false;
async function shutdown(sig: string) {
  if (closing) return; closing = true;
  app.log.info({ sig }, 'shutting down');
  jobs.stop();
  const t = setTimeout(() => process.exit(1), 15_000); t.unref();
  await app.close();            // stop accepting, finish in-flight requests
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: cfg.HOST, port: cfg.PORT });
