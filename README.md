# Source Connect Global — Marketplace Website + Admin Panel

A marketplace-style fashion store for **Source Connect Global**: products sourced in China and delivered across Sri Lanka. It is plain HTML, CSS and JavaScript with no build step and no external libraries, so it runs on GitHub Pages or any static host.

| URL | What |
|-----|------|
| `/` | Customer website |
| `/admin/` | Admin panel. Default login: **admin / admin123** (change it in *Settings*) |

## Storefront
- **Cinematic welcome intro** when the site opens: letterbox bars, the SC emblem (from the logo) flies in with a light sweep, glowing rings and orbiting stars over the globe, then “Welcome to”, the Global Source Connect wordmark, the import-country route and an **Enter the Store** button. Plays once per visit by default; Skip / Esc / Enter close it; static for reduced-motion users. Admin → Homepage & Globe → *Welcome intro* (on/off, how often, texts, ▶ Preview). Add `?intro=1` to the address to replay it.
- **Cinematic globe hero**: a dotted 3D globe tours each import country in turn (China, USA, Australia, UK, UAE, Japan, and optionally India and Germany) and shows ships and planes flying from its cities to Colombo. A 5-step timeline follows each shipment, arrival notices pop up, and you can drag the globe to spin it.
- Marketplace layout: utility bar, search with live suggestions, category menu, quick-service icons, **Flash Sale** with a live countdown and "sold" bars, category grid, promo banners, product rails, and an infinite-scroll **Just For You** feed
- **12 categories × 12 = 144 products**: Men's, Women's, Kids, Shoes, Bags & Wallets, Watches, Accessories, Sportswear, Office Wear, Winter & Jackets, **Electronics & Gadgets** and **Mobile & Accessories**. Each has an illustration (37 styles) until you upload real photos; products can have up to 8 photos
- **Shop by Country** section and a page per import country (`#from/usa`), with per-country delivery times on every product
- Listing pages with filters (category, price, rating, shipped from China or Colombo, discount) and sorting
- Product page: colour variants, sizes, quantity, hover zoom, delivery panel (China Direct 10–14 days or Colombo 2–4 days), specifications, ratings breakdown, related products
- Cart with select / delete, free-delivery threshold, checkout with all 25 districts, Cash on Delivery or bank transfer
- **Customer accounts without a sign-up form**: the first order's checkout details (name, phone, email, address) automatically become the customer's profile. Next time checkout is pre-filled; **My Account** shows their orders with progress, Buy again, editable details and sign out. “Sign in with Google” is shown as coming soon (needs a backend)
- Order tracking, wishlist, a "How China Direct works" page with FAQ, and a mobile bottom navigation bar

## Admin panel (Seller Center)
**Visual Editor (easiest way to edit):** the admin shows your real website in a live preview (computer or phone view). Point at anything (a product, banner, category, the globe headline, menu or footer) and click **✎ Edit** to open its editor, or **🖼 Change photo** to pick a new picture. Saved changes appear in the preview instantly. The same live preview sits beside the Homepage, Banners, Header, Flash Sale, Categories, Collections, Import Countries and Importing Page screens, and editors open beside it so the website stays visible.

Every part of the website can be changed from `/admin/`:

| Admin screen | Controls on the website |
|---|---|
| Dashboard | Revenue, 7-day sales chart, orders by status, top sellers, low stock |
| Orders | Status tabs, search, order details, WhatsApp / call customer, status updates shown on Track My Order |
| Customers | Everyone who ordered, total spent, order history |
| Products | Up to 8 photos each (upload or image link, compressed automatically); add / edit / copy / delete; inline price, stock, ships-from and flash toggle; bulk discount, flash, collection, delete |
| Flash Sale | Title, daily / end-date / off timing, flash prices, add products, apply % to all |
| Categories | Name, tagline, icon picture and colour, order in menus |
| Import Countries | Countries on/off, product label, delivery days, which cities ship on the globe (with live preview) |
| Collections | Open a collection to work inside it: add existing products, create new ones there, quick-fill by rule (category, country, price, discount), drag to reorder, inline price/stock, bulk discount / flash / ships-from, show in header menu or as a homepage row |
| Homepage & Globe | Globe headline and text, which Chinese cities ship, numbers, timeline steps, section on/off + order + titles, service icons (with live globe preview) |
| Promo Banners | Banners beside the globe and wide banners below the categories |
| Header & Footer | Announcement bar, header menu links, footer payment methods |
| China Direct & FAQ | “How it works” steps and questions & answers |
| Store Settings | Contact details, delivery days and fees, payment options and bank details, seller rating, admin login, backup |

**Edit bar on the website:** while you are signed in to the admin panel, the website shows an ADMIN bar with “Edit this collection / product / homepage” shortcuts. Log out hides it.

## Status
**Branch `claude/fullstack-backend`** adds a real backend: PostgreSQL database, secure staff login with roles, server-side prices and stock, PayHere (sandbox), Cash on Delivery and bank-transfer workflows, customer accounts, encrypted off-site backups with tested restores, and VPS deployment scripts. The design is unchanged.
See **`docs/IMPLEMENTATION-REPORT.md`** (what is done, tested and still needs the owner) and **`docs/OWNER-GUIDE-SINHALA.md`** (owner guide in Sinhala).

The GitHub Pages site still runs the offline demo (no API configured), so it is **not** for real orders until the launch checklist in `docs/release-checklist.md` is signed off.

## Data storage
- **With the API** (`js/config.js` → `PRODUCTION_API`): everything is in PostgreSQL through `server/` (see `docs/architecture.md`). The browser keeps only the cart, wishlist and UI preferences.
- **Without the API** (demo): data stays in the visitor's browser (localStorage), as before.

## Run locally
```bash
# website only (offline demo)
python3 -m http.server 8000            # http://localhost:8000  and  /admin/

# with the real backend
server/scripts/dev-db.sh start         # local PostgreSQL 16 on port 5433
cd server && npm ci
export DATABASE_URL=postgres://postgres@127.0.0.1:5433/sc_dev
npm run migrate && npm run seed && npm run create-owner -- --username owner --name "Shop Owner"
cp .env.example .env                    # adjust for development (see the file)
npm run dev                             # API on http://127.0.0.1:8080, docs at /docs
# open http://localhost:8000/?api=http://127.0.0.1:8080 and /admin/?api=http://127.0.0.1:8080
npm test                                # 69 API tests on a fresh database
```

## Files
```
server/             API (TypeScript/Fastify), migrations, tests, Dockerfile
infra/              backups (pgBackRest), deploy (VPS, Caddy, compose), monitoring
docs/               audit, architecture, ERD, runbooks, checklists, Sinhala owner guide, evidence
e2e/                browser end-to-end, load test, baseline screenshots, demo-mode audits
js/config.js        API address (empty = offline demo)
js/api.js           connection between the original UI and the API
index.html          storefront shell
css/style.css       storefront styles
js/store.js         data layer, 120 seed products, product illustrations
js/globe.js         canvas globe animation (China → Sri Lanka)
js/globe-data.js    land dots and borders generated from Natural Earth (public domain)
js/app.js           storefront pages and router
admin/              admin panel
assets/             logo and favicon
```
