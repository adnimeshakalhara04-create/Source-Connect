import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, Slug, HexColor, SafeLink, ImageUrl, Text } from '../../lib/validate.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { requireStaff, actorOf } from '../../auth/staff.js';
import { audit } from '../../lib/audit.js';
import { tx } from '../../db/pool.js';
import * as cat from '../../catalog.js';

const T = (n: number) => Text(n);
const Money = z.number().min(0).max(10_000_000).transform(v => Math.round(v * 100));

// Presentation content (content.write)
const ContentKeys = {
  brand: T(80), announcement: T(400), currency: T(8), phone: T(40), email: T(120), address: T(200), whatsapp: z.string().regex(/^\d{0,15}$/),
  chinaDays: T(20), returnDays: z.number().int().min(0).max(90),
  welcome: z.object({ on: z.boolean(), mode: z.enum(['session', 'first', 'visit', 'off']), eyebrow: T(60), subtitle: T(200), button: T(40) }).strip(),
  navLinks: z.array(z.object({ label: T(40), link: SafeLink, hot: z.boolean().optional() }).strip()).max(20),
  sections: z.array(z.object({ id: z.string().max(30).regex(/^[a-z0-9-]+$/), name: T(120), on: z.boolean(), title: T(80).optional() }).strip()).max(30),
  services: z.array(z.object({ label: T(40), link: SafeLink, icon: z.string().max(20).regex(/^[a-z0-9-]+$/), color: HexColor }).strip()).max(16),
  sellerStats: z.array(z.object({ value: T(20), label: T(40) }).strip()).max(6),
  chinaSteps: z.array(z.object({ title: T(60), text: T(300) }).strip()).max(10),
  faq: z.array(z.object({ q: T(200), a: T(1500) }).strip()).max(40),
} as const;
const GlobeKeys = {
  heroTitle: T(120), heroSubtitle: T(400), globeCities: z.array(T(40)).max(60),
  globeStats: z.array(z.object({ value: T(20), label: T(40), live: z.boolean().optional() }).strip()).max(4),
  globeSteps: z.array(z.object({ title: T(30), text: T(40) }).strip()).max(6),
};
const FlashKeys = { flashTitle: T(40), flashMode: z.enum(['daily', 'until', 'off']), flashUntil: z.string().max(30) };
// Operational settings (settings.write)
const OpsKeys = {
  shippingFee: Money, freeShipping: Money, payCOD: z.boolean(), payBank: z.boolean(), payOnline: z.boolean(), bankDetails: T(500), localDays: T(20),
  origins: z.array(z.object({ id: Slug, name: T(60), code: z.string().max(2).default(''), label: T(40), days: T(20), on: z.boolean() }).strip()).max(30),
};
const SettingsInput = z.object({
  ...Object.fromEntries(Object.entries({ ...ContentKeys, ...GlobeKeys, ...FlashKeys, ...OpsKeys }).map(([k, v]) => [k, (v as z.ZodType).optional()])),
}).strip();   // unknown/legacy keys such as adminUser/adminPassHash are dropped, never stored

export default async function adminContent(app: FastifyInstance) {
  const db = app.db;

  app.put('/settings', { preHandler: requireStaff(db), schema: { tags: ['admin-content'], summary: 'Partial update of website settings (legacy settings shape)' } }, async (req) => {
    const b = parse(SettingsInput, req.body) as Record<string, any>;
    const has = (keys: object) => Object.keys(keys).some(k => b[k] !== undefined);
    const perms = req.staff!.permissions;
    if ((has(ContentKeys) || has(GlobeKeys) || has(FlashKeys)) && !perms.has('content.write')) throw forbidden('You cannot edit website content.');
    if (has(OpsKeys) && !perms.has('settings.write')) throw forbidden('You cannot change fees, payments or import countries.');
    if (b.payOnline === true && (!app.config.PAYHERE_MERCHANT_ID || !app.config.PAYHERE_MERCHANT_SECRET)) throw badRequest('PayHere is not configured on the server yet (merchant ID and secret).');
    if (b.payCOD === false && b.payBank === false && b.payOnline !== true) throw badRequest('Keep at least one payment method switched on.');
    const before = await cat.legacySettings(db);
    await tx(db, async c => {
      const content: Record<string, unknown> = {};
      for (const k of Object.keys(ContentKeys)) if (b[k] !== undefined) content[k] = b[k];
      if (Object.keys(content).length)
        await c.query(`INSERT INTO site_content (key, value, updated_by) VALUES ('storefront', $1, $2) ON CONFLICT (key) DO UPDATE SET value = site_content.value || $1, updated_at = now(), updated_by = $2`, [JSON.stringify(content), req.staff!.id]);
      if (has(GlobeKeys)) await c.query(`UPDATE globe_settings SET hero_title = coalesce($1, hero_title), hero_subtitle = coalesce($2, hero_subtitle), cities = coalesce($3, cities),
          stats = coalesce($4, stats), steps = coalesce($5, steps), updated_at = now() WHERE id = 1`,
        [b.heroTitle ?? null, b.heroSubtitle ?? null, b.globeCities ?? null, b.globeStats ? JSON.stringify(b.globeStats) : null, b.globeSteps ? JSON.stringify(b.globeSteps) : null]);
      if (has(FlashKeys)) {
        const mode = b.flashMode;
        let ends: string | null = null;
        if (mode === 'until' || (b.flashUntil && mode === undefined)) {
          const d = new Date(b.flashUntil + (/[zZ]|[+-]\d\d:?\d\d$/.test(b.flashUntil) ? '' : '+05:30'));   // admin types Sri Lanka time
          if (isNaN(d.getTime())) throw badRequest('Choose a valid end date for the flash sale.');
          ends = d.toISOString();
        }
        await c.query(`UPDATE flash_sale_rules SET title = coalesce($1, title), mode = coalesce($2, mode), ends_at = CASE WHEN coalesce($2, mode) = 'until' THEN coalesce($3::timestamptz, ends_at) ELSE NULL END, updated_at = now() WHERE id = 1`,
          [b.flashTitle ?? null, mode ?? null, ends]);
      }
      if (b.shippingFee !== undefined || b.freeShipping !== undefined)
        await c.query(`UPDATE shipping_rates SET fee_cents = coalesce($1, fee_cents), free_over_cents = CASE WHEN $2::bigint IS NULL THEN free_over_cents WHEN $2::bigint = 0 THEN NULL ELSE $2::bigint END, updated_at = now() WHERE code = 'standard'`,
          [b.shippingFee ?? null, b.freeShipping ?? null]);
      for (const [key, method] of [['payCOD', 'cod'], ['payBank', 'bank_transfer'], ['payOnline', 'payhere']] as const)
        if (b[key] !== undefined) await c.query(`UPDATE payment_settings SET enabled = $2, updated_at = now() WHERE method = $1`, [method, b[key]]);
      if (b.bankDetails !== undefined) await c.query(`UPDATE payment_settings SET instructions = $1, updated_at = now() WHERE method = 'bank_transfer'`, [b.bankDetails]);
      if (b.localDays !== undefined) await c.query(`UPDATE import_countries SET days = $1 WHERE code = 'local'`, [b.localDays]);
      if (b.origins) for (const [i, o] of (b.origins as any[]).entries()) {
        if (o.id === 'local') continue;
        await c.query(`INSERT INTO import_countries (code, name, iso2, label, days, enabled, sort_order) VALUES ($1,$2,nullif($3,''),$4,$5,$6,$7)
          ON CONFLICT (code) DO UPDATE SET name=$2, iso2=nullif($3,''), label=$4, days=$5, enabled=$6, sort_order=$7, updated_at = now()`, [o.id, o.name, o.code, o.label, o.days, o.on, i + 1]);
      }
      const ok = await c.query(`SELECT count(*)::int n FROM payment_settings WHERE enabled`);
      if (!ok.rows[0].n) throw badRequest('Keep at least one payment method switched on.');
      await audit(c, actorOf(req), 'settings.update', 'settings', null, Object.fromEntries(Object.keys(b).map(k => [k, before[k]])), b);
    });
    return cat.legacySettings(db);
  });

  const Banner = z.object({
    id: z.string().max(40).regex(/^[A-Za-z0-9_-]+$/), eyebrow: T(40).default(''), title: T(60).default(''), subtitle: T(120).default(''), cta: T(30).default(''),
    link: SafeLink.default('#'), color: HexColor.default('#0b2a6f'), shape: z.string().max(30).regex(/^[a-z0-9-]+$/).default('tshirt'), image: ImageUrl.or(z.literal('')).default(''),
  }).strip();
  // Banners are a short ordered list: the admin sends the whole list.
  app.put('/banners', { preHandler: requireStaff(db, 'content.write'), schema: { tags: ['admin-content'] } }, async (req) => {
    const list = parse(z.array(Banner).max(20), req.body);
    if (new Set(list.map(b => b.id)).size !== list.length) throw badRequest('Two banners have the same id.');
    const before = await cat.legacyBanners(db, true);
    await tx(db, async c => {
      await c.query(`DELETE FROM banners WHERE NOT (public_id = ANY($1))`, [list.map(b => b.id)]);
      for (const [i, h] of list.entries())
        await c.query(`INSERT INTO banners (public_id, sort_order, eyebrow, title, subtitle, cta, link, color, shape, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,nullif($10,''))
          ON CONFLICT (public_id) DO UPDATE SET sort_order=$2, eyebrow=$3, title=$4, subtitle=$5, cta=$6, link=$7, color=$8, shape=$9, image_url=nullif($10,''), updated_at = now()`,
          [h.id, i, h.eyebrow, h.title, h.subtitle, h.cta, h.link, h.color, h.shape, h.image]);
      await audit(c, actorOf(req), 'banners.update', 'banners', null, before, list);
    });
    return cat.legacyBanners(db, true);
  });
}
