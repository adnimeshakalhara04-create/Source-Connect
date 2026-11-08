import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, Agent, json } from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: FastifyInstance;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-up-'));
beforeAll(async () => { ({ app } = await makeApp({ UPLOAD_DIR: uploadDir, PUBLIC_UPLOAD_URL: 'http://api.test/uploads' })); });
afterAll(async () => { await app.close(); });

const product = (over: any = {}) => ({ name: 'Test Linen Shirt', category: 'mens', price: 2490, comparePrice: 2990, origin: 'china', sizes: ['S', 'M'], collections: ['new-arrivals'], stockBySize: { S: 4, M: 6 }, ...over });
const storefront = async () => json(await new Agent(app).get('/api/v1/storefront'));

describe('catalogue editing (persists in PostgreSQL, visible to every device)', () => {
  it('an editor creates a product; a different "device" sees it in the storefront with server stock', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    const r = await ed.post('/api/v1/admin/products', product());
    expect(r.statusCode).toBe(200);
    const p = json(r);
    expect(p.id).toMatch(/^test-linen-shirt/); expect(p.stock).toBe(10); expect(p.sizes).toEqual(['S', 'M']);
    const phone = await storefront();                       // another browser, not signed in
    const seen = phone.products.find((x: any) => x.id === p.id);
    expect(seen.price).toBe(2490); expect(seen.collections).toContain('new-arrivals');
    // edit and see the change
    expect((await ed.put('/api/v1/admin/products/' + p.id, product({ name: 'Test Linen Shirt v2', price: 2290 }))).statusCode).toBe(200);
    expect((await storefront()).products.find((x: any) => x.id === p.id)).toMatchObject({ name: 'Test Linen Shirt v2', price: 2290 });
    const log = await app.db.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [p.id]);
    expect(log.rows.map(r => r.action)).toEqual(['product.create', 'product.update']);
  });
  it('rejects bad product data (0 price, too many photos, javascript links, unknown category)', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    expect((await ed.post('/api/v1/admin/products', product({ price: 0 }))).statusCode).toBe(400);
    expect((await ed.post('/api/v1/admin/products', product({ images: Array(9).fill('https://img.test/a.jpg') }))).statusCode).toBe(400);
    expect((await ed.post('/api/v1/admin/products', product({ images: ['javascript:alert(1)'] }))).statusCode).toBe(400);
    expect((await ed.post('/api/v1/admin/products', product({ category: 'nope' }))).statusCode).toBe(400);
    expect((await ed.post('/api/v1/admin/products', product({ color: 'red;}' }))).statusCode).toBe(400);
  });
  it('rating, reviews and sold counts cannot be typed in by staff', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    const p = json(await ed.post('/api/v1/admin/products', product({ name: 'No Fake Stars', rating: 5, reviews: 999, sold: 5000 })));
    expect(p).toMatchObject({ rating: 0, reviews: 0, sold: 0 });
  });
  it('stock changes are recorded with who/why, and cannot go below what unpaid orders reserved', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    const p = json(await ed.post('/api/v1/admin/products', product({ name: 'Stock Test Tee' })));
    const r = await ed.put(`/api/v1/admin/products/${p.id}/stock`, { stock: { S: 1, M: 20 }, note: 'new delivery' });
    expect(r.statusCode).toBe(200); expect(json(r).stock).toBe(21);
    const hist = json(await ed.get(`/api/v1/admin/products/${p.id}/stock-history`));
    expect(hist[0]).toMatchObject({ reason: 'adjustment', note: 'new delivery', username: 'editor1' });
    await app.db.query(`UPDATE inventory SET reserved = 5 FROM product_variants v WHERE v.id = inventory.variant_id AND v.sku = $1`, [p.variants.find((v: any) => v.size === 'M').sku]);
    expect((await ed.put(`/api/v1/admin/products/${p.id}/stock`, { stock: { M: 2 } })).statusCode).toBe(409);
  });
  it('delete archives the product (history kept) and hides it from the shop', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    const p = json(await ed.post('/api/v1/admin/products', product({ name: 'Archive Me' })));
    expect((await ed.req('DELETE', '/api/v1/admin/products/' + p.id)).statusCode).toBe(200);
    expect((await storefront()).products.some((x: any) => x.id === p.id)).toBe(false);
    expect((await app.db.query(`SELECT status FROM products WHERE slug = $1`, [p.id])).rows[0].status).toBe('archived');
  });
});

describe('department (shop) scoped staff', () => {
  it('Shoes staff can edit shoes but not clothing', async () => {
    const s = await new Agent(app).staffLogin('shoesguy');
    const state = json(await s.get('/api/v1/admin/state'));
    const shoe = state.products.find((p: any) => p.id === 'shoes-6');
    expect((await s.put('/api/v1/admin/products/shoes-6', { ...shoe, name: 'Shoe Renamed' })).statusCode).toBe(200);
    const shirt = state.products.find((p: any) => p.id === 'mens-11');
    expect((await s.put('/api/v1/admin/products/mens-11', { ...shirt, name: 'Hacked' })).statusCode).toBe(403);
    expect((await s.post('/api/v1/admin/products', product())).statusCode).toBe(403);
    expect((await s.put('/api/v1/admin/categories/mens', { name: 'X' })).statusCode).toBe(403);
  });
  it('support staff cannot change products or settings', async () => {
    const s = await new Agent(app).staffLogin('support1');
    expect((await s.post('/api/v1/admin/products', product())).statusCode).toBe(403);
    expect((await s.put('/api/v1/admin/settings', { announcement: 'hi' })).statusCode).toBe(403);
  });
});

describe('website settings, banners and content', () => {
  it('content editors change homepage text but not fees/payments; legacy admin password keys are dropped', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    const r = await ed.put('/api/v1/admin/settings', { announcement: 'Big sale', heroTitle: 'New Title', adminUser: 'x', adminPassHash: 'y' });
    expect(r.statusCode).toBe(200);
    const s = (await storefront()).settings;
    expect(s.announcement).toBe('Big sale'); expect(s.heroTitle).toBe('New Title');
    expect(s.adminUser).toBeUndefined(); expect(s.adminPassHash).toBeUndefined();
    expect((await ed.put('/api/v1/admin/settings', { shippingFee: 0 })).statusCode).toBe(403);
  });
  it('owner changes delivery fee; checkout quote follows immediately', async () => {
    const o = await new Agent(app).staffLogin('owner1');
    expect((await o.put('/api/v1/admin/settings', { shippingFee: 400, freeShipping: 15000 })).statusCode).toBe(200);
    const q = json(await new Agent(app).post('/api/v1/cart/quote', { items: [{ id: 'accessories-2', size: '', qty: 1 }] }));
    expect(q.shipping).toBe(400); expect(q.freeShippingOver).toBe(15000);
    expect((await o.put('/api/v1/admin/settings', { payCOD: false, payBank: false })).statusCode).toBe(400);
  });
  it('banners: whole list saved in order; unsafe links refused', async () => {
    const o = await new Agent(app).staffLogin('owner1');
    const list = (await storefront()).hero;
    expect((await o.put('/api/v1/admin/banners', [...list].reverse())).statusCode).toBe(200);
    expect((await storefront()).hero.map((h: any) => h.id)).toEqual([...list].reverse().map((h: any) => h.id));
    expect((await o.put('/api/v1/admin/banners', [{ ...list[0], link: 'javascript:alert(1)' }])).statusCode).toBe(400);
  });
});

describe('image uploads', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const form = (buf: Buffer, name: string, type: string) => {
    const b = '----sc' + Date.now();
    const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
    return { body, ct: 'multipart/form-data; boundary=' + b };
  };
  it('accepts a real image, refuses an HTML/SVG file pretending to be an image, refuses non-staff', async () => {
    const ed = await new Agent(app).staffLogin('editor1');
    const ok = form(png, 'a.png', 'image/png');
    const r = await ed.req('POST', '/api/v1/admin/uploads', ok.body, { 'content-type': ok.ct });
    expect(r.statusCode).toBe(200);
    expect(json(r).url).toMatch(/^http:\/\/api\.test\/uploads\/products\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    const evil = form(Buffer.from('<svg onload=alert(1)>'), 'x.png', 'image/png');
    expect((await ed.req('POST', '/api/v1/admin/uploads', evil.body, { 'content-type': evil.ct })).statusCode).toBe(400);
    const sup = await new Agent(app).staffLogin('support1');
    expect((await sup.req('POST', '/api/v1/admin/uploads', ok.body, { 'content-type': ok.ct })).statusCode).toBe(403);
    expect((await new Agent(app).req('POST', '/api/v1/admin/uploads', ok.body, { 'content-type': ok.ct })).statusCode).toBe(401);
  });
});

describe('dashboard, audit and backups', () => {
  it('dashboard shows low stock, payments to verify and backup health; backup health is honest when nothing ran', async () => {
    const o = await new Agent(app).staffLogin('owner1');
    const d = json(await o.get('/api/v1/admin/dashboard'));
    expect(Array.isArray(d.lowStock)).toBe(true);
    expect(d.backups.ok).toBe(false);
    expect(d.backups.problems[0]).toMatch(/No successful backup/);
    await app.db.query(`INSERT INTO backup_job_status (kind, status, started_at, finished_at) VALUES ('diff','ok', now() - interval '10 minutes', now())`);
    expect(json(await o.get('/api/v1/admin/backups')).ok).toBe(true);
  });
  it('audit log is readable by the owner, not by support', async () => {
    expect((await (await new Agent(app).staffLogin('owner1')).get('/api/v1/admin/audit')).statusCode).toBe(200);
    expect((await (await new Agent(app).staffLogin('support1')).get('/api/v1/admin/audit')).statusCode).toBe(403);
  });
});
