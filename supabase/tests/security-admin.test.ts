import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { authenticator } from 'otplib';
import { anon, service, staff, customer, rpc, q1, db, cfg, setStock, placeOrder } from './helpers.js';

const product = (over: any = {}) => ({ name: 'Test Linen Shirt', category: 'mens', price: 2490, comparePrice: 2990, origin: 'china', sizes: ['S', 'M'], collections: ['new-arrivals'], stockBySize: { S: 4, M: 6 }, ...over });

describe('what each kind of caller can reach (deny by default)', () => {
  it('tables are not reachable through the REST API at all', async () => {
    for (const t of ['orders', 'products', 'staff_users', 'payments', 'customers', 'audit_logs', 'jobs']) {
      const { error } = await anon().from(t).select('*').limit(1);
      expect(error, t).not.toBeNull();
    }
  });
  it('anonymous visitors can only read the catalogue and get quotes', async () => {
    const a = anon();
    expect((await rpc(a, 'storefront_snapshot')).data.products.length).toBe(144);
    for (const f of ['admin_state', 'admin_orders', 'admin_dashboard', 'admin_customers', 'my_orders', 'my_profile', 'track_order', 'apply_payhere_notification']) {
      expect((await rpc(a, f)).error, f).not.toBeNull();
    }
  });
  it('every app.* function and table privilege is closed to browser roles (catalogue check)', async () => {
    const open = await db().query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR (has_function_privilege('authenticated', p.oid, 'EXECUTE') AND p.proname NOT IN ('has_perm', 'current_aal', 'must_change_password')))`);
    expect(open.rows).toEqual([]);
    const tables = await db().query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r' AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))`);
    expect(tables.rows).toEqual([]);
    const norls = await db().query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    expect(norls.rows).toEqual([]);
    const pub = await db().query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1`);
    expect(pub.rows.map(r => r.proname)).toEqual(['get_product', 'quote_cart', 'search_products', 'storefront_snapshot']);
  });
  it('customers cannot use admin functions', async () => {
    const c = await customer();
    for (const f of ['admin_state', 'admin_orders', 'admin_dashboard', 'admin_staff_list']) expect((await rpc(c.c, f)).error, f).not.toBeNull();
  });
});

describe('staff MFA (two-step sign-in) enforced in the database', () => {
  afterAll(async () => { await db().query(`UPDATE app.security_settings SET require_staff_mfa = false`); });
  it('with MFA required, a password-only session is refused; after TOTP it works', async () => {
    await db().query(`UPDATE app.security_settings SET require_staff_mfa = true`);
    const s = await staff('editor1');
    const r1 = await rpc(s, 'admin_state');
    expect(r1.error?.hint).toBe('mfa_required');
    expect((await rpc(s, 'admin_me')).data.permissions).toEqual([]);
    const { data: f, error: e1 } = await s.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'test' + Date.now() });
    expect(e1).toBeNull();
    const { error: e2 } = await s.auth.mfa.challengeAndVerify({ factorId: f!.id, code: authenticator.generate(f!.totp.secret) });
    expect(e2).toBeNull();
    expect((await rpc(s, 'admin_state')).error).toBeNull();
    expect((await rpc(s, 'admin_me')).data.aal).toBe('aal2');
  });
});

describe('catalogue editing', () => {
  it('editor creates a product; another device sees it in the storefront; audit is written', async () => {
    const ed = await staff('editor1');
    const r = await rpc(ed, 'admin_save_product', { p_slug: null, p_data: product() });
    expect(r.error).toBeNull();
    expect(r.data.id).toMatch(/^test-linen-shirt/); expect(r.data.stock).toBe(10); expect(r.data.sizes).toEqual(['S', 'M']);
    const seen = (await rpc(anon(), 'storefront_snapshot')).data.products.find((p: any) => p.id === r.data.id);
    expect(seen).toMatchObject({ price: 2490, collections: ['new-arrivals'] });
    expect((await rpc(ed, 'admin_save_product', { p_slug: r.data.id, p_data: product({ name: 'Test Linen Shirt v2', price: 2290 }) })).error).toBeNull();
    expect((await rpc(anon(), 'get_product', { p_slug: r.data.id })).data).toMatchObject({ name: 'Test Linen Shirt v2', price: 2290 });
    const log = await db().query(`SELECT action, actor_label FROM app.audit_logs WHERE entity_id = $1 ORDER BY id`, [r.data.id]);
    expect(log.rows).toEqual([{ action: 'product.create', actor_label: 'editor1' }, { action: 'product.update', actor_label: 'editor1' }]);
  });
  it('rejects bad product data', async () => {
    const ed = await staff('editor1');
    for (const bad of [{ price: 0 }, { images: Array(9).fill('https://img.test/a.jpg') }, { images: ['javascript:alert(1)'] }, { category: 'nope' }, { color: 'red;}' }]) {
      expect((await rpc(ed, 'admin_save_product', { p_slug: null, p_data: product(bad) })).error, JSON.stringify(bad)).not.toBeNull();
    }
  });
  it('saves up to 8 photos (uploaded or https links) in order', async () => {
    const imgs = Array.from({ length: 8 }, (_, i) => `https://img.example.com/p/${i}.webp`);
    const r = await rpc(await staff('editor1'), 'admin_save_product', { p_slug: null, p_data: product({ name: 'Photo Test', images: imgs }) });
    expect(r.error).toBeNull();
    expect(r.data.images).toEqual(imgs); expect(r.data.image).toBe(imgs[0]);
  });
  it('rating, reviews and sold cannot be typed in', async () => {
    const r = await rpc(await staff('editor1'), 'admin_save_product', { p_slug: null, p_data: product({ name: 'No Fake Stars', rating: 5, reviews: 999, sold: 5000 }) });
    expect(r.data).toMatchObject({ rating: 0, reviews: 0, sold: 0 });
  });
  it('stock: per size, recorded with who/why, never below reserved', async () => {
    const ed = await staff('editor1');
    const p = (await rpc(ed, 'admin_save_product', { p_slug: null, p_data: product({ name: 'Stock Test Tee' }) })).data;
    const r = await rpc(ed, 'admin_set_stock', { p_slug: p.id, p_stock: { S: 1, M: 20 }, p_note: 'new delivery' });
    expect(r.data.stock).toBe(21);
    expect((await rpc(ed, 'admin_stock_history', { p_slug: p.id })).data[0]).toMatchObject({ reason: 'adjustment', note: 'new delivery', username: 'editor1' });
    await db().query(`UPDATE app.inventory SET reserved = 5 FROM app.product_variants v WHERE v.id = inventory.variant_id AND v.sku = $1`, [p.variants.find((v: any) => v.size === 'M').sku]);
    expect((await rpc(ed, 'admin_set_stock', { p_slug: p.id, p_stock: { M: 2 } })).code).toBe('conflict');
  });
  it('delete archives (hidden from the shop, history kept)', async () => {
    const ed = await staff('editor1');
    const p = (await rpc(ed, 'admin_save_product', { p_slug: null, p_data: product({ name: 'Archive Me' }) })).data;
    expect((await rpc(ed, 'admin_archive_product', { p_slug: p.id })).error).toBeNull();
    expect((await rpc(anon(), 'storefront_snapshot')).data.products.some((x: any) => x.id === p.id)).toBe(false);
    expect((await q1(`SELECT status FROM app.products WHERE slug = $1`, [p.id])).status).toBe('archived');
  });
  it('Shoes staff edit shoes only; support cannot edit at all', async () => {
    const s = await staff('shoesguy');
    const st = (await rpc(s, 'admin_state')).data;
    const shoe = st.products.find((p: any) => p.id === 'shoes-6'), shirt = st.products.find((p: any) => p.id === 'mens-11');
    expect((await rpc(s, 'admin_save_product', { p_slug: 'shoes-6', p_data: { ...shoe, name: 'Shoe Renamed' } })).error).toBeNull();
    expect((await rpc(s, 'admin_save_product', { p_slug: 'mens-11', p_data: { ...shirt, name: 'Hacked' } })).code).toBe('forbidden');
    expect((await rpc(s, 'admin_save_category', { p_slug: 'mens', p_data: { name: 'X' } })).code).toBe('forbidden');
    expect((await rpc(await staff('support1'), 'admin_save_product', { p_slug: null, p_data: product() })).error?.code).toBe('42501');
  });
});

describe('settings, banners, staff', () => {
  it('editors change homepage text but not fees; old browser login keys are dropped', async () => {
    const ed = await staff('editor1');
    expect((await rpc(ed, 'admin_save_settings', { p_data: { announcement: 'Big sale', heroTitle: 'New Title', adminUser: 'x', adminPassHash: 'y' } })).error).toBeNull();
    const s = (await rpc(anon(), 'storefront_snapshot')).data.settings;
    expect(s).toMatchObject({ announcement: 'Big sale', heroTitle: 'New Title' }); expect(s.adminUser).toBeUndefined();
    expect((await rpc(ed, 'admin_save_settings', { p_data: { shippingFee: 0 } })).error?.code).toBe('42501');
  });
  it('owner changes the delivery fee; quotes follow; cannot switch every payment method off', async () => {
    const o = await staff('owner1');
    expect((await rpc(o, 'admin_save_settings', { p_data: { shippingFee: 400, freeShipping: 15000 } })).error).toBeNull();
    const q = (await rpc(anon(), 'quote_cart', { p_items: [{ id: 'accessories-2', size: '', qty: 1 }] })).data;
    expect(q.shipping).toBe(400); expect(q.freeShippingOver).toBe(15000);
    expect((await rpc(o, 'admin_save_settings', { p_data: { payCOD: false, payBank: false, payOnline: false } })).code).toBe('bad_request');
  });
  it('banners: saved in order; javascript: links refused', async () => {
    const o = await staff('owner1');
    const list = (await rpc(anon(), 'storefront_snapshot')).data.hero;
    expect((await rpc(o, 'admin_save_banners', { p_list: [...list].reverse() })).error).toBeNull();
    expect((await rpc(anon(), 'storefront_snapshot')).data.hero.map((h: any) => h.id)).toEqual([...list].reverse().map((h: any) => h.id));
    expect((await rpc(o, 'admin_save_banners', { p_list: [{ ...list[0], link: 'javascript:alert(1)' }] })).code).toBe('bad_request');
  });
  it('staff list needs staff.manage; the last owner cannot be removed; customers cannot be promoted', async () => {
    expect((await rpc(await staff('support1'), 'admin_staff_list')).error?.code).toBe('42501');
    const o = await staff('owner1');
    const ownerId = (await q1(`SELECT id FROM app.staff_users WHERE username = 'owner1'`)).id;
    expect((await rpc(o, 'admin_staff_save', { p_staff_id: ownerId, p_data: { roles: ['support'] } })).code).toBe('bad_request');
    const c = await customer();
    expect((await rpc(o, 'admin_staff_save', { p_staff_id: c.id, p_data: { username: 'sneaky', displayName: 'S', roles: ['owner'] } })).code).toBe('bad_request');
  });
  it('dashboard is honest about backups; audit log is owner-only', async () => {
    const o = await staff('owner1');
    const d = (await rpc(o, 'admin_dashboard')).data;
    expect(d.backups.ok).toBe(false); expect(d.backups.problems[0]).toMatch(/No successful backup/);
    await db().query(`INSERT INTO app.backup_job_status (kind, status, started_at, finished_at) VALUES ('full', 'ok', now() - interval '5 minutes', now())`);
    expect((await rpc(o, 'admin_backups')).data.ok).toBe(true);
    expect((await rpc(o, 'admin_audit')).error).toBeNull();
    expect((await rpc(await staff('support1'), 'admin_audit')).error?.code).toBe('42501');
  });
});

describe('product photo uploads (Supabase Storage)', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const key = () => `products/2026/11/${crypto.randomUUID()}.png`;
  it('catalogue staff can upload; customers and visitors cannot; wrong names/types refused; a check job is queued', async () => {
    const ed = await staff('editor1'); const k = key();
    const up = await ed.storage.from('product-images').upload(k, png, { contentType: 'image/png' });
    expect(up.error).toBeNull();
    expect((await q1(`SELECT status FROM app.jobs WHERE dedupe_key = $1`, ['image.process:' + k])).status).toBe('queued');
    expect((await ed.storage.from('product-images').upload('evil/x.png', png, { contentType: 'image/png' })).error).not.toBeNull();
    expect((await ed.storage.from('product-images').upload(key().replace('.png', '.svg'), Buffer.from('<svg/>'), { contentType: 'image/svg+xml' })).error).not.toBeNull();
    const c = await customer();
    expect((await c.c.storage.from('product-images').upload(key(), png, { contentType: 'image/png' })).error).not.toBeNull();
    expect((await anon().storage.from('product-images').upload(key(), png, { contentType: 'image/png' })).error).not.toBeNull();
    const pub = ed.storage.from('product-images').getPublicUrl(k).data.publicUrl;
    expect((await fetch(pub)).status).toBe(200);
  });
});

describe('VPS worker queue (as the sc_worker database role)', () => {
  let w: pg.Client;
  afterAll(async () => { await w?.end(); });
  it('claims with leases, retries with backoff, goes dead after max attempts, never runs a job twice at once', async () => {
    w = new pg.Client({ connectionString: cfg().db.replace('postgres:postgres@', 'sc_worker:local-worker-test-only@') }); await w.connect();
    // the worker role cannot read business tables
    await expect(w.query(`SELECT * FROM app.orders LIMIT 1`)).rejects.toThrow(/permission denied/);
    const id = (await q1(`SELECT app.enqueue_job('report.test', '{"x":1}', 'report.test:1') id`)).id;
    expect((await q1(`SELECT app.enqueue_job('report.test', '{"x":1}', 'report.test:1') id`)).id).toBe(id);           // de-duplicated
    const [a, b] = await Promise.all([
      w.query(`SELECT * FROM app.worker_claim_jobs('w1', ARRAY['report.test'], 5, 60)`),
      w.query(`SELECT * FROM app.worker_claim_jobs('w2', ARRAY['report.test'], 5, 60)`)]);
    expect(a.rows.length + b.rows.length).toBe(1);                                                                     // only one worker got it
    const owner = a.rows.length ? 'w1' : 'w2', other = owner === 'w1' ? 'w2' : 'w1';
    expect((await w.query(`SELECT app.worker_complete_job($1, $2) ok`, [id, other])).rows[0].ok).toBe(false);          // not the lease holder
    expect((await w.query(`SELECT app.worker_fail_job($1, $2, 'boom') r`, [id, owner])).rows[0].r).toBe('retry');
    expect((await q1(`SELECT status, run_after > now() later FROM app.jobs WHERE id = $1`, [id]))).toEqual({ status: 'queued', later: true });
    // worker crash: lease expires, another worker picks it up again
    await db().query(`UPDATE app.jobs SET run_after = now() - interval '1 second' WHERE id = $1`, [id]);
    await w.query(`SELECT * FROM app.worker_claim_jobs('w3', ARRAY['report.test'], 1, 60)`);
    await db().query(`UPDATE app.jobs SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
    expect((await w.query(`SELECT id FROM app.worker_claim_jobs('w4', ARRAY['report.test'], 1, 60)`)).rows[0].id).toBe(id);
    await db().query(`UPDATE app.jobs SET attempts = max_attempts WHERE id = $1`, [id]);
    expect((await w.query(`SELECT app.worker_fail_job($1, 'w4', 'still broken') r`, [id])).rows[0].r).toBe('dead');
    expect((await q1(`SELECT status FROM app.jobs WHERE id = $1`, [id])).status).toBe('dead');
    expect((await w.query(`SELECT app.worker_queue_stats() s`)).rows[0].s.dead).toBeGreaterThanOrEqual(1);
  });
  it('checkout still works while no worker is running (jobs just wait)', async () => {
    await setStock('WOMENS-6-M', 3);
    const r = await placeOrder([{ id: 'womens-6', size: 'M', qty: 1 }]);
    expect(r.error).toBeNull();
    expect((await q1(`SELECT status FROM app.jobs WHERE dedupe_key = $1`, ['email.order_placed:' + r.data.orderNumber])).status).toBe('queued');
  });
});

describe('database rules (same guarantees as before)', () => {
  const fails = async (sql: string) => { try { await db().query(sql); return null; } catch (e: any) { return e.message as string; } };
  it('stock, prices, totals, append-only history, 8 photos, safe links', async () => {
    expect(await fails(`UPDATE app.inventory SET on_hand = -1 WHERE variant_id = (SELECT variant_id FROM app.inventory LIMIT 1)`)).toMatch(/check/);
    expect(await fails(`UPDATE app.products SET price_cents = 0 WHERE slug = 'mens-2'`)).toMatch(/check/);
    expect(await fails(`UPDATE app.audit_logs SET action = 'x'`)).toMatch(/append-only/);
    expect(await fails(`DELETE FROM app.inventory_movements`)).toMatch(/append-only/);
    expect(await fails(`UPDATE app.banners SET link = 'javascript:alert(1)'`)).toMatch(/check/);
    expect(await fails(`UPDATE app.ops_settings SET payhere_mode = 'live'`)).toMatch(/check/);          // live needs recorded owner approval
    expect((await q1(`SELECT count(*)::int n FROM app.products WHERE (rating > 0 OR reviews_count > 0) AND created_by IS NULL`)).n).toBe(0);
  });
});
