/* =========================================================
   Source Connect Global — shared data store
   Used by both the storefront (/index.html) and the admin
   panel (/admin/). Data lives in localStorage so the admin
   panel updates the shop instantly in the same browser.
   ========================================================= */
(function (global) {
  'use strict';

  var DB_KEY = 'scg_db_v1';
  var ORDERS_KEY = 'scg_orders_v1';
  var CART_KEY = 'scg_cart_v1';

  /* ---------- Garment silhouettes (SVG paths, viewBox 0 0 200 200) ---------- */
  var SHAPES = {
    tshirt: {
      body: 'M62 38 L86 28 Q100 44 114 28 L138 38 L172 68 L152 92 L140 82 L140 172 L60 172 L60 82 L48 92 L28 68 Z',
      detail: 'M86 28 Q100 50 114 28'
    },
    shirt: {
      body: 'M62 36 L84 26 L100 44 L116 26 L138 36 L174 104 L154 112 L140 84 L140 174 L60 174 L60 84 L46 112 L26 104 Z',
      detail: 'M84 26 L92 50 L100 44 L108 50 L116 26 M100 44 L100 174 M96 62 h8 M96 84 h8 M96 106 h8 M96 128 h8 M96 150 h8'
    },
    hoodie: {
      body: 'M64 44 Q70 14 100 14 Q130 14 136 44 L146 48 L176 118 L156 126 L140 92 L142 176 L58 176 L60 92 L44 126 L24 118 L54 48 Z',
      detail: 'M78 46 Q100 70 122 46 M92 58 L90 90 M108 58 L110 90 M74 130 h52 v26 h-52 Z'
    },
    jacket: {
      body: 'M60 36 L84 24 L100 40 L116 24 L140 36 L176 118 L156 126 L142 90 L142 176 L58 176 L58 90 L44 126 L24 118 Z',
      detail: 'M84 24 L94 64 L100 40 L106 64 L116 24 M100 40 L100 176 M68 120 h20 M112 120 h20'
    },
    jeans: {
      body: 'M64 26 L136 26 L148 176 L110 176 L100 84 L90 176 L52 176 Z',
      detail: 'M64 40 L136 40 M100 40 L100 84 M70 40 Q76 60 92 56 M130 40 Q124 60 108 56'
    },
    dress: {
      body: 'M82 22 L92 22 Q100 34 108 22 L118 22 L120 70 L156 178 L44 178 L80 70 Z',
      detail: 'M80 70 Q100 78 120 70'
    },
    shorts: {
      body: 'M58 50 L142 50 L154 136 L110 140 L100 96 L90 140 L46 136 Z',
      detail: 'M58 62 L142 62 M100 62 L100 96'
    },
    activewear: {
      body: 'M74 26 L88 26 Q100 50 112 26 L126 26 L128 68 Q138 120 136 174 L64 174 Q62 120 72 68 Z',
      detail: 'M72 96 Q100 104 128 96'
    },
    cap: {
      body: 'M40 120 Q40 50 100 50 Q160 50 160 120 Z M40 120 L186 120 Q180 136 150 134 L40 130 Z',
      detail: 'M100 50 L100 120 M70 58 Q66 90 66 120 M130 58 Q134 90 134 120'
    },
    bag: {
      body: 'M44 74 L156 74 L166 176 L34 176 Z',
      detail: 'M74 74 Q74 30 100 30 Q126 30 126 74'
    }
  };

  function shade(hex, amt) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(function (x) { return x + x; }).join('');
    var n = parseInt(c, 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /** Returns an SVG string of a stylised garment. */
  function garmentSVG(shape, color) {
    var s = SHAPES[shape] || SHAPES.tshirt;
    var id = 'g' + Math.random().toString(36).slice(2, 8);
    var light = shade(color, 46), dark = shade(color, -52);
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="garment" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + light + '"/><stop offset=".55" stop-color="' + color + '"/>' +
      '<stop offset="1" stop-color="' + dark + '"/></linearGradient></defs>' +
      '<ellipse cx="100" cy="188" rx="62" ry="6" fill="rgba(0,0,0,.18)"/>' +
      '<path d="' + s.body + '" fill="url(#' + id + ')" stroke="' + dark + '" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="' + s.detail + '" fill="none" stroke="' + dark + '" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* ---------- Seed data ---------- */
  var CATEGORIES = [
    { id: 'tshirts', name: 'T-Shirts', shape: 'tshirt', tagline: 'Everyday essentials, premium cotton' },
    { id: 'shirts', name: 'Shirts', shape: 'shirt', tagline: 'Tailored for every occasion' },
    { id: 'hoodies', name: 'Hoodies', shape: 'hoodie', tagline: 'Comfort meets street culture' },
    { id: 'jackets', name: 'Jackets', shape: 'jacket', tagline: 'Layer up in style' },
    { id: 'jeans', name: 'Jeans & Pants', shape: 'jeans', tagline: 'Perfect fit denim & chinos' },
    { id: 'dresses', name: 'Dresses', shape: 'dress', tagline: 'Elegance in every thread' },
    { id: 'shorts', name: 'Shorts', shape: 'shorts', tagline: 'Built for warm days' },
    { id: 'activewear', name: 'Activewear', shape: 'activewear', tagline: 'Move without limits' }
  ];

  var COLLECTIONS = [
    { id: 'global-heritage', name: 'Global Heritage', description: 'Timeless pieces inspired by cultures around the world.', accent: '#0b2a6f' },
    { id: 'urban-street', name: 'Urban Street', description: 'Bold streetwear for the city that never sleeps.', accent: '#d7141a' },
    { id: 'summer-2026', name: 'Summer 2026', description: 'Light fabrics, bright colours, endless sunshine.', accent: '#f2a20c' },
    { id: 'office-classic', name: 'Office Classic', description: 'Sharp, refined workwear that means business.', accent: '#1d3557' },
    { id: 'night-luxe', name: 'Night Luxe', description: 'After-dark statements with a cinematic edge.', accent: '#6d28d9' }
  ];

  var NAMES = {
    tshirts: ['Classic Crew Tee', 'Global Logo Tee', 'Oversized Street Tee', 'Pocket Cotton Tee', 'V-Neck Essential', 'Vintage Wash Tee', 'Stars & Stripe Tee', 'Heavyweight Box Tee', 'Slim Fit Tee', 'Graphic World Tee', 'Raglan Contrast Tee', 'Organic Basic Tee'],
    shirts: ['Oxford Button-Down', 'Linen Summer Shirt', 'Slim Formal Shirt', 'Denim Western Shirt', 'Flannel Check Shirt', 'Cuban Collar Shirt', 'Mandarin Collar Shirt', 'Striped Office Shirt', 'Satin Evening Shirt', 'Chambray Work Shirt', 'Printed Resort Shirt', 'Poplin Classic Shirt'],
    hoodies: ['Global Pullover Hoodie', 'Zip-Up Fleece Hoodie', 'Oversized Street Hoodie', 'Tech Fleece Hoodie', 'Heritage Logo Hoodie', 'Cropped Hoodie', 'Heavyweight Hoodie', 'Tie-Dye Hoodie', 'Varsity Hoodie', 'Essential Hoodie', 'Thermal Lined Hoodie', 'Sherpa Hoodie'],
    jackets: ['Bomber Jacket', 'Denim Trucker Jacket', 'Leather Biker Jacket', 'Puffer Jacket', 'Windbreaker', 'Varsity Jacket', 'Field Utility Jacket', 'Tailored Blazer', 'Trench Coat', 'Coach Jacket', 'Quilted Liner Jacket', 'Rain Shell Jacket'],
    jeans: ['Slim Fit Jeans', 'Straight Leg Jeans', 'Relaxed Cargo Pants', 'Tapered Chinos', 'Wide Leg Trousers', 'Skinny Stretch Jeans', 'Distressed Denim', 'Tailored Formal Pants', 'Jogger Pants', 'Bootcut Jeans', 'Carpenter Pants', 'Raw Selvedge Denim'],
    dresses: ['Silk Slip Dress', 'Floral Maxi Dress', 'Little Black Dress', 'Wrap Midi Dress', 'Shirt Dress', 'Sequin Party Dress', 'Bodycon Dress', 'Boho Summer Dress', 'A-Line Office Dress', 'Satin Evening Gown', 'Tiered Sundress', 'Knit Sweater Dress'],
    shorts: ['Chino Shorts', 'Denim Shorts', 'Cargo Shorts', 'Board Shorts', 'Linen Shorts', 'Running Shorts', 'Sweat Shorts', 'Tailored Shorts', 'Basketball Shorts', 'Paperbag Shorts', 'Swim Shorts', 'Bermuda Shorts'],
    activewear: ['Performance Tank', 'Training Leggings', 'Sports Bra Top', 'Dry-Fit Tee', 'Compression Top', 'Yoga Set Top', 'Running Singlet', 'Seamless Tank', 'Gym Muscle Tank', 'Pro Training Top', 'Breathable Mesh Top', 'Flex Studio Top']
  };

  var PALETTE = ['#0b2a6f', '#d7141a', '#1f2937', '#e5e7eb', '#14532d', '#7c2d12', '#c2a878', '#1e3a8a', '#9f1239', '#0f766e', '#f59e0b', '#6d28d9'];
  var BADGES = ['New', '', 'Best Seller', '', 'Limited', '', 'Sale', '', '', 'Hot', '', ''];
  var BASE_PRICE = { tshirts: 2490, shirts: 4290, hoodies: 6490, jackets: 9890, jeans: 5990, dresses: 7490, shorts: 3290, activewear: 3990 };
  var COLL_IDS = COLLECTIONS.map(function (c) { return c.id; });

  function seedProducts() {
    var out = [];
    CATEGORIES.forEach(function (cat, ci) {
      NAMES[cat.id].forEach(function (name, i) {
        var price = BASE_PRICE[cat.id] + ((i * 370 + ci * 130) % 2400);
        price = Math.round(price / 10) * 10 - 10;
        var badge = BADGES[(i + ci) % BADGES.length];
        out.push({
          id: cat.id + '-' + (i + 1),
          name: name,
          category: cat.id,
          collections: [COLL_IDS[(i + ci) % COLL_IDS.length], COLL_IDS[(i * 2 + ci + 1) % COLL_IDS.length]]
            .filter(function (v, k, a) { return a.indexOf(v) === k; }),
          price: price,
          comparePrice: badge === 'Sale' ? Math.round(price * 1.3 / 10) * 10 : 0,
          color: PALETTE[(i + ci * 3) % PALETTE.length],
          image: '',
          sizes: cat.id === 'jeans' ? ['28', '30', '32', '34', '36'] : ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
          stock: 10 + ((i * 7 + ci * 5) % 60),
          badge: badge,
          featured: i < 2,
          description: name + ' from Source Connect Global. Crafted from premium, ethically sourced fabrics with a modern fit and finish built to last — designed for people who move between worlds.',
          createdAt: Date.now() - (i * CATEGORIES.length + ci) * 3600 * 1000
        });
      });
    });
    return out;
  }

  function seed() {
    return {
      version: 1,
      settings: {
        brand: 'Source Connect Global',
        announcement: 'FREE ISLANDWIDE DELIVERY ON ORDERS OVER LKR 10,000  ✦  NEW SUMMER 2026 COLLECTION OUT NOW  ✦  EASY 7-DAY EXCHANGES',
        currency: 'LKR',
        phone: '+94 77 000 0000',
        email: 'hello@sourceconnectglobal.com',
        address: 'Colombo, Sri Lanka',
        whatsapp: '94770000000',
        adminUser: 'admin',
        adminPass: 'admin123'
      },
      hero: [
        { id: 'h1', eyebrow: 'Summer 2026', title: 'Connect With\nThe World', subtitle: 'Global fashion, local soul. Discover the new season collection.', cta: 'Shop Collection', link: '#collection/summer-2026', color: '#0b2a6f', shape: 'jacket', image: '' },
        { id: 'h2', eyebrow: 'Urban Street', title: 'Wear The\nCity Lights', subtitle: 'Bold streetwear crafted for the ones who lead.', cta: 'Explore Street', link: '#collection/urban-street', color: '#d7141a', shape: 'hoodie', image: '' },
        { id: 'h3', eyebrow: 'Night Luxe', title: 'Elegance\nAfter Dark', subtitle: 'Cinematic silhouettes for unforgettable nights.', cta: 'Discover Luxe', link: '#collection/night-luxe', color: '#6d28d9', shape: 'dress', image: '' }
      ],
      categories: CATEGORIES.slice(),
      collections: COLLECTIONS.slice(),
      products: seedProducts()
    };
  }

  /* ---------- Persistence ---------- */
  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); return true; }
    catch (e) { alert('Storage is full. Use smaller images or export & reset data.'); return false; }
  }

  var cache = null;
  function load() {
    if (cache) return cache;
    var raw = safeGet(DB_KEY);
    if (raw) { try { cache = JSON.parse(raw); } catch (e) { cache = null; } }
    if (!cache || !cache.products) { cache = seed(); save(); }
    return cache;
  }
  function save() { return safeSet(DB_KEY, JSON.stringify(cache)); }
  function reset() { cache = seed(); save(); return cache; }

  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function slug(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('x'); }

  function money(n) {
    var cur = (load().settings.currency || 'LKR');
    return cur + ' ' + Number(n || 0).toLocaleString('en-US');
  }

  function categoryById(id) { return load().categories.filter(function (c) { return c.id === id; })[0]; }
  function collectionById(id) { return load().collections.filter(function (c) { return c.id === id; })[0]; }

  function productVisual(p) {
    if (p.image) return '<img src="' + p.image + '" alt="' + escapeHTML(p.name) + '" loading="lazy">';
    var cat = categoryById(p.category);
    return garmentSVG(cat ? cat.shape : 'tshirt', p.color || '#0b2a6f');
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Orders & cart */
  function getOrders() { try { return JSON.parse(safeGet(ORDERS_KEY) || '[]'); } catch (e) { return []; } }
  function saveOrders(o) { safeSet(ORDERS_KEY, JSON.stringify(o)); }
  function getCart() { try { return JSON.parse(safeGet(CART_KEY) || '[]'); } catch (e) { return []; } }
  function saveCart(c) { safeSet(CART_KEY, JSON.stringify(c)); }

  /** Resize an uploaded image File to a compact JPEG data URL. */
  function imageToDataURL(file, max) {
    max = max || 900;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var r = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  global.SCG = {
    SHAPES: SHAPES,
    load: load, save: save, reset: reset, seed: seed,
    uid: uid, slug: slug, money: money, escapeHTML: escapeHTML,
    garmentSVG: garmentSVG, productVisual: productVisual, shade: shade,
    categoryById: categoryById, collectionById: collectionById,
    getOrders: getOrders, saveOrders: saveOrders, getCart: getCart, saveCart: saveCart,
    imageToDataURL: imageToDataURL,
    keys: { DB_KEY: DB_KEY, ORDERS_KEY: ORDERS_KEY, CART_KEY: CART_KEY }
  };
})(window);
