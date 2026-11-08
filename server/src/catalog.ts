import type { Pool, PoolClient } from 'pg';

type Q = Pool | PoolClient;
const rs = (cents: number) => cents / 100;

/** Products in the legacy storefront shape. `stock` = units available now (on hand − reserved). */
export async function legacyProducts(db: Q, opts: { includeInactive?: boolean; slugs?: string[] } = {}): Promise<any[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (!opts.includeInactive) where.push(`p.status = 'active'`);
  if (opts.slugs) { args.push(opts.slugs); where.push(`p.slug = ANY($${args.length})`); }
  const r = await db.query(`
    SELECT p.id, p.slug, p.name, p.brand, p.description, p.origin_code, p.status, p.badge, p.featured, p.flash,
           p.price_cents, p.compare_price_cents, p.visual, p.rating, p.reviews_count, p.sold_count, p.created_at,
           c.slug AS category, s.slug AS shop,
           coalesce((SELECT json_agg(json_build_object('sku', v.sku, 'size', v.size, 'color', v.color, 'active', v.active,
                       'onHand', i.on_hand, 'reserved', i.reserved, 'available', i.on_hand - i.reserved, 'reorder', i.reorder_level,
                       'price', CASE WHEN v.price_cents IS NULL THEN NULL ELSE v.price_cents / 100.0 END) ORDER BY v.sort_order, v.size)
                     FROM product_variants v JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = p.id), '[]') AS variants,
           coalesce((SELECT json_agg(im.url ORDER BY im.sort_order) FROM product_images im WHERE im.product_id = p.id), '[]') AS images,
           coalesce((SELECT json_agg(co.slug ORDER BY co.sort_order) FROM collection_products cp JOIN collections co ON co.id = cp.collection_id WHERE cp.product_id = p.id), '[]') AS collections
      FROM products p JOIN categories c ON c.id = p.category_id JOIN shops s ON s.id = p.shop_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.created_at DESC, p.id`, args);
  return r.rows.map(p => {
    const vis = p.visual || {};
    const active = (p.variants as any[]).filter(v => v.active);
    return {
      id: p.slug, name: p.name, category: p.category, shop: p.shop, brand: p.brand, description: p.description,
      shape: vis.shape || 'tshirt', pattern: vis.pattern || 'solid', color: vis.color || '#0b2a6f', accent: vis.accent || '',
      collections: p.collections, price: rs(p.price_cents), comparePrice: rs(p.compare_price_cents),
      image: p.images[0] || '', images: p.images,
      sizes: active.map(v => v.size).filter(Boolean),
      variants: active.map(v => ({ sku: v.sku, size: v.size, color: v.color, stock: Math.max(0, v.available), price: v.price })),
      stock: active.reduce((n, v) => n + Math.max(0, v.available), 0),
      sold: p.sold_count, rating: Number(p.rating), reviews: p.reviews_count,
      origin: p.origin_code, badge: p.badge, flash: p.flash, featured: p.featured, status: p.status,
      createdAt: new Date(p.created_at).getTime(),
    };
  });
}

/** Website settings in the legacy `settings` shape, assembled from the normalised tables. */
export async function legacySettings(db: Q): Promise<any> {
  const [content, globe, flash, ship, pay, origins] = await Promise.all([
    db.query(`SELECT value FROM site_content WHERE key = 'storefront'`),
    db.query(`SELECT * FROM globe_settings WHERE id = 1`),
    db.query(`SELECT * FROM flash_sale_rules WHERE id = 1`),
    db.query(`SELECT * FROM shipping_rates WHERE code = 'standard'`),
    db.query(`SELECT * FROM payment_settings`),
    db.query(`SELECT * FROM import_countries ORDER BY sort_order, code`),
  ]);
  const s: any = { ...(content.rows[0]?.value || {}) };
  const g = globe.rows[0], f = flash.rows[0], sh = ship.rows[0];
  const pm = Object.fromEntries(pay.rows.map(r => [r.method, r]));
  s.currency = s.currency || 'Rs.';
  s.heroTitle = g?.hero_title || ''; s.heroSubtitle = g?.hero_subtitle || '';
  s.globeCities = g?.cities || []; s.globeStats = g?.stats || []; s.globeSteps = g?.steps || [];
  s.flashTitle = f?.title || 'Flash Sale'; s.flashMode = f?.mode || 'daily';
  s.flashUntil = f?.ends_at ? new Date(f.ends_at).toISOString().slice(0, 16) : '';
  s.shippingFee = sh ? rs(sh.fee_cents) : 0; s.freeShipping = sh && sh.free_over_cents != null ? rs(sh.free_over_cents) : 0;
  s.payCOD = !!pm.cod?.enabled; s.payBank = !!pm.bank_transfer?.enabled; s.payOnline = !!pm.payhere?.enabled;
  s.bankDetails = pm.bank_transfer?.instructions || '';
  s.paymentMethods = [s.payCOD && 'Cash on Delivery', s.payBank && 'Bank Transfer', s.payOnline && 'Card (PayHere)'].filter(Boolean);
  const local = origins.rows.find(o => o.code === 'local');
  s.localDays = local?.days || '2–4';
  s.origins = origins.rows.filter(o => o.code !== 'local').map(o => ({ id: o.code, name: o.name, code: o.iso2 || '', label: o.label, days: o.days, on: o.enabled }));
  return s;
}

export async function legacyCategories(db: Q, includeHidden = false): Promise<any[]> {
  const r = await db.query(`SELECT c.slug, c.name, c.tagline, c.shape, c.icon_color, c.image_url, c.status, s.slug AS shop
    FROM categories c JOIN shops s ON s.id = c.shop_id ${includeHidden ? '' : `WHERE c.status = 'active'`} ORDER BY c.sort_order, c.name`);
  return r.rows.map(c => ({ id: c.slug, name: c.name, tagline: c.tagline, shape: c.shape, icon: c.icon_color, image: c.image_url || '', shop: c.shop, hidden: c.status !== 'active' }));
}

export async function legacyCollections(db: Q): Promise<any[]> {
  const r = await db.query(`SELECT co.slug, co.name, co.description, co.accent, co.image_url, co.home_row, co.manual_order,
      coalesce((SELECT json_agg(p.slug ORDER BY cp.sort_order, p.created_at DESC) FROM collection_products cp JOIN products p ON p.id = cp.product_id WHERE cp.collection_id = co.id), '[]') AS products
    FROM collections co ORDER BY co.sort_order, co.name`);
  return r.rows.map(c => ({ id: c.slug, name: c.name, description: c.description, accent: c.accent, image: c.image_url || '', homeRow: c.home_row,
    ...(c.manual_order ? { order: c.products } : {}) }));
}

export async function legacyBanners(db: Q, includeInactive = false): Promise<any[]> {
  const r = await db.query(`SELECT * FROM banners ${includeInactive ? '' : 'WHERE active'} ORDER BY sort_order, public_id`);
  return r.rows.map(h => ({ id: h.public_id, eyebrow: h.eyebrow, title: h.title, subtitle: h.subtitle, cta: h.cta, link: h.link, color: h.color, shape: h.shape, image: h.image_url || '' }));
}

export async function shops(db: Q): Promise<any[]> {
  const r = await db.query(`SELECT slug, name, status, sort_order FROM shops ORDER BY sort_order, name`);
  return r.rows.map(s => ({ id: s.slug, name: s.name, status: s.status }));
}

/** Everything the storefront needs to render, in the legacy `SCG` database shape. */
export async function storefrontSnapshot(db: Q): Promise<any> {
  const [settings, categories, collections, hero, products, shopList] = await Promise.all([
    legacySettings(db), legacyCategories(db), legacyCollections(db), legacyBanners(db), legacyProducts(db), shops(db),
  ]);
  return { version: 4, source: 'api', settings, categories, collections, hero, products, shops: shopList };
}
