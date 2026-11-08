import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, Slug } from '../../lib/validate.js';
import { notFound } from '../../lib/errors.js';
import * as cat from '../../catalog.js';

const publicCache = 'public, max-age=30, stale-while-revalidate=120';

export default async function publicCatalog(app: FastifyInstance) {
  const db = app.db;
  app.get('/storefront', { schema: { tags: ['public'], summary: 'Everything the storefront renders (legacy SCG shape)' } }, async (_req, reply) => {
    reply.header('cache-control', publicCache);
    return cat.storefrontSnapshot(db);
  });
  app.get('/shops', { schema: { tags: ['public'] } }, async (_r, reply) => { reply.header('cache-control', publicCache); return cat.shops(db); });
  app.get('/categories', { schema: { tags: ['public'] } }, async (_r, reply) => { reply.header('cache-control', publicCache); return cat.legacyCategories(db); });
  app.get('/collections', { schema: { tags: ['public'] } }, async (_r, reply) => { reply.header('cache-control', publicCache); return cat.legacyCollections(db); });
  app.get('/site-content', { schema: { tags: ['public'] } }, async (_r, reply) => { reply.header('cache-control', publicCache); return cat.legacySettings(db); });
  app.get('/shipping-rates', { schema: { tags: ['public'] } }, async (_r, reply) => {
    reply.header('cache-control', publicCache);
    const r = await db.query(`SELECT code, name, fee_cents, free_over_cents FROM shipping_rates WHERE active ORDER BY code`);
    return r.rows.map(x => ({ code: x.code, name: x.name, fee: x.fee_cents / 100, freeOver: x.free_over_cents == null ? null : x.free_over_cents / 100 }));
  });

  const ListQ = z.strictObject({
    q: z.string().max(80).optional(), category: Slug.optional(), shop: Slug.optional(), origin: Slug.optional(),
    sort: z.enum(['new', 'price_asc', 'price_desc']).default('new'),
    limit: z.coerce.number().int().min(1).max(100).default(24), offset: z.coerce.number().int().min(0).max(10000).default(0),
  });
  app.get('/products', { schema: { tags: ['public'], summary: 'Search and filter products (paged)' } }, async (req, reply) => {
    const q = parse(ListQ, req.query);
    const where = [`p.status = 'active'`];
    const args: unknown[] = [];
    const arg = (v: unknown) => { args.push(v); return '$' + args.length; };
    if (q.q) { const a = arg(q.q); where.push(`(p.search @@ plainto_tsquery('simple', ${a}) OR p.name ILIKE '%' || ${a} || '%')`); }
    if (q.category) where.push(`c.slug = ${arg(q.category)}`);
    if (q.shop) where.push(`s.slug = ${arg(q.shop)}`);
    if (q.origin) where.push(`p.origin_code = ${arg(q.origin)}`);
    const order = { new: 'p.created_at DESC, p.id', price_asc: 'p.price_cents, p.id', price_desc: 'p.price_cents DESC, p.id' }[q.sort];
    const lim = arg(q.limit), off = arg(q.offset);
    const r = await db.query(`SELECT p.slug, count(*) OVER () AS total FROM products p
      JOIN categories c ON c.id = p.category_id JOIN shops s ON s.id = p.shop_id
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, args);
    const slugs: string[] = r.rows.map(x => x.slug);
    const items = slugs.length ? await cat.legacyProducts(db, { slugs }) : [];
    const bySlug = new Map(items.map(p => [p.id, p]));
    reply.header('cache-control', publicCache);
    return { total: r.rows[0]?.total ?? 0, items: slugs.map(s => bySlug.get(s)).filter(Boolean) };
  });
  app.get('/products/:slug', { schema: { tags: ['public'] } }, async (req, reply) => {
    const { slug } = parse(z.strictObject({ slug: Slug }), req.params);
    const [p] = await cat.legacyProducts(db, { slugs: [slug] });
    if (!p) throw notFound('Product not found.');
    reply.header('cache-control', publicCache);
    return p;
  });
}
