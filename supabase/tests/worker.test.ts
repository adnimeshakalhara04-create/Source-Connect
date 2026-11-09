import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { cfg, q1, db, service, placeOrder, setStock } from './helpers.js';

// Runs the REAL VPS worker process (vps/worker/worker.mjs --once) against the local Supabase stack.
const ROOT = path.resolve(__dirname, '../..');
const WORKER = path.join(ROOT, 'vps/worker/worker.mjs');
const sharp = createRequire(path.join(ROOT, 'vps/worker/package.json'))('sharp');
const run = promisify(execFile);
const workerDb = () => cfg().db.replace('postgres:postgres@', 'sc_worker:local-worker-test-only@');
let tmp = '';
const runWorker = async (extra: Record<string, string> = {}) => {
  const { stdout } = await run('node', [WORKER, '--once'], { env: { ...process.env, DATABASE_URL: workerDb(), DATABASE_SSL: 'disable',
    SUPABASE_URL: cfg().url, SUPABASE_SERVICE_ROLE_KEY: cfg().service, SNAPSHOT_DIR: path.join(tmp, 'catalog'), OUTBOX_DIR: path.join(tmp, 'outbox'),
    EMAIL_TRANSPORT: 'file', WORKER_ID: 'test-worker', ...extra }, timeout: 60_000 });
  return stdout.trim().split('\n').map(l => JSON.parse(l));
};
const objName = (ext: string) => `products/2026/11/${crypto.randomUUID()}.${ext}`;
const upload = async (name: string, body: Buffer, type: string) => {
  const { error } = await service().storage.from('product-images').upload(name, body, { contentType: type });
  if (error) throw error;
};
const job = (name: string) => q1(`SELECT status, result, attempts FROM app.jobs WHERE dedupe_key = $1`, ['image.process:' + name]);

beforeAll(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sc-worker-')); });

describe('VPS worker (least-privilege sc_worker role)', () => {
  it('the worker role can only use the worker functions: no table access, no admin functions', async () => {
    const c = new pg.Client({ connectionString: workerDb() }); await c.connect();
    try {
      await expect(c.query('SELECT * FROM app.orders LIMIT 1')).rejects.toThrow(/permission denied/);
      await expect(c.query('SELECT * FROM auth.users LIMIT 1')).rejects.toThrow(/permission denied/);
      await expect(c.query(`SELECT public.place_order('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
      await expect(c.query('SELECT public.admin_orders()')).rejects.toThrow(/permission denied/);
      expect((await c.query('SELECT app.worker_queue_stats() s')).rows[0].s).toHaveProperty('queued');
    } finally { await c.end(); }
  });

  it('photos: camera/GPS data removed and huge photos shrunk; a fake photo is deleted', async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c33' } }).jpeg()
      .withExif({ IFD0: { Make: 'TestCam', Artist: 'Home Address 12' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 55/1 0/1' } }).toBuffer();
    expect((await sharp(big).metadata()).exif).toBeTruthy();
    const good = objName('jpg'), fake = objName('png');
    await upload(good, big, 'image/jpeg');
    await upload(fake, Buffer.from('<?php echo "not a picture"; ?>'), 'image/png');   // Storage trusts the declared type
    await runWorker();

    expect(await job(good)).toMatchObject({ status: 'done' });
    const after = Buffer.from(await (await fetch(`${cfg().url}/storage/v1/object/public/product-images/${good}`)).arrayBuffer());
    const m = await sharp(after).metadata();
    expect(m.exif).toBeUndefined();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 2000, 1333]);

    expect(await job(fake)).toMatchObject({ status: 'done', result: { removed: 'not_an_image' } });
    expect((await fetch(`${cfg().url}/storage/v1/object/public/product-images/${fake}`)).status).toBeGreaterThanOrEqual(400);
  });

  it('catalogue snapshot is written as readable JSON', async () => {
    await db().query(`SELECT app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:test-' || clock_timestamp())`);
    await runWorker();
    const latest = JSON.parse(await fs.readFile(path.join(tmp, 'catalog', 'latest.json'), 'utf8'));
    expect(latest.products.length).toBeGreaterThan(100);
  });

  it('order email: sent once with order details; address masked in the job result', async () => {
    await setStock('WOMENS-3-M', 5);
    const r = await placeOrder([{ id: 'womens-3', size: 'M', qty: 1 }], 'cod');
    expect(r.error).toBeNull();
    const num = r.data.orderNumber;
    await runWorker();
    const files = (await fs.readdir(path.join(tmp, 'outbox'))).filter(f => f.includes(num));
    expect(files).toHaveLength(1);
    const mail = JSON.parse(await fs.readFile(path.join(tmp, 'outbox', files[0]), 'utf8'));
    expect(mail.to).toBe('nimal@example.com'); expect(mail.text).toContain(num); expect(mail.text).toContain('Total: Rs.');
    const j = await q1(`SELECT status, result FROM app.jobs WHERE dedupe_key = $1`, ['email.order_placed:' + num]);
    expect(j).toMatchObject({ status: 'done', result: { sent: true, to: 'n***@example.com' } });
    await runWorker();   // running again does not send it twice
    expect((await fs.readdir(path.join(tmp, 'outbox'))).filter(f => f.includes(num))).toHaveLength(1);
  });

  it('without an email provider, email jobs are left waiting (not lost, not marked sent)', async () => {
    await setStock('WOMENS-3-L', 5);
    const r = await placeOrder([{ id: 'womens-3', size: 'L', qty: 1 }], 'cod');
    await runWorker({ EMAIL_TRANSPORT: 'none' });
    expect(await q1(`SELECT status FROM app.jobs WHERE dedupe_key = $1`, ['email.order_placed:' + r.data.orderNumber])).toEqual({ status: 'queued' });
    await runWorker();   // provider configured later: the waiting email goes out
    expect(await q1(`SELECT status FROM app.jobs WHERE dedupe_key = $1`, ['email.order_placed:' + r.data.orderNumber])).toEqual({ status: 'done' });
  });

  it('a failing job is retried with back-off, then marked dead (visible to the owner)', async () => {
    const name = objName('webp');
    await db().query(`SELECT app.enqueue_job('image.process', jsonb_build_object('bucket','product-images','name',$1::text), 'image.process:' || $1)`, [name]);
    await db().query(`UPDATE app.jobs SET max_attempts = 2 WHERE dedupe_key = $1`, ['image.process:' + name]);
    // Storage unreachable -> download throws
    await runWorker({ SUPABASE_URL: 'http://127.0.0.1:9' });
    expect(await job(name)).toMatchObject({ status: 'queued', attempts: 1 });
    await db().query(`UPDATE app.jobs SET run_after = now() WHERE dedupe_key = $1`, ['image.process:' + name]);
    await runWorker({ SUPABASE_URL: 'http://127.0.0.1:9' });
    expect(await job(name)).toMatchObject({ status: 'dead', attempts: 2 });
  });
});
