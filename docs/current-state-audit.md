# Current-state audit — Source Connect Global

Audited on 2026-11-08 at commit `281da72` (branch `claude/meka-admin-panel-website-gu6dxg`, which GitHub Pages also serves from `gh-pages`).
The full-stack work happens on `claude/fullstack-backend`. The live static site is left untouched until the owner approves a release.

## 1. What the project is today

Plain HTML/CSS/JavaScript with no build step and no server.

| File | Lines | Role |
|---|---|---|
| `index.html` | — | Storefront shell; inline script decides whether the welcome intro plays |
| `js/store.js` | 546 | `window.SCG`: the whole "database" (seed data, `load()/save()` to localStorage, cart, orders, profile, SVG product illustrations, image compression) |
| `js/app.js` | 837 | Storefront router and pages (home, listing, product, cart, checkout, account, tracking, help) |
| `js/globe.js`, `js/globe-data.js` | 296 + data | Canvas globe animation (Natural Earth land dots) |
| `js/intro.js` | 87 | Cinematic welcome intro |
| `admin/index.html`, `admin/admin.js`, `admin/admin.css` | 1,280 JS | Seller Center: every editor, live preview and visual editor |
| `assets/` | — | Logo, favicon, intro images |

There are no automated tests in the repository; the Playwright audit scripts used during development lived outside it. There is no CI workflow, `package.json` or server code.

### Storefront routes (hash based)
`#` home · `#shop` · `#c/<category>` · `#col/<collection>` · `#from/<country>` · `#flash` · `#search/<q>` · `#p/<productId>` · `#cart` · `#checkout` · `#account` · `#track/<orderId>` · `#wish` · `#china-direct` · `#help`. `?preview=1` puts the site in admin-preview mode, and `?intro=1` replays the intro.

### Admin views
Visual Editor, Dashboard, Orders (and order detail), Customers, Products (and form), Flash Sale, Categories, Import Countries, Collections (and workspace), Homepage & Globe, Promo Banners, Header & Footer, Importing Page & FAQ, Store Settings.

## 2. Data storage (all in the visitor's own browser)

| localStorage key | Contents | Problem |
|---|---|---|
| `scg_db_v2` | Whole catalogue and settings: `settings`, `categories[12]`, `products[144]`, `collections[7]`, `hero[]` (banners), origins, flash and homepage config, **admin username and password hash** | Each browser has its own copy. Admin edits never reach customers on other devices |
| `scg_orders_v1` | Orders placed in this browser | Orders never reach the shop owner |
| `scg_cart_v2`, `scg_wish_v1` | Cart and wishlist | Acceptable as a UI cache |
| `scg_profile_v1` | "Customer account" made from checkout details | No identity verification. Anyone using the browser is "the customer" |
| `scg_admin_on`, `scg_admin_session` (sessionStorage), `scg_edit_mode` | Admin login flags | Anyone can set these in DevTools |
| `scg_intro_seen`, `scg_pv_*` | UI preferences | Fine to keep |

**Product shape** (`js/store.js` `seedProducts`): `id, name, category, shape, pattern, brand, collections[], price, comparePrice, color, accent, image, images[≤8 data-URLs], sizes[], stock, sold, rating, reviews, origin, badge, flash, featured, description, createdAt`. There are no variants: sizes are a list on the product, and stock is one number per product.

**Order shape**: `id ('SCG' + 7 digits of Date.now), date, status, payment, customer{name, phone, email, address, note, profileId}, items[{id, name, size, color, qty, price, origin}], subtotal, shipping, total`.

## 3. Security findings

| # | Finding | Severity |
|---|---|---|
| S1 | **Admin login is browser-only.** `admin/admin.js` compares a SHA-256 hash stored in localStorage, or falls back to `admin123`. Anyone can open DevTools and set `sessionStorage.scg_admin_session='1'`, or edit `scg_db_v2` directly. There is no server to enforce anything | Critical |
| S2 | Default credentials `admin / admin123` are shown on the login page | Critical |
| S3 | Prices, discounts, shipping and totals are calculated in the browser. A customer can change them | Critical (once real payments exist) |
| S4 | No stock reservation and no concurrency control. Two browsers can both "buy" the last item | High |
| S5 | Order tracking takes only the order number, which is sequential and guessable. Today only the same browser's orders are visible, but a server version must not repeat this | High |
| S6 | Unsalted-equivalent fast hash (SHA-256 with a salt in the same storage) instead of a slow password hash | High |
| S7 | Product images are stored as base64 data-URLs in localStorage (about a 5 MB limit; slow) | Medium |
| S8 | XSS hardening was done on 2026-11-08 (escaping, safe image src, colour validation), but there is no Content-Security-Policy | Medium |
| S9 | "Sign in with Google" is shown as coming soon. Good: it is not a fake login | Info |

## 4. Functional gaps vs. a real shop

- No backend, database, API or server-side validation.
- No payment gateway. "Bank Transfer" and "Cash on Delivery" are labels only, with no verification workflow.
- No staff accounts, roles or audit history. There is one shared admin login.
- No product variants or per-size stock.
- No shipment records, carrier or tracking numbers. Status is a single string.
- No coupons. Flash sale is a per-product boolean plus a global timer.
- No backups. Clearing browser data deletes everything.
- Dashboard numbers, customers and orders come from the admin's own browser only.

## 5. What works and must be preserved

Design and branding, cinematic intro, globe hero and its country tour, the marketplace layout, flash sale countdown, filters and sorting, product page gallery, cart stock caps, checkout UX, My Account, tracking timeline, mobile bottom nav, all admin editors, the live preview with click-to-edit (`postMessage` between the iframe and the admin), the drag split and the accessibility labels. On 2026-11-08 Playwright audits passed: 63 storefront routes × 5 widths, all admin views and modals × 3 widths, XSS, empty catalogue, storage blocked and form validation.

## 6. Migration risks

1. `js/app.js` and `admin/admin.js` call `SCG.load()` and `SCG.save()` **synchronously** in about 200 places. The plan is to keep that interface as a cache: the cache is filled from the API before the app starts (`SCG.ready`), and `SCG.save()` turns cache changes into validated API calls (see `docs/architecture.md`). This avoids rewriting both apps.
2. Existing browser data cannot be trusted. Only the curated catalogue (categories, products, collections, banners, content) is imported, and only through the authenticated admin import endpoint. **Browser orders, "paid" flags, profiles and admin credentials are never imported.**
3. Per-product stock has to be split into per-variant stock. The seed puts the product's stock on its first variant and 0 on the others, so the total stays the same. Staff can then redistribute it in the new per-size stock editor.
4. Images: data-URLs move to object storage. The local/dev driver writes to disk, and production uses an S3-compatible bucket served by a CDN.
5. The static site must keep working when no API is configured (offline demo mode), so GitHub Pages keeps working during the transition.
