/* =========================================================
   Source Connect Global — shared data store (v2, marketplace)
   Used by the storefront (/index.html) and the admin panel
   (/admin/). Data lives in localStorage.
   ========================================================= */
(function (global) {
  'use strict';

  var DB_KEY = 'scg_db_v2';
  var ORDERS_KEY = 'scg_orders_v1';
  var CART_KEY = 'scg_cart_v2';
  var WISH_KEY = 'scg_wish_v1';

  /* ---------- Product illustrations (SVG, viewBox 0 0 200 200) ----------
     body   : main silhouette, filled with the product colour
     parts  : extra pieces: f = 'a' accent colour, 'w' light, 'd' dark
     detail : stroked seams / laces / hands
     wear   : true when a fabric pattern makes sense on the body      */
  var SHAPES = {
    tshirt: { wear: 1, body: 'M62 38 L86 28 Q100 44 114 28 L138 38 L172 68 L152 92 L140 82 L140 172 L60 172 L60 82 L48 92 L28 68 Z', detail: 'M86 28 Q100 50 114 28' },
    polo: { wear: 1, body: 'M62 38 L86 28 L100 40 L114 28 L138 38 L172 68 L152 92 L140 82 L140 172 L60 172 L60 82 L48 92 L28 68 Z', parts: [{ d: 'M86 28 L92 46 L100 40 Z M114 28 L108 46 L100 40 Z', f: 'a' }], detail: 'M100 40 L100 72 M97 52 h6 M97 64 h6 M48 92 L28 68 M152 92 L172 68' },
    shirt: { wear: 1, body: 'M62 36 L84 26 L100 44 L116 26 L138 36 L174 104 L154 112 L140 84 L140 174 L60 174 L60 84 L46 112 L26 104 Z', detail: 'M84 26 L92 50 L100 44 L108 50 L116 26 M100 44 L100 174 M96 62 h8 M96 84 h8 M96 106 h8 M96 128 h8 M96 150 h8' },
    blouse: { wear: 1, body: 'M70 30 L88 26 Q100 40 112 26 L130 30 L162 62 L148 78 L134 66 Q140 120 132 172 L68 172 Q60 120 66 66 L52 78 L38 62 Z', detail: 'M88 26 Q100 54 112 26 M68 112 Q100 124 132 112 M74 140 Q100 150 126 140' },
    hoodie: { wear: 1, body: 'M64 44 Q70 14 100 14 Q130 14 136 44 L146 48 L176 118 L156 126 L140 92 L142 176 L58 176 L60 92 L44 126 L24 118 L54 48 Z', detail: 'M78 46 Q100 70 122 46 M92 58 L90 90 M108 58 L110 90 M74 130 h52 v26 h-52 Z' },
    sweater: { wear: 1, body: 'M62 34 L84 26 Q100 38 116 26 L138 34 L176 112 L156 120 L142 86 L142 170 L58 170 L58 86 L44 120 L24 112 Z', parts: [{ d: 'M58 160 L142 160 L142 172 L58 172 Z M84 26 Q100 38 116 26 L118 32 Q100 46 82 32 Z', f: 'd' }], detail: 'M70 70 L70 150 M85 66 L85 150 M100 66 L100 150 M115 66 L115 150 M130 70 L130 150' },
    jacket: { wear: 1, body: 'M60 36 L84 24 L100 40 L116 24 L140 36 L176 118 L156 126 L142 90 L142 176 L58 176 L58 90 L44 126 L24 118 Z', detail: 'M84 24 L94 64 L100 40 L106 64 L116 24 M100 40 L100 176 M68 120 h20 M112 120 h20' },
    puffer: { wear: 0, body: 'M60 34 Q100 18 140 34 L176 116 L156 126 L142 92 L144 176 L56 176 L58 92 L44 126 L24 116 Z', detail: 'M60 60 Q100 68 140 60 M58 88 Q100 96 142 88 M58 116 Q100 124 142 116 M58 144 Q100 152 142 144 M100 26 L100 176' },
    jeans: { wear: 1, body: 'M64 26 L136 26 L148 176 L110 176 L100 84 L90 176 L52 176 Z', detail: 'M64 40 L136 40 M100 40 L100 84 M70 40 Q76 60 92 56 M130 40 Q124 60 108 56' },
    dress: { wear: 1, body: 'M82 22 L92 22 Q100 34 108 22 L118 22 L120 70 L156 178 L44 178 L80 70 Z', detail: 'M80 70 Q100 78 120 70' },
    skirt: { wear: 1, body: 'M70 40 L130 40 L134 54 L164 168 Q100 182 36 168 L66 54 Z', parts: [{ d: 'M70 40 L130 40 L134 54 L66 54 Z', f: 'd' }], detail: 'M90 54 L76 172 M110 54 L124 172 M100 54 L100 176' },
    shorts: { wear: 1, body: 'M58 50 L142 50 L154 136 L110 140 L100 96 L90 140 L46 136 Z', detail: 'M58 62 L142 62 M100 62 L100 96' },
    activewear: { wear: 1, body: 'M74 26 L88 26 Q100 50 112 26 L126 26 L128 68 Q138 120 136 174 L64 174 Q62 120 72 68 Z', detail: 'M72 96 Q100 104 128 96' },
    cap: { wear: 0, body: 'M40 120 Q40 50 100 50 Q160 50 160 120 Z', parts: [{ d: 'M40 120 L186 120 Q180 138 150 136 L40 130 Z', f: 'a' }, { d: 'M94 46 h12 v8 h-12 Z', f: 'd' }], detail: 'M100 54 L100 120 M70 58 Q66 90 66 120 M130 58 Q134 90 134 120' },
    bag: { wear: 1, body: 'M44 74 L156 74 L166 176 L34 176 Z', detail: 'M74 74 Q74 30 100 30 Q126 30 126 74' },
    handbag: { wear: 1, body: 'M40 84 L160 84 L172 170 Q172 176 166 176 L34 176 Q28 176 28 170 Z', parts: [{ d: 'M90 104 h20 v16 h-20 Z', f: 'a' }], detail: 'M68 84 Q68 42 100 42 Q132 42 132 84 M30 112 L170 112' },
    backpack: { wear: 1, body: 'M58 50 Q58 34 74 34 L126 34 Q142 34 142 50 L148 170 Q148 178 140 178 L60 178 Q52 178 52 170 Z', parts: [{ d: 'M68 112 L132 112 L134 162 L66 162 Z', f: 'd' }], detail: 'M80 34 Q80 16 100 16 Q120 16 120 34 M100 56 L100 98 M76 136 h48' },
    wallet: { wear: 0, body: 'M36 62 L164 62 Q174 62 174 72 L174 148 Q174 158 164 158 L36 158 Q26 158 26 148 L26 72 Q26 62 36 62 Z', parts: [{ d: 'M120 92 L174 92 L174 128 L120 128 Q112 128 112 120 L112 100 Q112 92 120 92 Z', f: 'd' }, { d: 'M128 104 h10 v10 h-10 Z', f: 'a' }], detail: 'M26 80 L174 80' },
    watch: { wear: 0, body: 'M80 18 L120 18 L116 62 L84 62 Z M84 138 L116 138 L120 182 L80 182 Z', parts: [{ d: 'M50 100 a50 50 0 1 0 100 0 a50 50 0 1 0 -100 0 Z', f: 'a' }, { d: 'M60 100 a40 40 0 1 0 80 0 a40 40 0 1 0 -80 0 Z', f: 'w' }, { d: 'M150 94 h8 v12 h-8 Z', f: 'a' }], detail: 'M100 100 L100 72 M100 100 L120 110 M100 64 L100 68 M100 132 L100 136 M64 100 L68 100 M132 100 L136 100' },
    sunglasses: { wear: 0, body: 'M22 82 L92 82 Q96 122 68 128 Q32 130 26 104 Z M108 82 L178 82 L174 104 Q168 130 132 128 Q104 122 108 82 Z', parts: [{ d: 'M34 90 L58 90 L42 112 Z M120 90 L144 90 L128 112 Z', f: 'w' }], detail: 'M92 90 Q100 80 108 90 M22 82 L10 76 M178 82 L190 76 M22 82 L178 82' },
    belt: { wear: 0, body: 'M10 86 L190 86 L190 114 L10 114 Z', parts: [{ d: 'M118 74 h38 v52 h-38 Z', f: 'a' }, { d: 'M126 82 h22 v36 h-22 Z', f: 'd' }], detail: 'M30 100 h0.1 M48 100 h0.1 M66 100 h0.1 M84 100 h0.1 M126 100 L148 100' },
    sneaker: { wear: 0, body: 'M24 132 Q22 104 40 98 L74 90 Q86 70 104 76 L120 92 Q150 96 170 112 Q182 120 180 136 L180 142 L24 142 Z', parts: [{ d: 'M20 138 L182 138 L182 150 Q100 160 22 152 Z', f: 'a' }, { d: 'M126 104 Q150 108 160 124 L120 124 Z', f: 'a' }], detail: 'M80 92 L96 104 M88 86 L104 98 M96 80 L112 92 M40 120 Q100 114 176 130' },
    oxford: { wear: 0, body: 'M24 124 Q24 106 44 102 L96 96 Q126 90 150 104 Q176 112 180 128 L180 138 L24 138 Z', parts: [{ d: 'M20 134 L184 134 L184 146 L20 146 Z', f: 'a' }], detail: 'M96 96 Q110 112 130 102 M104 100 L118 98 M108 106 L124 104 M24 124 Q60 122 96 112' },
    boot: { wear: 0, body: 'M60 26 L112 26 L116 98 Q152 102 170 120 Q180 128 178 140 L60 140 Z', parts: [{ d: 'M56 136 L182 136 L182 152 L56 152 Z', f: 'a' }, { d: 'M60 26 L112 26 L112 40 L60 40 Z', f: 'd' }], detail: 'M112 40 L114 98 M70 60 h36 M70 78 h36' },
    heel: { wear: 0, body: 'M28 120 Q60 122 92 96 Q120 72 150 68 Q172 68 174 88 L172 100 Q142 104 120 120 L96 140 Q70 152 32 142 Z', parts: [{ d: 'M148 98 L168 98 L160 160 L154 160 Z', f: 'a' }], detail: 'M150 70 Q138 88 150 98 M40 136 Q70 140 94 128' },
    sandal: { wear: 0, body: 'M64 124 Q86 80 110 122 Z M120 122 Q140 92 156 120 Z', parts: [{ d: 'M28 138 Q28 124 50 122 L160 118 Q180 120 180 134 Q180 148 160 150 L50 152 Q28 152 28 138 Z', f: 'a' }], detail: 'M74 112 Q86 100 100 112 M128 112 Q140 102 150 112' }
  };
  var PATTERNS = ['solid', 'stripes', 'check', 'dots', 'logo', 'colorblock'];

  function shade(hex, amt) {
    var c = String(hex || '#0b2a6f').replace('#', '');
    if (c.length === 3) c = c.split('').map(function (x) { return x + x; }).join('');
    var n = parseInt(c, 16) || 0;
    var r = Math.max(0, Math.min(255, (n >> 16) + amt));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function lum(hex) { var n = parseInt(String(hex).replace('#', ''), 16) || 0; return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) / 255; }

  var uidN = 0;
  /** SVG string of a stylised product. */
  function productSVG(shape, color, pattern, accent) {
    var s = SHAPES[shape] || SHAPES.tshirt;
    color = color || '#0b2a6f';
    var id = 's' + (++uidN).toString(36) + Math.random().toString(36).slice(2, 5);
    var light = shade(color, 50), dark = shade(color, -55);
    var ink = lum(color) > .6 ? '#1f2937' : '#ffffff';
    accent = accent || (lum(color) > .6 ? '#1f2937' : '#f3f4f6');
    var defs = '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + light + '"/><stop offset=".55" stop-color="' + color + '"/><stop offset="1" stop-color="' + dark + '"/></linearGradient>' +
      '<clipPath id="' + id + 'c"><path d="' + s.body + '"/></clipPath>';
    var overlay = '';
    pattern = s.wear ? (pattern || 'solid') : 'solid';
    if (pattern === 'stripes') {
      defs += '<pattern id="' + id + 'p" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="6" fill="' + ink + '" fill-opacity=".55"/></pattern>';
      overlay = '<rect width="200" height="200" fill="url(#' + id + 'p)" clip-path="url(#' + id + 'c)"/>';
    } else if (pattern === 'check') {
      defs += '<pattern id="' + id + 'p" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="7" fill="' + ink + '" fill-opacity=".35"/><rect width="7" height="20" fill="' + ink + '" fill-opacity=".35"/><rect width="20" height="1.5" y="13" fill="' + accent + '" fill-opacity=".6"/></pattern>';
      overlay = '<rect width="200" height="200" fill="url(#' + id + 'p)" clip-path="url(#' + id + 'c)"/>';
    } else if (pattern === 'dots') {
      defs += '<pattern id="' + id + 'p" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.6" fill="' + ink + '" fill-opacity=".7"/><circle cx="12" cy="12" r="2.6" fill="' + ink + '" fill-opacity=".7"/></pattern>';
      overlay = '<rect width="200" height="200" fill="url(#' + id + 'p)" clip-path="url(#' + id + 'c)"/>';
    } else if (pattern === 'colorblock') {
      overlay = '<rect y="112" width="200" height="88" fill="' + accent + '" fill-opacity=".9" clip-path="url(#' + id + 'c)"/><rect y="106" width="200" height="6" fill="#d7141a" clip-path="url(#' + id + 'c)"/>';
    } else if (pattern === 'logo') {
      overlay = '<g clip-path="url(#' + id + 'c)"><circle cx="100" cy="86" r="17" fill="none" stroke="' + ink + '" stroke-width="2.5"/><text x="100" y="92" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-style="italic" font-size="17" fill="' + ink + '">SC</text></g>';
    }
    var parts = (s.parts || []).map(function (p) {
      var f = p.f === 'a' ? accent : p.f === 'w' ? '#f8fafc' : dark;
      return '<path d="' + p.d + '" fill="' + f + '" stroke="' + shade(f, -50) + '" stroke-width="1.2" stroke-linejoin="round"/>';
    }).join('');
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="pic" aria-hidden="true"><defs>' + defs + '</defs>' +
      '<ellipse cx="100" cy="188" rx="64" ry="6" fill="rgba(0,0,0,.14)"/>' +
      '<path d="' + s.body + '" fill="url(#' + id + 'g)" stroke="' + dark + '" stroke-width="1.5" stroke-linejoin="round"/>' + overlay + parts +
      '<path d="' + (s.detail || '') + '" fill="none" stroke="' + (shape === 'watch' ? '#111827' : dark) + '" stroke-opacity=".7" stroke-width="' + (shape === 'watch' ? 2.6 : 1.6) + '" stroke-linecap="round"/>' +
      '</svg>';
  }
  // backwards-compatible name
  function garmentSVG(shape, color) { return productSVG(shape, color); }

  /* ---------- Seed data ---------- */
  var CATEGORIES = [
    { id: 'mens', name: "Men's Fashion", shape: 'polo', icon: '#0b2a6f', tagline: 'Tees, shirts, denim & more' },
    { id: 'womens', name: "Women's Fashion", shape: 'dress', icon: '#be185d', tagline: 'Dresses, tops & skirts' },
    { id: 'kids', name: 'Kids & Baby', shape: 'tshirt', icon: '#f59e0b', tagline: 'Comfy clothes for little ones' },
    { id: 'shoes', name: 'Shoes', shape: 'sneaker', icon: '#0f766e', tagline: 'Sneakers, boots, heels & sandals' },
    { id: 'bags', name: 'Bags & Wallets', shape: 'handbag', icon: '#7c2d12', tagline: 'Handbags, backpacks & wallets' },
    { id: 'watches', name: 'Watches', shape: 'watch', icon: '#334155', tagline: 'Classic, sport & smart' },
    { id: 'accessories', name: 'Accessories', shape: 'sunglasses', icon: '#6d28d9', tagline: 'Sunglasses, belts & caps' },
    { id: 'sportswear', name: 'Sportswear', shape: 'activewear', icon: '#d7141a', tagline: 'Train, run & play' },
    { id: 'officewear', name: 'Office Wear', shape: 'shirt', icon: '#1e3a8a', tagline: 'Sharp looks for work' },
    { id: 'winter', name: 'Winter & Jackets', shape: 'puffer', icon: '#0369a1', tagline: 'Jackets, hoodies & knits' }
  ];

  var COLLECTIONS = [
    { id: 'china-direct', name: 'China Direct', description: 'Factory prices, shipped straight from China to Sri Lanka.', accent: '#d7141a' },
    { id: 'new-arrivals', name: 'New Arrivals', description: 'Fresh styles landed this week.', accent: '#0b2a6f' },
    { id: 'best-sellers', name: 'Best Sellers', description: 'What Sri Lanka is buying right now.', accent: '#f59e0b' },
    { id: 'under-2000', name: 'Under Rs. 2,000', description: 'Big style, small prices.', accent: '#0f766e' },
    { id: 'urban-street', name: 'Urban Street', description: 'Bold streetwear for the city.', accent: '#6d28d9' }
  ];

  // [name, shape, pattern]
  var ITEMS = {
    mens: [['Classic Cotton Crew Neck Tee', 'tshirt', 'solid'], ['Striped Breton Tee', 'tshirt', 'stripes'], ['Slim Fit Oxford Shirt', 'shirt', 'solid'], ['Check Flannel Shirt', 'shirt', 'check'], ['Pique Polo Shirt', 'polo', 'solid'], ['SC Logo Polo Shirt', 'polo', 'logo'], ['Stretch Slim Fit Jeans', 'jeans', 'solid'], ['Relaxed Chino Pants', 'jeans', 'solid'], ['Denim Trucker Jacket', 'jacket', 'solid'], ['Pullover Logo Hoodie', 'hoodie', 'logo'], ['Utility Cargo Shorts', 'shorts', 'solid'], ['Linen Printed Resort Shirt', 'shirt', 'dots']],
    womens: [['Floral Wrap Midi Dress', 'dress', 'dots'], ['Satin Slip Dress', 'dress', 'solid'], ['Pleated Midi Skirt', 'skirt', 'solid'], ['Check A-Line Mini Skirt', 'skirt', 'check'], ['Ruffle Chiffon Blouse', 'blouse', 'solid'], ['Striped Office Blouse', 'blouse', 'stripes'], ['High Waist Mom Jeans', 'jeans', 'solid'], ['Cropped Denim Jacket', 'jacket', 'solid'], ['Ribbed Knit Tank Top', 'activewear', 'stripes'], ['Polka Dot Sundress', 'dress', 'dots'], ['Oversized Hoodie', 'hoodie', 'solid'], ['Color Block Boxy Tee', 'tshirt', 'colorblock']],
    kids: [['Kids Dino Print Tee', 'tshirt', 'dots'], ['Kids Striped Cotton Tee', 'tshirt', 'stripes'], ['Girls Party Dress', 'dress', 'solid'], ['Girls Tutu Skirt', 'skirt', 'dots'], ['Boys Denim Shorts', 'shorts', 'solid'], ['Kids Zip-Up Hoodie', 'hoodie', 'colorblock'], ['Kids Jogger Pants', 'jeans', 'solid'], ['Baby Cotton Romper', 'activewear', 'dots'], ['Kids School Shirt', 'shirt', 'solid'], ['Kids Puffer Jacket', 'puffer', 'solid'], ['Kids Baseball Cap', 'cap', 'solid'], ['Kids Mini Backpack', 'backpack', 'dots']],
    shoes: [['Classic White Sneakers', 'sneaker', 'solid'], ['Air Cushion Running Shoes', 'sneaker', 'solid'], ['Canvas Low Top Sneakers', 'sneaker', 'solid'], ['Chelsea Leather Boots', 'boot', 'solid'], ['Hiking Ankle Boots', 'boot', 'solid'], ['Block Heel Pumps', 'heel', 'solid'], ['Stiletto Party Heels', 'heel', 'solid'], ['Comfort Slide Sandals', 'sandal', 'solid'], ['Strappy Flat Sandals', 'sandal', 'solid'], ['Chunky Dad Sneakers', 'sneaker', 'solid'], ['Formal Oxford Shoes', 'oxford', 'solid'], ['Suede Desert Boots', 'boot', 'solid']],
    bags: [['Leather Tote Bag', 'bag', 'solid'], ['Canvas Shopper Tote', 'bag', 'stripes'], ['Structured Top Handle Bag', 'handbag', 'solid'], ['Mini Crossbody Bag', 'handbag', 'solid'], ['Quilted Chain Shoulder Bag', 'handbag', 'check'], ['Anti-Theft Laptop Backpack', 'backpack', 'solid'], ['Travel Backpack 40L', 'backpack', 'colorblock'], ['School Backpack', 'backpack', 'dots'], ['Slim Leather Bifold Wallet', 'wallet', 'solid'], ['Zip Around Ladies Wallet', 'wallet', 'solid'], ['RFID Card Holder', 'wallet', 'solid'], ['Weekender Duffel Bag', 'bag', 'solid']],
    watches: [['Classic Leather Strap Watch', 'watch', 'solid'], ['Chronograph Steel Watch', 'watch', 'solid'], ['Minimalist Mesh Watch', 'watch', 'solid'], ['Smart Fitness Watch', 'watch', 'solid'], ['Rose Gold Ladies Watch', 'watch', 'solid'], ['Diver Sport Watch', 'watch', 'solid'], ['Digital Sports Watch', 'watch', 'solid'], ['Couple Watch Set', 'watch', 'solid'], ['Skeleton Automatic Watch', 'watch', 'solid'], ['Kids Cartoon Watch', 'watch', 'solid'], ['Silicone Strap Watch', 'watch', 'solid'], ['Square Dial Fashion Watch', 'watch', 'solid']],
    accessories: [['Aviator Sunglasses', 'sunglasses', 'solid'], ['Polarized Wayfarer Sunglasses', 'sunglasses', 'solid'], ['Cat Eye Sunglasses', 'sunglasses', 'solid'], ['Sports Wrap Sunglasses', 'sunglasses', 'solid'], ['Leather Dress Belt', 'belt', 'solid'], ['Canvas Casual Belt', 'belt', 'solid'], ['Reversible Leather Belt', 'belt', 'solid'], ['Classic Baseball Cap', 'cap', 'solid'], ['SC Logo Snapback Cap', 'cap', 'solid'], ['Trucker Mesh Cap', 'cap', 'solid'], ['Kids Round Sunglasses', 'sunglasses', 'solid'], ['Weekend Tote Bag', 'bag', 'check']],
    sportswear: [['Dry-Fit Training Tee', 'tshirt', 'solid'], ['Performance Tank Top', 'activewear', 'solid'], ['Compression Leggings', 'jeans', 'solid'], ['Sports Bra Crop Top', 'activewear', 'colorblock'], ['Running Shorts', 'shorts', 'stripes'], ['Gym Zip Hoodie', 'hoodie', 'colorblock'], ['Track Jacket', 'jacket', 'stripes'], ['High Rise Yoga Pants', 'jeans', 'solid'], ['Football Jersey', 'tshirt', 'stripes'], ['Training Joggers', 'jeans', 'stripes'], ['Gym Duffel Bag', 'bag', 'solid'], ['Cross Training Sneakers', 'sneaker', 'solid']],
    officewear: [['Tailored Slim Blazer', 'jacket', 'solid'], ['Pinstripe Formal Shirt', 'shirt', 'stripes'], ['Slim Formal Trousers', 'jeans', 'solid'], ['Pencil Skirt', 'skirt', 'solid'], ['Sheath Office Dress', 'dress', 'solid'], ['Silk Office Blouse', 'blouse', 'solid'], ['Non-Iron Dress Shirt', 'shirt', 'solid'], ['Check Suit Trousers', 'jeans', 'check'], ['Leather Office Handbag', 'handbag', 'solid'], ['Formal Derby Shoes', 'oxford', 'solid'], ['Executive Leather Belt', 'belt', 'solid'], ['Executive Steel Watch', 'watch', 'solid']],
    winter: [['Hooded Puffer Jacket', 'puffer', 'solid'], ['Lightweight Down Jacket', 'puffer', 'solid'], ['Wool Blend Overcoat', 'jacket', 'solid'], ['Fleece Zip Hoodie', 'hoodie', 'solid'], ['Windbreaker Jacket', 'jacket', 'colorblock'], ['Cable Knit Sweater', 'sweater', 'solid'], ['Crew Neck Wool Sweater', 'sweater', 'stripes'], ['Check Knit Cardigan', 'jacket', 'check'], ['Bomber Jacket', 'jacket', 'solid'], ['Sherpa Lined Hoodie', 'hoodie', 'solid'], ['Waterproof Rain Coat', 'jacket', 'solid'], ['Knit Beanie Cap', 'cap', 'solid']]
  };

  var PALETTE = ['#0b2a6f', '#d7141a', '#1f2937', '#e5e7eb', '#14532d', '#7c2d12', '#c2a878', '#1e3a8a', '#be185d', '#0f766e', '#f59e0b', '#6d28d9', '#0ea5e9', '#f472b6', '#84cc16', '#9ca3af'];
  var ACCENTS = ['#f3f4f6', '#111827', '#d7141a', '#c2a878', '#e5e7eb', '#0b2a6f'];
  var BASE = { mens: 1890, womens: 2490, kids: 1290, shoes: 3990, bags: 2990, watches: 3490, accessories: 990, sportswear: 1790, officewear: 3290, winter: 4990 };
  var BRANDS = ['SC Global', 'SC Basics', 'Urban Street', 'Lanka Loom', 'Silk Route', 'Orient Wear'];

  function seedProducts() {
    var out = [], n = 0;
    CATEGORIES.forEach(function (cat, ci) {
      ITEMS[cat.id].forEach(function (it, i) {
        n++;
        var price = Math.round((BASE[cat.id] + ((i * 433 + ci * 271) % 3100)) / 10) * 10 - 10;
        var flash = (n % 5 === 0) || (n % 7 === 0);
        var disc = flash ? 20 + (n * 7) % 45 : (n % 3 === 0 ? 10 + (n * 3) % 20 : 0);
        var compare = disc ? Math.round(price / (1 - disc / 100) / 10) * 10 : 0;
        var colls = [];
        if (n % 10 < 7) colls.push('china-direct');
        if (i < 3) colls.push('new-arrivals');
        if ((n * 7) % 11 < 3) colls.push('best-sellers');
        if (price < 2000) colls.push('under-2000');
        if (/Logo|Street|Oversized|Hoodie|Snapback|Chunky|Bomber|Jersey/.test(it[0])) colls.push('urban-street');
        out.push({
          id: cat.id + '-' + (i + 1),
          name: it[0],
          category: cat.id,
          shape: it[1],
          pattern: it[2],
          brand: BRANDS[(n * 5) % BRANDS.length],
          collections: colls,
          price: price,
          comparePrice: compare,
          color: PALETTE[(i * 5 + ci * 3) % PALETTE.length],
          accent: ACCENTS[(i + ci) % ACCENTS.length],
          image: '',
          sizes: sizesFor(cat.id, it[1]),
          stock: 8 + ((i * 7 + ci * 5) % 90),
          sold: 20 + ((n * 137) % 2400),
          rating: Math.round((3.9 + ((n * 13) % 11) / 10) * 10) / 10,
          reviews: 4 + ((n * 53) % 640),
          origin: n % 10 < 7 ? 'china' : 'local',
          badge: flash ? 'Flash Sale' : (i < 2 ? 'New' : ''),
          flash: flash,
          featured: i < 2,
          description: it[0] + ' by ' + BRANDS[(n * 5) % BRANDS.length] + '. Sourced directly from trusted factories and quality-checked by Source Connect Global before it ships to Sri Lanka. Comfortable, durable and great value.',
          createdAt: Date.now() - (i * CATEGORIES.length + ci) * 3600 * 1000
        });
      });
    });
    return out;
  }
  function sizesFor(cat, shape) {
    if (/sneaker|boot|heel|sandal|oxford/.test(shape)) return ['36', '37', '38', '39', '40', '41', '42', '43', '44'];
    if (/watch|bag|handbag|backpack|wallet|sunglasses|cap/.test(shape)) return [];
    if (shape === 'belt') return ['S', 'M', 'L', 'XL'];
    if (cat === 'kids') return ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-12Y'];
    if (shape === 'jeans') return ['28', '30', '32', '34', '36', '38'];
    return ['S', 'M', 'L', 'XL', 'XXL'];
  }

  function seed() {
    return {
      version: 2,
      settings: {
        brand: 'Source Connect Global',
        announcement: 'Free delivery islandwide on orders over Rs. 10,000  ✦  China Direct: factory prices, delivered in 10–14 days  ✦  Cash on Delivery available',
        currency: 'Rs.',
        freeShipping: 10000,
        shippingFee: 350,
        phone: '+94 77 000 0000',
        email: 'hello@sourceconnectglobal.com',
        address: 'Colombo, Sri Lanka',
        whatsapp: '94770000000',
        heroTitle: 'From China to\nYour Doorstep',
        heroSubtitle: 'We source fashion straight from trusted factories in China and deliver it across Sri Lanka at factory prices.',
        adminUser: 'admin',
        adminPass: 'admin123',
        // ---- delivery & payment ----
        chinaDays: '10–14',
        localDays: '2–4',
        payCOD: true,
        payBank: true,
        bankDetails: 'Bank: Commercial Bank · Account: Source Connect Global · No: 0000000000 · Branch: Colombo',
        paymentMethods: ['Cash on Delivery', 'VISA', 'Mastercard', 'Bank Transfer'],
        returnDays: 7,
        // ---- header ----
        navLinks: [
          { label: '⚡ Flash Sale', link: '#flash', hot: true },
          { label: 'China Direct', link: '#col/china-direct' },
          { label: 'New Arrivals', link: '#col/new-arrivals' },
          { label: 'Best Sellers', link: '#col/best-sellers' },
          { label: 'Under Rs. 2,000', link: '#col/under-2000' },
          { label: 'All Products', link: '#shop' }
        ],
        // ---- homepage ----
        sections: [
          { id: 'services', name: 'Quick service icons', on: true },
          { id: 'flash', name: 'Flash Sale', on: true },
          { id: 'categories', name: 'Categories grid', on: true },
          { id: 'banners', name: 'Wide promo banners', on: true },
          { id: 'china', name: 'China Direct row', on: true, title: 'China Direct — Factory Prices' },
          { id: 'best', name: 'Best Sellers row', on: true, title: 'Best Sellers' },
          { id: 'jfy', name: 'Just For You feed', on: true, title: 'Just For You' }
        ],
        services: [
          { label: 'Flash Sale', link: '#flash', icon: 'bolt', color: '#d7141a' },
          { label: 'China Direct', link: '#col/china-direct', icon: 'plane', color: '#0b2a6f' },
          { label: 'New Arrivals', link: '#col/new-arrivals', icon: 'tag', color: '#7c3aed' },
          { label: 'Best Sellers', link: '#col/best-sellers', icon: 'star', color: '#f59e0b' },
          { label: 'Under Rs. 2,000', link: '#col/under-2000', icon: 'cash', color: '#0f766e' },
          { label: 'Free Delivery', link: '#help', icon: 'truck', color: '#0284c7' },
          { label: '7-Day Returns', link: '#help', icon: 'swap', color: '#be185d' },
          { label: 'Track Order', link: '#track', icon: 'pin', color: '#334155' }
        ],
        // ---- flash sale ----
        flashTitle: 'Flash Sale',
        flashMode: 'daily',        // 'daily' = resets every midnight, 'until' = ends at flashUntil, 'off'
        flashUntil: '',
        // ---- globe ----
        globeCities: ['Shenzhen', 'Yiwu', 'Shanghai', 'Guangzhou', 'Beijing'],
        globeStats: [
          { value: '1,248', label: 'Parcels this month', live: true },
          { value: '10–14', label: 'Days delivery' },
          { value: '25+', label: 'Factories' }
        ],
        globeSteps: [
          { title: 'Sourced', text: 'in China' }, { title: 'Checked', text: 'for quality' }, { title: 'Shipping', text: 'by sea & air' },
          { title: 'Colombo', text: 'customs cleared' }, { title: 'Delivered', text: 'to your door' }
        ],
        // ---- product page ----
        sellerStats: [{ value: '96%', label: 'Positive ratings' }, { value: '98%', label: 'Ship on time' }, { value: '92%', label: 'Chat response' }],
        // ---- China Direct page ----
        chinaSteps: [
          { title: 'Sourced', text: 'We buy directly from vetted factories in Guangzhou, Yiwu, Shenzhen and Shanghai.' },
          { title: 'Quality checked', text: 'Every batch is inspected by our team in China before packing.' },
          { title: 'Shipped', text: 'Sea freight for bulk, air freight for fast orders. Fully tracked.' },
          { title: 'Cleared in Colombo', text: 'We handle customs and duties. No surprise charges for you.' },
          { title: 'Delivered', text: 'Islandwide delivery to your door, with Cash on Delivery.' }
        ],
        faq: [
          { q: 'How long does China Direct delivery take?', a: 'Usually 10–14 days from order confirmation to your door. Items marked “Ships from Colombo” arrive in 2–4 days.' },
          { q: 'Do I pay customs or import duty?', a: 'No. Prices include shipping from China and customs clearance in Sri Lanka.' },
          { q: 'Can I pay cash on delivery?', a: 'Yes, Cash on Delivery is available islandwide. You can also pay by bank transfer.' },
          { q: 'What if the item is wrong or damaged?', a: 'Contact us within 7 days of delivery and we will replace it or refund you.' },
          { q: 'How do I track my order?', a: 'Use “Track My Order” with your order number and phone number.' }
        ]
      },
      hero: [
        { id: 'h1', eyebrow: 'Mega Sale', title: 'Up to 60% OFF', subtitle: 'Fashion, shoes & bags', cta: 'Shop Sale', link: '#flash', color: '#d7141a', shape: 'sneaker', image: '' },
        { id: 'h2', eyebrow: 'China Direct', title: 'Factory Prices', subtitle: 'Shipped straight to Sri Lanka', cta: 'Explore', link: '#col/china-direct', color: '#0b2a6f', shape: 'handbag', image: '' },
        { id: 'h3', eyebrow: 'New Season', title: 'Winter Drop', subtitle: 'Jackets & knitwear', cta: 'Shop Now', link: '#c/winter', color: '#0369a1', shape: 'puffer', image: '' },
        { id: 'h4', eyebrow: 'Watches', title: 'Time to Shine', subtitle: 'From Rs. 3,490', cta: 'Browse', link: '#c/watches', color: '#334155', shape: 'watch', image: '' }
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
    catch (e) { if (global.alert) alert('Storage is full. Use smaller images, or export a backup and reset.'); return false; }
  }

  var cache = null;
  function load() {
    if (cache) return cache;
    var raw = safeGet(DB_KEY);
    if (raw) { try { cache = JSON.parse(raw); } catch (e) { cache = null; } }
    if (!cache || !cache.products) { cache = seed(); save(); }
    // fill fields added after older saves
    var d = seed().settings;
    Object.keys(d).forEach(function (k) { if (cache.settings[k] === undefined) cache.settings[k] = d[k]; });
    return cache;
  }
  function save() { return safeSet(DB_KEY, JSON.stringify(cache)); }
  function reset() { cache = seed(); save(); return cache; }

  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function slug(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('x'); }
  function money(n) { return (load().settings.currency || 'Rs.') + ' ' + Number(n || 0).toLocaleString('en-US'); }
  function discount(p) { return p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0; }

  function categoryById(id) { return load().categories.filter(function (c) { return c.id === id; })[0]; }
  function collectionById(id) { return load().collections.filter(function (c) { return c.id === id; })[0]; }
  function productById(id) { return load().products.filter(function (p) { return p.id === id; })[0]; }

  function productVisual(p, color) {
    if (p.image) return '<img src="' + p.image + '" alt="' + escapeHTML(p.name) + '" loading="lazy">';
    var cat = categoryById(p.category);
    return productSVG(p.shape || (cat ? cat.shape : 'tshirt'), color || p.color, p.pattern, p.accent);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJSON(k, d) { try { return JSON.parse(safeGet(k) || d); } catch (e) { return JSON.parse(d); } }
  function getOrders() { return getJSON(ORDERS_KEY, '[]'); }
  function saveOrders(o) { safeSet(ORDERS_KEY, JSON.stringify(o)); }
  function getCart() { return getJSON(CART_KEY, '[]'); }
  function saveCart(c) { safeSet(CART_KEY, JSON.stringify(c)); }
  function getWish() { return getJSON(WISH_KEY, '[]'); }
  function saveWish(w) { safeSet(WISH_KEY, JSON.stringify(w)); }

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
    SHAPES: SHAPES, PATTERNS: PATTERNS,
    load: load, save: save, reset: reset, seed: seed,
    uid: uid, slug: slug, money: money, discount: discount, escapeHTML: escapeHTML,
    productSVG: productSVG, garmentSVG: garmentSVG, productVisual: productVisual, shade: shade,
    categoryById: categoryById, collectionById: collectionById, productById: productById,
    getOrders: getOrders, saveOrders: saveOrders, getCart: getCart, saveCart: saveCart, getWish: getWish, saveWish: saveWish,
    imageToDataURL: imageToDataURL,
    keys: { DB_KEY: DB_KEY, ORDERS_KEY: ORDERS_KEY, CART_KEY: CART_KEY, WISH_KEY: WISH_KEY }
  };
})(window);
