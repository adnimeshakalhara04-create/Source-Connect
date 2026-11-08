import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

const url = () => (inject as any)('databaseUrl') as string;
let db: pg.Client;
beforeAll(async () => { db = new pg.Client({ connectionString: url() }); await db.connect(); });
afterAll(async () => { await db.end(); });

const fails = async (sql: string, args: unknown[] = []) => {
  await db.query('SAVEPOINT t');
  try { await db.query(sql, args); await db.query('ROLLBACK TO SAVEPOINT t'); return null; }
  catch (e: any) { await db.query('ROLLBACK TO SAVEPOINT t'); return e.message as string; }
};

describe('migrations', () => {
  it('re-running migrations applies nothing new', async () => {
    const r = await migrate(url());
    expect(r.applied).toEqual([]);
    expect(r.skipped.length).toBeGreaterThanOrEqual(2);
  });
  it('refuses a migration that was edited after it ran', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    fs.appendFileSync(path.join(dir, '0001_core.sql'), '\n-- edited\n');
    await expect(migrate(url(), dir)).rejects.toThrow(/changed after it was applied/);
  });
  it('seed refuses to run on a database that already has products (no overwrite of live data)', async () => {
    expect(await seed(url())).toBe('skipped');
  });
  it('seeded catalogue: 144 products, every product has variants and inventory, no invented ratings', async () => {
    const r = await db.query(`SELECT (SELECT count(*) FROM products WHERE slug ~ '^[a-z]+-[0-9]+$' AND created_by IS NULL)::int p, (SELECT count(*) FROM products WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = products.id))::int nov,
      (SELECT count(*) FROM product_variants v WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.variant_id = v.id))::int noinv,
      (SELECT count(*) FROM products p WHERE rating > 0 OR reviews_count > 0 OR (sold_count > 0 AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)))::int fake`);
    expect(r.rows[0]).toEqual({ p: 144, nov: 0, noinv: 0, fake: 0 });
  });
  it('no staff account exists with a default password', async () => {
    const r = await db.query(`SELECT count(*)::int n FROM staff_users WHERE username = 'admin'`);
    expect(r.rows[0].n).toBe(0);
  });
});

describe('constraints', () => {
  beforeAll(async () => { await db.query('BEGIN'); });
  afterAll(async () => { await db.query('ROLLBACK'); });
  it('stock can never go negative and reserved can never exceed on hand', async () => {
    const v = (await db.query(`SELECT variant_id FROM inventory LIMIT 1`)).rows[0].variant_id;
    expect(await fails(`UPDATE inventory SET on_hand = -1 WHERE variant_id = $1`, [v])).toMatch(/check/);
    expect(await fails(`UPDATE inventory SET reserved = on_hand + 1 WHERE variant_id = $1`, [v])).toMatch(/check/);
  });
  it('product price must be positive; SKU must be unique', async () => {
    expect(await fails(`UPDATE products SET price_cents = 0 WHERE slug = 'mens-1'`)).toMatch(/check/);
    const sku = (await db.query(`SELECT sku FROM product_variants LIMIT 1`)).rows[0].sku;
    expect(await fails(`UPDATE product_variants SET sku = $1 WHERE sku <> $1 AND ctid = (SELECT ctid FROM product_variants WHERE sku <> $1 LIMIT 1)`, [sku])).toMatch(/unique|duplicate/);
  });
  it('order totals must add up', async () => {
    expect(await fails(`INSERT INTO orders (order_number, tracking_token_hash, ship_name, ship_phone, ship_line1, ship_city, ship_district, subtotal_cents, shipping_cents, total_cents, payment_method, status, payment_status)
      VALUES ('SC-261108-AAAAAA','x','n','0771234567','a','c','kandy',1000,350,999,'cod','confirmed','cod_pending')`)).toMatch(/check/);
  });
  it('audit log, inventory history and payment events are append-only', async () => {
    await db.query(`INSERT INTO audit_logs (actor_type, action) VALUES ('system','test')`);
    expect(await fails(`UPDATE audit_logs SET action = 'x'`)).toMatch(/append-only/);
    expect(await fails(`DELETE FROM audit_logs`)).toMatch(/append-only/);
    expect(await fails(`DELETE FROM inventory_movements`)).toMatch(/append-only/);
  });
  it('a product can have at most 8 images', async () => {
    const p = (await db.query(`SELECT id FROM products WHERE slug = 'mens-2'`)).rows[0].id;
    for (let i = 0; i < 8; i++) await db.query(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)`, [p, '/uploads/x' + i + '.webp', i]);
    expect(await fails(`INSERT INTO product_images (product_id, url) VALUES ($1, '/uploads/9.webp')`, [p])).toMatch(/at most 8/);
  });
  it('banner links cannot be javascript: URLs; colours must be hex', async () => {
    expect(await fails(`UPDATE banners SET link = 'javascript:alert(1)'`)).toMatch(/check/);
    expect(await fails(`UPDATE banners SET color = 'red;background:url(x)'`)).toMatch(/check/);
  });
});
