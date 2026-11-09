// Source Connect VPS worker.
// Takes jobs from the database queue (app.jobs) through the least-privilege `sc_worker` role and runs them.
// Nothing here is on the checkout path: if the VPS is down, customers can still browse and order; jobs simply wait.
//
// Job types:
//   image.process      check the real bytes of an uploaded product photo, remove camera/GPS data, limit size
//   catalog.snapshot   save a readable copy of the whole catalogue (JSON) on the VPS
//   email.*            order emails (only claimed when an email transport is configured)
//
// Settings come from the environment (systemd EnvironmentFile, root-only 0600). See vps/worker/worker.env.example.
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const env = (k, d = '') => process.env[k] ?? d;
const WORKER_ID = env('WORKER_ID', `${os.hostname()}-${process.pid}`);
const ONCE = process.argv.includes('--once');            // drain the queue once and exit (tests, manual runs)
const IDLE_MS = Number(env('WORKER_IDLE_MS', '3000'));
const LEASE_S = 300;

const log = (level, msg, extra = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, worker: WORKER_ID, ...extra }));

// ---------------------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------------------
const handlers = {};

// --- product photos -------------------------------------------------------------------------------------------
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const MAX_BYTES = 4 * 1024 * 1024, MAX_EDGE = 2000, MAX_PIXELS = 40_000_000;
const FORMATS = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXT = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };

if (SUPABASE_URL && SERVICE_KEY) {
  const { default: sharp } = await import('sharp');
  const storage = (method, bucket, name, init = {}) =>
    fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`,
      { method, ...init, headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, ...(init.headers || {}) } });

  handlers['image.process'] = async ({ bucket, name }) => {
    if (bucket !== 'product-images' || typeof name !== 'string' || !/^products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name))
      return { skipped: 'unexpected object name' };
    const res = await storage('GET', bucket, name);
    if (res.status === 404 || res.status === 400) return { skipped: 'object no longer exists' };
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());

    const remove = async (why) => {
      const d = await storage('DELETE', bucket, name);
      if (!d.ok && d.status !== 404) throw new Error(`could not remove rejected file: HTTP ${d.status}`);
      log('warn', 'photo rejected and removed', { name, why });
      return { removed: why };
    };
    if (input.length > MAX_BYTES) return remove('too_large');
    let meta;
    try { meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata(); } catch { return remove('not_an_image'); }
    const want = EXT[name.split('.').pop()];
    if (!FORMATS[meta.format] || meta.format !== want) return remove(`content_is_${meta.format || 'unknown'}_not_${want}`);

    // Re-encode: applies the camera rotation, drops EXIF/GPS and other metadata (sharp keeps none unless asked), caps the size.
    const out = await sharp(input, { limitInputPixels: MAX_PIXELS }).rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .toFormat(meta.format, meta.format === 'png' ? { compressionLevel: 9 } : { quality: 85 })
      .toBuffer({ resolveWithObject: true });
    const up = await storage('PUT', bucket, name, { body: out.data, headers: { 'content-type': FORMATS[meta.format], 'x-upsert': 'true', 'cache-control': 'max-age=31536000' } });
    if (!up.ok) throw new Error(`upload failed: HTTP ${up.status} ${await up.text()}`);
    return { format: meta.format, before: { bytes: input.length, width: meta.width, height: meta.height, exif: !!meta.exif },
             after: { bytes: out.data.length, width: out.info.width, height: out.info.height } };
  };
}

// --- catalogue snapshot ---------------------------------------------------------------------------------------
const SNAPSHOT_DIR = env('SNAPSHOT_DIR', '/var/lib/source-connect/catalog');
const SNAPSHOT_KEEP = Number(env('SNAPSHOT_KEEP', '200'));
handlers['catalog.snapshot'] = async (_payload, db) => {
  const { rows } = await db.query('SELECT public.storefront_snapshot() AS s');
  const json = JSON.stringify(rows[0].s, null, 1);
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true, mode: 0o750 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const file = path.join(SNAPSHOT_DIR, `catalog-${stamp}.json`);
  await fs.writeFile(file + '.tmp', json, { mode: 0o640 });
  await fs.rename(file + '.tmp', file);
  await fs.copyFile(file, path.join(SNAPSHOT_DIR, 'latest.json'));
  const old = (await fs.readdir(SNAPSHOT_DIR)).filter(f => /^catalog-\d{8}T\d{6}\.json$/.test(f)).sort().slice(0, -SNAPSHOT_KEEP);
  for (const f of old) await fs.unlink(path.join(SNAPSHOT_DIR, f));
  return { file: path.basename(file), products: (rows[0].s?.products || []).length, bytes: json.length };
};

// --- order emails ---------------------------------------------------------------------------------------------
const EMAIL_TRANSPORT = env('EMAIL_TRANSPORT', 'none');  // smtp | file | none
const SITE_URL = env('SITE_URL', 'https://sourceconnectglobal.lk').replace(/\/$/, '');
const FROM = env('EMAIL_FROM', 'Source Connect Global <orders@example.invalid>');
let sendMail = null;
if (EMAIL_TRANSPORT === 'smtp') {
  const { default: nodemailer } = await import('nodemailer');
  const t = nodemailer.createTransport(env('SMTP_URL'));   // e.g. smtps://user:pass@smtp.provider.com:465 (kept in the 0600 env file)
  sendMail = (m) => t.sendMail(m);
} else if (EMAIL_TRANSPORT === 'file') {                    // test/staging: write messages to a folder instead of sending
  const dir = env('OUTBOX_DIR', '/var/lib/source-connect/outbox');
  sendMail = async (m) => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${m.subject.replace(/[^\w-]+/g, '_').slice(0, 60)}.json`), JSON.stringify(m, null, 1)); };
}
const STATUS_TEXT = { confirmed: 'confirmed', processing: 'being prepared', shipped: 'on the way', delivered: 'delivered', cancelled: 'cancelled', refunded: 'refunded' };
function orderEmail(type, o, payload) {
  const lines = (o.items || []).map(i => `  ${i.qty} x ${i.name}${i.variant ? ' (' + i.variant + ')' : ''}  Rs. ${i.lineTotal ?? i.price ?? ''}`).join('\n');
  const head = {
    'email.order_placed': [`Order ${o.number} received`, `Thank you! We received your order ${o.number}.`],
    'email.payment_received': [`Payment received for ${o.number}`, `We received your payment for order ${o.number}.`],
    'email.order_status': [`Order ${o.number} is ${STATUS_TEXT[payload.status] || payload.status}`, `Your order ${o.number} is now ${STATUS_TEXT[payload.status] || payload.status}.`],
  }[type];
  return { subject: head[0], text: `${head[1]}\n\n${lines}\n\nTotal: Rs. ${o.total}\n\nTrack your order: ${SITE_URL}/#track\n\nSource Connect Global` };
}
if (sendMail) {
  for (const type of ['email.order_placed', 'email.payment_received', 'email.order_status']) {
    handlers[type] = async (payload, db) => {
      const { rows } = await db.query('SELECT app.worker_order_for_email($1) AS o', [String(payload.order || '')]);
      const o = rows[0]?.o;
      if (!o) return { skipped: 'order not found' };
      if (!o.email) return { skipped: 'no email address' };
      const m = orderEmail(type, o, payload);
      await sendMail({ from: FROM, to: o.email, ...m });
      return { sent: true, to: o.email.replace(/^(.).*(@.*)$/, '$1***$2') };   // masked: logs and job results never hold full addresses
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Queue loop
// ---------------------------------------------------------------------------------------------------------------
const TYPES = Object.keys(handlers);
const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 3, application_name: 'sc-worker',
  ssl: env('DATABASE_SSL', 'require') === 'disable' ? false : { rejectUnauthorized: env('DATABASE_SSL') === 'verify' } });
let stopping = false;
process.on('SIGTERM', () => { stopping = true; log('info', 'stopping after the current job'); });
process.on('SIGINT', () => { stopping = true; });

async function runOne(job) {
  const started = Date.now();
  try {
    const result = await handlers[job.type](job.payload || {}, pool);
    await pool.query('SELECT app.worker_complete_job($1, $2, $3)', [job.id, WORKER_ID, result ?? null]);
    log('info', 'job done', { id: job.id, type: job.type, ms: Date.now() - started, result });
  } catch (e) {
    const verdict = (await pool.query('SELECT app.worker_fail_job($1, $2, $3) AS v', [job.id, WORKER_ID, String(e?.message || e)])).rows[0].v;
    log(verdict === 'dead' ? 'error' : 'warn', 'job failed', { id: job.id, type: job.type, attempt: job.attempts, verdict, error: String(e?.message || e) });
  }
}

async function main() {
  log('info', 'worker started', { types: TYPES, email: EMAIL_TRANSPORT, once: ONCE });
  let lastStats = 0;
  while (!stopping) {
    let jobs = [];
    try {
      jobs = (await pool.query('SELECT * FROM app.worker_claim_jobs($1, $2, 5, $3)', [WORKER_ID, TYPES, LEASE_S])).rows;
      if (Date.now() - lastStats > 60_000) { lastStats = Date.now(); log('info', 'queue', (await pool.query('SELECT app.worker_queue_stats() AS s')).rows[0].s); }
    } catch (e) {
      log('error', 'database unreachable, retrying', { error: String(e?.message || e) });
      if (ONCE) process.exitCode = 1;
      if (ONCE) break;
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }
    for (const j of jobs) await runOne(j);         // one at a time: photos are CPU-heavy, the VPS stays responsive
    if (!jobs.length) { if (ONCE) break; await new Promise(r => setTimeout(r, IDLE_MS)); }
  }
  await pool.end();
  log('info', 'worker stopped');
}
main();
