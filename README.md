# Source Connect Global — Marketplace Website + Admin Panel

A marketplace-style fashion store for **Source Connect Global**: products sourced in China and delivered across Sri Lanka. It is plain HTML, CSS and JavaScript with no build step and no external libraries, so it runs on GitHub Pages or any static host.

| URL | What |
|-----|------|
| `/` | Customer website |
| `/admin/` | Admin panel. Default login: **admin / admin123** (change it in *Settings*) |

## Storefront
- **Cinematic globe hero**: a dotted 3D globe tours each import country in turn (China, USA, Australia, UK, UAE, Japan, and optionally India and Germany) and shows ships and planes flying from its cities to Colombo. A 5-step timeline follows each shipment, arrival notices pop up, and you can drag the globe to spin it.
- Marketplace layout: utility bar, search with live suggestions, category menu, quick-service icons, **Flash Sale** with a live countdown and "sold" bars, category grid, promo banners, product rails, and an infinite-scroll **Just For You** feed
- **12 categories × 12 = 144 products**: Men's, Women's, Kids, Shoes, Bags & Wallets, Watches, Accessories, Sportswear, Office Wear, Winter & Jackets, **Electronics & Gadgets** and **Mobile & Accessories**. Each has an illustration (37 styles) until you upload real photos; products can have up to 8 photos
- **Shop by Country** section and a page per import country (`#from/usa`), with per-country delivery times on every product
- Listing pages with filters (category, price, rating, shipped from China or Colombo, discount) and sorting
- Product page: colour variants, sizes, quantity, hover zoom, delivery panel (China Direct 10–14 days or Colombo 2–4 days), specifications, ratings breakdown, related products
- Cart with select / delete, free-delivery threshold, checkout with all 25 districts, Cash on Delivery or bank transfer
- Order tracking, wishlist, a "How China Direct works" page with FAQ, and a mobile bottom navigation bar

## Admin panel (Seller Center)
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
| Collections | China Direct, Electronics, Global Imports, New Arrivals… and which products are in them |
| Homepage & Globe | Globe headline and text, which Chinese cities ship, numbers, timeline steps, section on/off + order + titles, service icons (with live globe preview) |
| Promo Banners | Banners beside the globe and wide banners below the categories |
| Header & Footer | Announcement bar, header menu links, footer payment methods |
| China Direct & FAQ | “How it works” steps and questions & answers |
| Store Settings | Contact details, delivery days and fees, payment options and bank details, seller rating, admin login, backup |

## Data storage
Data is saved in the browser's **localStorage**. Admin changes show up on the website in the same browser only. For a live shop where customers on many devices see the same products and their orders reach you, connect a backend such as Supabase or Firebase. `js/store.js` is the only file that needs to change.

## Run locally
```bash
python3 -m http.server 8000
# http://localhost:8000  and  http://localhost:8000/admin/
```

## Files
```
index.html          storefront shell
css/style.css       storefront styles
js/store.js         data layer, 120 seed products, product illustrations
js/globe.js         canvas globe animation (China → Sri Lanka)
js/globe-data.js    land dots and borders generated from Natural Earth (public domain)
js/app.js           storefront pages and router
admin/              admin panel
assets/             logo and favicon
```
