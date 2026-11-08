import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadLegacySeed, SHOPS, skuFor, splitStock } from './legacy-catalog.js';

const toCents = (rs: number) => Math.round(Number(rs) * 100);
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Seeds an EMPTY database with the curated catalogue and website content.
 * Refuses to run when products already exist, so it can never overwrite live data.
 * Ratings, review counts and "sold" counters are seeded as 0: no invented social proof.
 * No staff account is created here (use `npm run create-owner`), so no default password exists.
 */
export async function seed(url: string, log: (m: string) => void = () => {}): Promise<{ products: number; variants: number } | 'skipped'> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const has = await c.query('SELECT 1 FROM products LIMIT 1');
    if (has.rowCount) { log('catalogue already present, seed skipped'); return 'skipped'; }
    const d = loadLegacySeed();
    const s = d.settings;
    await c.query('BEGIN');

    // import countries
    for (const [i, o] of (s.origins as any[]).entries()) {
      await c.query(`INSERT INTO import_countries (code, name, iso2, label, days, enabled, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`, [o.id, o.name, o.code, o.label, o.days, o.on !== false, i + 1]);
    }
    await c.query(`UPDATE import_countries SET days = $1 WHERE code = 'local'`, [s.localDays || '2–4']);

    // shops + categories
    const shopId = new Map<string, string>(), catShop = new Map<string, string>();
    for (const [i, sh] of SHOPS.entries()) {
      const r = await c.query('INSERT INTO shops (slug, name, sort_order) VALUES ($1,$2,$3) RETURNING id', [sh.slug, sh.name, i]);
      shopId.set(sh.slug, r.rows[0].id);
      sh.categories.forEach(cat => catShop.set(cat, r.rows[0].id));
    }
    const catId = new Map<string, string>();
    for (const [i, cat] of (d.categories as any[]).entries()) {
      const sid = catShop.get(cat.id) || shopId.get('clothing')!;
      const r = await c.query(`INSERT INTO categories (slug, shop_id, name, tagline, shape, icon_color, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [cat.id, sid, cat.name, cat.tagline || '', cat.shape || 'tshirt', HEX.test(cat.icon) ? cat.icon : '#0b2a6f', i]);
      catId.set(cat.id, r.rows[0].id);
    }

    // collections
    const colId = new Map<string, string>();
    for (const [i, col] of (d.collections as any[]).entries()) {
      const r = await c.query(`INSERT INTO collections (slug, name, description, accent, home_row, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [col.id, col.name, col.description || '', HEX.test(col.accent) ? col.accent : '#0b2a6f', !!col.homeRow, i]);
      colId.set(col.id, r.rows[0].id);
    }

    // products, variants, inventory
    let variants = 0;
    for (const p of d.products as any[]) {
      const r = await c.query(`INSERT INTO products (slug, shop_id, category_id, name, brand, description, origin_code, badge, featured, flash,
          price_cents, compare_price_cents, visual, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, to_timestamp($14 / 1000.0)) RETURNING id`,
        [p.id, catShop.get(p.category), catId.get(p.category), p.name, p.brand || '', p.description || '', p.origin, p.badge || '', !!p.featured, !!p.flash,
          toCents(p.price), toCents(p.comparePrice || 0), JSON.stringify({ shape: p.shape, pattern: p.pattern, color: p.color, accent: p.accent }), p.createdAt || Date.now()]);
      const pid = r.rows[0].id;
      const sizes: string[] = p.sizes && p.sizes.length ? p.sizes : [''];
      const stock = splitStock(Number(p.stock) || 0, sizes.length);
      for (const [i, size] of sizes.entries()) {
        const v = await c.query(`INSERT INTO product_variants (product_id, sku, size, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`, [pid, skuFor(p.id, size), size, i]);
        await c.query(`INSERT INTO inventory (variant_id, on_hand) VALUES ($1,$2)`, [v.rows[0].id, stock[i]]);
        if (stock[i]) await c.query(`INSERT INTO inventory_movements (variant_id, delta_on_hand, reason, note) VALUES ($1,$2,'seed','initial catalogue')`, [v.rows[0].id, stock[i]]);
        variants++;
      }
      for (const [i, slug] of (p.collections || []).entries()) {
        if (colId.has(slug)) await c.query('INSERT INTO collection_products (collection_id, product_id, sort_order) VALUES ($1,$2,$3)', [colId.get(slug), pid, i]);
      }
    }

    // banners
    for (const [i, h] of (d.hero as any[]).entries()) {
      await c.query(`INSERT INTO banners (public_id, sort_order, eyebrow, title, subtitle, cta, link, color, shape) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [h.id, i, h.eyebrow || '', h.title || '', h.subtitle || '', h.cta || '', h.link || '#', HEX.test(h.color) ? h.color : '#0b2a6f', h.shape || 'tshirt']);
    }

    // globe, flash, shipping, payments
    await c.query(`UPDATE globe_settings SET cities=$1, stats=$2, steps=$3, hero_title=$4, hero_subtitle=$5 WHERE id=1`,
      [s.globeCities, JSON.stringify(s.globeStats), JSON.stringify(s.globeSteps), s.heroTitle, s.heroSubtitle]);
    await c.query(`UPDATE flash_sale_rules SET title=$1, mode=$2 WHERE id=1`, [s.flashTitle || 'Flash Sale', s.flashMode === 'until' ? 'daily' : (s.flashMode || 'daily')]);
    await c.query(`UPDATE shipping_rates SET fee_cents=$1, free_over_cents=$2 WHERE code='standard'`, [toCents(s.shippingFee), s.freeShipping ? toCents(s.freeShipping) : null]);
    await c.query(`UPDATE payment_settings SET instructions=$1 WHERE method='bank_transfer'`, [s.bankDetails || '']);

    // presentation content the admin edits (never secrets or login data)
    const content = {
      brand: s.brand, announcement: s.announcement, currency: 'Rs.', phone: s.phone, email: s.email, address: s.address, whatsapp: s.whatsapp,
      chinaDays: s.chinaDays, returnDays: s.returnDays, welcome: s.welcome, navLinks: s.navLinks, sections: s.sections, services: s.services,
      sellerStats: [], chinaSteps: s.chinaSteps, faq: s.faq,
    };
    await c.query(`INSERT INTO site_content (key, value) VALUES ('storefront', $1)`, [JSON.stringify(content)]);

    await c.query('COMMIT');
    log(`seeded ${d.products.length} products, ${variants} variants, ${d.categories.length} categories, ${d.collections.length} collections`);
    return { products: d.products.length, variants };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  seed(url, m => console.log(m)).catch(e => { console.error(e.message); process.exit(1); });
}
