import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { parse, Slug, HexColor, ImageUrl, Text } from '../../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { requireStaff, actorOf, hasShopAccess } from '../../auth/staff.js';
import { audit } from '../../lib/audit.js';
import { tx } from '../../db/pool.js';
import { skuFor } from '../../db/legacy-catalog.js';
import * as cat from '../../catalog.js';

const Size = z.string().trim().max(20).regex(/^[A-Za-z0-9 ./+-]*$/, 'sizes use letters, numbers, - . / +');
const Money = z.number().min(0).max(10_000_000).transform(v => Math.round(v * 100));

export const ProductInput = z.object({
  id: Slug.optional(),
  name: Text(160).pipe(z.string().min(1, 'type a product name')),
  category: Slug,
  brand: Text(80).default(''),
  description: Text(5000).default(''),
  badge: Text(30).default(''),
  price: Money.refine(c => c > 0, 'price must be more than 0'),
  comparePrice: Money.default(0),
  color: HexColor.default('#0b2a6f'), accent: HexColor.or(z.literal('')).default(''),
  shape: z.string().max(30).regex(/^[a-z0-9-]+$/).default('tshirt'), pattern: z.string().max(30).regex(/^[a-z0-9-]*$/).default('solid'),
  origin: Slug,
  sizes: z.array(Size).max(30).default([]),
  collections: z.array(Slug).max(30).default([]),
  images: z.array(ImageUrl).max(8, 'up to 8 photos').default([]),
  image: z.string().optional(),
  featured: z.boolean().default(false), flash: z.boolean().default(false),
  status: z.enum(['draft', 'active', 'archived']).default('active'),
  // initial stock for a NEW product, by size ('' = one size). Later changes go through the stock endpoint.
  stockBySize: z.record(z.string(), z.number().int().min(0).max(1_000_000)).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
}).strip();   // legacy UI fields like rating/reviews/sold/createdAt are ignored: the server owns them

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

async function shopOfCategory(c: PoolClient | import('pg').Pool, slug: string) {
  const r = await c.query(`SELECT id, shop_id FROM categories WHERE slug = $1`, [slug]);
  if (!r.rowCount) throw badRequest('Unknown category.');
  return r.rows[0] as { id: string; shop_id: string };
}
function checkShop(req: FastifyRequest, shopId: string) { if (!hasShopAccess(req.staff!, shopId)) throw forbidden('This product belongs to a department you do not manage.'); }

async function syncVariants(c: PoolClient, productId: string, slug: string, sizes: string[], initial?: Record<string, number>, staffId?: string) {
  const want = sizes.length ? [...new Set(sizes)] : [''];
  const cur = await c.query(`SELECT id, size, active FROM product_variants WHERE product_id = $1`, [productId]);
  const bySize = new Map(cur.rows.map(r => [r.size, r]));
  for (const [i, size] of want.entries()) {
    const ex = bySize.get(size);
    if (ex) { await c.query(`UPDATE product_variants SET active = true, sort_order = $2 WHERE id = $1`, [ex.id, i]); continue; }
    let sku = skuFor(slug, size), n = 1;
    while ((await c.query(`SELECT 1 FROM product_variants WHERE sku = $1`, [sku])).rowCount) sku = skuFor(slug + '-' + (++n), size);
    const v = await c.query(`INSERT INTO product_variants (product_id, sku, size, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`, [productId, sku, size, i]);
    const qty = initial?.[size] ?? 0;
    await c.query(`INSERT INTO inventory (variant_id, on_hand) VALUES ($1,$2)`, [v.rows[0].id, qty]);
    if (qty) await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, reason, staff_id, note) VALUES ($1,$2,'adjustment',$3,'initial stock')`, [v.rows[0].id, qty, staffId || null]);
  }
  for (const r of cur.rows) if (!want.includes(r.size) && r.active) await c.query(`UPDATE product_variants SET active = false WHERE id = $1`, [r.id]);
}

async function syncCollections(c: PoolClient, productId: string, slugs: string[]) {
  const cols = await c.query(`SELECT id, slug FROM collections WHERE slug = ANY($1)`, [slugs]);
  const ids = cols.rows.map(r => r.id);
  await c.query(`DELETE FROM collection_products WHERE product_id = $1 AND NOT (collection_id = ANY($2))`, [productId, ids]);
  for (const id of ids) await c.query(`INSERT INTO collection_products (collection_id, product_id, sort_order) VALUES ($1,$2, 1000) ON CONFLICT DO NOTHING`, [id, productId]);
}

async function syncImages(c: PoolClient, productId: string, urls: string[]) {
  await c.query(`DELETE FROM product_images WHERE product_id = $1`, [productId]);
  for (const [i, url] of urls.slice(0, 8).entries()) await c.query(`INSERT INTO product_images (product_id, url, sort_order, object_key) VALUES ($1,$2,$3,$4)`,
    [productId, url, i, url.includes('/uploads/') ? url.slice(url.indexOf('/uploads/') + 9) : null]);
}

export default async function adminCatalog(app: FastifyInstance) {
  const db = app.db;

  // Everything the admin panel edits, in the legacy shape, plus per-size stock details.
  app.get('/state', { preHandler: requireStaff(db, 'catalog.read'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const [settings, categories, collections, hero, products, shops] = await Promise.all([
      cat.legacySettings(db), cat.legacyCategories(db, true), cat.legacyCollections(db), cat.legacyBanners(db, true),
      cat.legacyProducts(db, { includeInactive: true }), cat.shops(db),
    ]);
    const s = req.staff!;
    const stock = await db.query(`SELECT p.slug, v.sku, v.size, v.active, i.on_hand, i.reserved, i.reorder_level FROM product_variants v JOIN products p ON p.id = v.product_id JOIN inventory i ON i.variant_id = v.id ORDER BY p.slug, v.sort_order`);
    const bySlug: Record<string, any[]> = {};
    for (const r of stock.rows) (bySlug[r.slug] ||= []).push({ sku: r.sku, size: r.size, active: r.active, onHand: r.on_hand, reserved: r.reserved, reorder: r.reorder_level });
    const myShops = s.shopIds === null ? null : (await db.query(`SELECT slug FROM shops WHERE id = ANY($1)`, [s.shopIds])).rows.map(r => r.slug);
    return {
      version: 4, source: 'api', settings, categories, collections, hero, shops,
      products: products.filter(p => p.status !== 'archived').map(p => ({ ...p, stockDetail: bySlug[p.id] || [] })),
      me: { username: s.username, displayName: s.displayName, roles: s.roles, permissions: [...s.permissions], shops: myShops },
    };
  });

  app.post('/products', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const b = parse(ProductInput, req.body);
    const catRow = await shopOfCategory(db, b.category); checkShop(req, catRow.shop_id);
    if (b.images.length > 8) throw badRequest('Up to 8 photos.');
    const slug = await tx(db, async c => {
      let slug = b.id && !(await c.query(`SELECT 1 FROM products WHERE slug = $1`, [b.id])).rowCount ? b.id : slugify(b.name);
      while ((await c.query(`SELECT 1 FROM products WHERE slug = $1`, [slug])).rowCount) slug = slugify(b.name).slice(0, 52) + '-' + Math.random().toString(36).slice(2, 7);
      const r = await c.query(`INSERT INTO products (slug, shop_id, category_id, name, brand, description, origin_code, status, badge, featured, flash, price_cents, compare_price_cents, visual, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [slug, catRow.shop_id, catRow.id, b.name, b.brand, b.description, b.origin, b.status, b.badge, b.featured, b.flash, b.price, b.comparePrice,
          JSON.stringify({ shape: b.shape, pattern: b.pattern, color: b.color, accent: b.accent }), req.staff!.id]);
      const pid = r.rows[0].id;
      const initial = b.stockBySize ?? (b.stock != null ? (b.sizes.length ? Object.fromEntries(b.sizes.map((s, i) => [s, i === 0 ? b.stock! : 0])) : { '': b.stock }) : undefined);
      await syncVariants(c, pid, slug, b.sizes, initial, req.staff!.id);
      await syncCollections(c, pid, b.collections);
      await syncImages(c, pid, b.images);
      await audit(c, actorOf(req), 'product.create', 'product', slug, undefined, b);
      return slug;
    });
    return (await cat.legacyProducts(db, { includeInactive: true, slugs: [slug] }))[0];
  });

  app.put('/products/:slug', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const b = parse(ProductInput, req.body);
    await tx(db, async c => {
      const cur = await c.query(`SELECT * FROM products WHERE slug = $1 FOR UPDATE`, [slug]);
      if (!cur.rowCount) throw notFound('Product not found.');
      const p = cur.rows[0];
      checkShop(req, p.shop_id);
      const catRow = await shopOfCategory(c, b.category); checkShop(req, catRow.shop_id);
      const before = (await cat.legacyProducts(c, { includeInactive: true, slugs: [slug] }))[0];
      await c.query(`UPDATE products SET shop_id=$2, category_id=$3, name=$4, brand=$5, description=$6, origin_code=$7, status=$8, badge=$9, featured=$10, flash=$11,
          price_cents=$12, compare_price_cents=$13, visual=$14 WHERE id = $1`,
        [p.id, catRow.shop_id, catRow.id, b.name, b.brand, b.description, b.origin, b.status, b.badge, b.featured, b.flash, b.price, b.comparePrice,
          JSON.stringify({ shape: b.shape, pattern: b.pattern, color: b.color, accent: b.accent })]);
      await syncVariants(c, p.id, slug, b.sizes);
      await syncCollections(c, p.id, b.collections);
      await syncImages(c, p.id, b.images);
      await audit(c, actorOf(req), 'product.update', 'product', slug, before, b);
    });
    return (await cat.legacyProducts(db, { includeInactive: true, slugs: [slug] }))[0];
  });

  // "Delete" archives: paid orders keep pointing at the product, and history is never lost.
  app.delete('/products/:slug', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const r = await db.query(`SELECT id, shop_id FROM products WHERE slug = $1`, [slug]);
    if (!r.rowCount) throw notFound('Product not found.');
    checkShop(req, r.rows[0].shop_id);
    await db.query(`UPDATE products SET status = 'archived' WHERE id = $1`, [r.rows[0].id]);
    await audit(db, actorOf(req), 'product.archive', 'product', slug);
    return { ok: true, archived: true };
  });

  // Stock levels: set the number on the shelf per size. Every change is recorded in inventory_movements.
  app.put('/products/:slug/stock', { preHandler: requireStaff(db, 'inventory.adjust'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const b = parse(z.strictObject({
      stock: z.record(z.string().max(20), z.number().int().min(0).max(1_000_000)).optional(),  // size -> on hand
      total: z.number().int().min(0).max(1_000_000).optional(),                              // one-size products / legacy inline edit
      reorder: z.record(z.string().max(20), z.number().int().min(0).max(100_000)).optional(),
      note: z.string().max(200).default(''),
    }), req.body);
    await tx(db, async c => {
      const p = await c.query(`SELECT id, shop_id FROM products WHERE slug = $1`, [slug]);
      if (!p.rowCount) throw notFound('Product not found.');
      checkShop(req, p.rows[0].shop_id);
      const vs = await c.query(`SELECT v.id, v.size, i.on_hand, i.reserved FROM product_variants v JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = $1 AND v.active ORDER BY v.id FOR UPDATE OF i`, [p.rows[0].id]);
      let target = b.stock;
      if (!target && b.total != null) {
        if (vs.rowCount !== 1) throw badRequest('This product has several sizes. Set the stock for each size.');
        target = { [vs.rows[0].size]: b.total };
      }
      for (const v of vs.rows) {
        if (target && target[v.size] != null) {
          const want = target[v.size];
          if (want < v.reserved) throw conflict(`Size ${v.size || '(one size)'} has ${v.reserved} reserved for unpaid orders; stock cannot go below that.`);
          if (want !== v.on_hand) {
            await c.query(`UPDATE inventory SET on_hand = $2 WHERE variant_id = $1`, [v.id, want]);
            await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, reason, staff_id, note) VALUES ($1,$2,'adjustment',$3,$4)`, [v.id, want - v.on_hand, req.staff!.id, b.note]);
          }
        }
        if (b.reorder && b.reorder[v.size] != null) await c.query(`UPDATE inventory SET reorder_level = $2 WHERE variant_id = $1`, [v.id, b.reorder[v.size]]);
      }
      await audit(c, actorOf(req), 'inventory.adjust', 'product', slug, undefined, b);
    });
    return (await cat.legacyProducts(db, { includeInactive: true, slugs: [slug] }))[0];
  });

  app.get('/products/:slug/stock-history', { preHandler: requireStaff(db, 'catalog.read'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const r = await db.query(`SELECT m.created_at, v.size, m.delta_on_hand, m.delta_reserved, m.reason, m.note, u.username, o.order_number
      FROM inventory_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
      LEFT JOIN staff_users u ON u.id = m.staff_id LEFT JOIN orders o ON o.id = m.order_id WHERE p.slug = $1 ORDER BY m.created_at DESC LIMIT 200`, [slug]);
    return r.rows;
  });

  // ---------------- categories ----------------
  const CategoryInput = z.object({
    name: Text(80).pipe(z.string().min(1)), tagline: Text(120).default(''), shape: z.string().max(30).regex(/^[a-z0-9-]+$/).default('tshirt'),
    icon: HexColor.default('#0b2a6f'), image: ImageUrl.or(z.literal('')).default(''), shop: Slug.optional(), hidden: z.boolean().default(false),
  }).strip();
  app.put('/categories/:slug', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const b = parse(CategoryInput, req.body);
    if (req.staff!.shopIds !== null) throw forbidden('Only full catalogue editors can change categories.');
    await tx(db, async c => {
      const shop = b.shop ? (await c.query(`SELECT id FROM shops WHERE slug = $1`, [b.shop])).rows[0]?.id : null;
      if (b.shop && !shop) throw badRequest('Unknown department.');
      const ex = await c.query(`SELECT id FROM categories WHERE slug = $1`, [slug]);
      if (ex.rowCount) {
        await c.query(`UPDATE categories SET name=$2, tagline=$3, shape=$4, icon_color=$5, image_url=nullif($6,''), status=$7, shop_id = coalesce($8, shop_id) WHERE slug = $1`,
          [slug, b.name, b.tagline, b.shape, b.icon, b.image, b.hidden ? 'hidden' : 'active', shop]);
        if (shop) await c.query(`UPDATE products SET shop_id = $2 WHERE category_id = $1`, [ex.rows[0].id, shop]);
      } else {
        const def = shop || (await c.query(`SELECT id FROM shops ORDER BY sort_order LIMIT 1`)).rows[0].id;
        await c.query(`INSERT INTO categories (slug, shop_id, name, tagline, shape, icon_color, image_url, sort_order, status) VALUES ($1,$2,$3,$4,$5,$6,nullif($7,''), (SELECT coalesce(max(sort_order),0)+1 FROM categories), $8)`,
          [slug, def, b.name, b.tagline, b.shape, b.icon, b.image, b.hidden ? 'hidden' : 'active']);
      }
      await audit(c, actorOf(req), 'category.save', 'category', slug, undefined, b);
    });
    return { ok: true };
  });
  app.delete('/categories/:slug', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    if (req.staff!.shopIds !== null) throw forbidden();
    const r = await db.query(`SELECT count(*)::int n FROM products p JOIN categories c ON c.id = p.category_id WHERE c.slug = $1 AND p.status <> 'archived'`, [slug]);
    if (r.rows[0].n) throw conflict(`Move or delete the ${r.rows[0].n} products in this category first.`);
    const del = await db.query(`DELETE FROM categories c WHERE slug = $1 AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)`, [slug]);
    if (!del.rowCount) await db.query(`UPDATE categories SET status = 'hidden' WHERE slug = $1`, [slug]);
    await audit(db, actorOf(req), 'category.delete', 'category', slug);
    return { ok: true };
  });
  app.put('/categories-order', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const b = parse(z.strictObject({ slugs: z.array(Slug).max(200) }), req.body);
    await tx(db, async c => { for (const [i, s] of b.slugs.entries()) await c.query(`UPDATE categories SET sort_order = $2 WHERE slug = $1`, [s, i]); });
    await audit(db, actorOf(req), 'category.reorder', 'category', null, undefined, b);
    return { ok: true };
  });

  // ---------------- collections ----------------
  const CollectionInput = z.object({
    name: Text(80).pipe(z.string().min(1)), description: Text(300).default(''), accent: HexColor.default('#0b2a6f'),
    image: ImageUrl.or(z.literal('')).default(''), homeRow: z.boolean().default(false), order: z.array(Slug).max(2000).optional(),
  }).strip();
  app.put('/collections/:slug', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const b = parse(CollectionInput, req.body);
    await tx(db, async c => {
      const r = await c.query(`INSERT INTO collections (slug, name, description, accent, image_url, home_row, manual_order, sort_order)
          VALUES ($1,$2,$3,$4,nullif($5,''),$6,$7,(SELECT coalesce(max(sort_order),0)+1 FROM collections))
        ON CONFLICT (slug) DO UPDATE SET name=$2, description=$3, accent=$4, image_url=nullif($5,''), home_row=$6, manual_order=$7 RETURNING id`,
        [slug, b.name, b.description, b.accent, b.image, b.homeRow, !!b.order]);
      if (b.order) for (const [i, s] of b.order.entries())
        await c.query(`UPDATE collection_products cp SET sort_order = $3 FROM products p WHERE cp.product_id = p.id AND cp.collection_id = $1 AND p.slug = $2`, [r.rows[0].id, s, i]);
      await audit(c, actorOf(req), 'collection.save', 'collection', slug, undefined, { ...b, order: b.order ? b.order.length + ' items' : undefined });
    });
    return { ok: true };
  });
  app.delete('/collections/:slug', { preHandler: requireStaff(db, 'catalog.write'), schema: { tags: ['admin-catalog'] } }, async (req) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    await db.query(`DELETE FROM collections WHERE slug = $1`, [slug]);   // only removes the grouping, never products
    await audit(db, actorOf(req), 'collection.delete', 'collection', slug);
    return { ok: true };
  });
}
