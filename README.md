# Source Connect Global — Clothing Website + Admin Panel

A cinematic clothing storefront for **Source Connect Global**, with a separate admin panel.
It is plain HTML, CSS and JavaScript, so there is no build step and you can host it anywhere: Vercel, Netlify, GitHub Pages, cPanel and so on.

| URL | What |
|-----|------|
| `/` | Customer website (shop) |
| `/admin/` | Admin panel. Default login: **admin / admin123** (change it in *Settings*) |

## Storefront features
- **Cinematic intro**: letterbox bars, logo reveal, light flare and staggered 3D letters (plays once per session, can be skipped)
- **Header**: announcement marquee, sticky header that hides when you scroll down, **mega menus** for *Shop* (categories) and *Collections*, search overlay, cart, and a mobile drawer menu
- **Hero slider**: Ken Burns zoom, line-by-line headline reveal, an animated "connect" particle network, orbit rings, mouse parallax, swipe on mobile
- **8 categories × 12 products = 96 products** (T-Shirts, Shirts, Hoodies, Jackets, Jeans & Pants, Dresses, Shorts, Activewear)
- **5 collections** (Global Heritage, Urban Street, Summer 2026, Office Classic, Night Luxe) in a drag-to-scroll showcase
- Scroll reveals, 3D tilt and shine on cards, a parallax cinematic banner with film grain, animated counters and a custom cursor
- Shop pages with filters by category, collection and search, plus sorting
- Quick-view product modal with size and quantity, a cart drawer, and **Cash-on-Delivery checkout** (orders go to the admin panel)
- Responsive layout, and it respects `prefers-reduced-motion`

## Admin panel features
- Dashboard: stats, products per category (warns when a category has fewer than 10), recent orders, low stock
- **Products**: add, edit, duplicate and delete; photo upload (auto-resized); price and compare-at price, stock, sizes, colour, badge, collections, featured
- **Categories**, **Collections** (pick which products belong to each) and **Hero banners** (homepage slides)
- **Orders**: view and update status
- **Settings**: announcement text, contact details, WhatsApp, currency, admin login, JSON export and import, reset to demo data

## Important: data storage
Data is saved in the browser's **localStorage**. Changes you make in the admin panel show up on the website **in the same browser** right away. That works for demos and for a single person managing the shop. To go live with customers on many devices, connect a backend such as Supabase or Firebase so products and orders are shared. `js/store.js` is the only file that needs to change for that.

## Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000  and  http://localhost:8000/admin/
```

## Files
```
index.html        storefront
css/style.css     storefront styles & animations
js/store.js       shared data layer + seed products + garment illustrations
js/app.js         storefront logic
admin/            admin panel (index.html, admin.css, admin.js)
assets/           logo + favicon
```
