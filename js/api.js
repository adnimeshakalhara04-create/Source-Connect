/* =========================================================
   Source Connect Global — connection to the server API
   Loaded after js/store.js. When js/config.js sets window.SCG_API the
   website and admin read/write the PostgreSQL database through the API.
   When it is empty the site keeps working as an offline demo.
   ========================================================= */
(function (global) {
  'use strict';
  var SCG = global.SCG;
  var SB = global.SCGSupabase || null;            // Supabase backend (js/supabase-backend.js), when configured
  var BASE = SB ? SB.url : String(global.SCG_API || '').replace(/\/+$/, '');
  var IS_ADMIN = !!global.SCG_ADMIN;
  SCG.API = BASE;

  if (!BASE) {                                   // offline demo mode: nothing to wait for
    SCG.ready = Promise.resolve();
    SCG.whenReady = function (fn) { fn(); };
    return;
  }

  /* ---------------- HTTP ---------------- */
  var tokens = { staff: '', customer: '' };
  function api(method, path, body, opts) {
    if (SB) return SB.call(method, path, body, opts);
    opts = opts || {};
    var h = { 'accept': 'application/json' };
    var isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) h['content-type'] = 'application/json';
    if (method !== 'GET') {
      var t = path.indexOf('/admin/') === 0 ? tokens.staff : tokens.customer;
      if (t) h['x-csrf-token'] = t;
    }
    if (opts.idempotencyKey) h['idempotency-key'] = opts.idempotencyKey;
    return fetch(BASE + '/api/v1' + path, {
      method: method, credentials: 'include', cache: 'no-store', headers: h,
      body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body))
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (data && typeof data.csrfToken === 'string') { if (path.indexOf('/admin/') === 0) tokens.staff = data.csrfToken; else tokens.customer = data.csrfToken; }
        if (!res.ok) {
          var err = new Error((data && data.message) || ('Request failed (' + res.status + ')'));
          err.status = res.status; err.code = data && data.error; err.data = data;
          throw err;
        }
        return data;
      });
    }, function () {
      var err = new Error('Cannot reach the shop server. Check your internet connection and try again.');
      err.status = 0; throw err;
    });
  }
  SCG.api = api;

  /* ---------------- storefront ---------------- */
  SCG.customer = null;
  SCG.refresh = function () {
    return api('GET', '/storefront').then(function (d) {
      var c = SCG.load();
      if (c.placeholder) return SCG.setCache(d);
      ['settings', 'categories', 'collections', 'hero', 'products', 'shops'].forEach(function (k) { c[k] = d[k]; });
      return c;
    });
  };
  SCG.loadCustomer = function () {
    return api('GET', '/customers/me').then(function (r) { SCG.customer = r.customer; return r.customer; }, function () { SCG.customer = null; return null; });
  };
  SCG.customerAuth = function (kind, body) {   // kind: 'login' | 'register'
    return api('POST', '/customers/' + kind, body).then(function (r) { SCG.customer = r.customer && r.customer.pendingConfirmation ? null : r.customer; return r.customer; });
  };
  SCG.customerLogout = function () { return api('POST', '/customers/logout', {}).catch(function () {}).then(function () { SCG.customer = null; tokens.customer = ''; }); };

  // Orders placed on this device (number + private tracking token) so the buyer can follow them without an account.
  var MY = 'scg_my_orders_v1';
  SCG.myOrders = function () { try { return JSON.parse(localStorage.getItem(MY) || '[]'); } catch (e) { return []; } };
  SCG.rememberOrder = function (number, token) {
    var list = SCG.myOrders().filter(function (o) { return o.number !== number; });
    list.unshift({ number: number, token: token, at: Date.now() });
    try { localStorage.setItem(MY, JSON.stringify(list.slice(0, 30))); } catch (e) {}
  };
  SCG.trackOrder = function (number, token, phone) { return api('POST', '/orders/track', token ? { number: number, token: token } : { number: number, phone: phone }); };
  SCG.quote = function (items, coupon) { return api('POST', '/cart/quote', { items: items, coupon: coupon || null }); };

  /* ---------------- admin ---------------- */
  var synced = null;            // last state the server confirmed (deep copy) — used to work out what changed
  var listeners = [];
  SCG.onSync = function (fn) { listeners.push(fn); };
  function emit(state, info) { listeners.forEach(function (fn) { try { fn(state, info); } catch (e) {} }); }
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  function snap(d) { return copy({ settings: d.settings, categories: d.categories, collections: d.collections, hero: d.hero, products: d.products }); }
  function applyState(st) {
    var c = SCG.load();
    if (c.placeholder) { delete c.placeholder; }
    ['settings', 'categories', 'collections', 'hero', 'products', 'shops', 'me'].forEach(function (k) { c[k] = st[k]; });
    SCG.setCache(c);
    synced = snap(c);
    return c;
  }
  SCG.adminState = function () { return api('GET', '/admin/state').then(applyState); };
  SCG.adminBoot = function () {
    return api('GET', '/admin/auth/session').then(function (s) {
      SCG.staff = s.staff;
      if (s.staff.mustChangePassword || s.staff.needsMfa || s.staff.needsPin) return s.staff;   // second step not done yet: the database refuses admin data until it is
      return SCG.adminState().then(function () { return s.staff; });
    }, function () { return null; });
  };
  SCG.adminLogin = function (username, password) {
    return api('POST', '/admin/auth/login', { username: username, password: password }).then(function (r) {
      return SCG.adminBoot();
    });
  };
  SCG.adminLogout = function () { return api('POST', '/admin/auth/logout', {}).catch(function () {}).then(function () { tokens.staff = ''; }); };

  // ---- photos: upload data: URLs made by the admin's image picker, replace them with the uploaded URL ----
  function dataUrlToBlob(u) {
    var parts = u.split(','), mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  var uploaded = {};
  function upload(u) {
    if (uploaded[u]) return Promise.resolve(uploaded[u]);
    var fd = new FormData(); var b = dataUrlToBlob(u);
    fd.append('file', b, 'photo.' + (b.type.split('/')[1] || 'jpg'));
    return api('POST', '/admin/uploads', fd).then(function (r) { uploaded[u] = r.url; return r.url; });
  }
  function uploadAll(d) {
    var jobs = [];
    function fix(obj, key) { var v = obj && obj[key]; if (typeof v === 'string' && v.indexOf('data:image/') === 0) jobs.push(upload(v).then(function (url) { obj[key] = url; })); }
    d.products.forEach(function (p) { (p.images || []).forEach(function (_, i) { fix(p.images, i); }); fix(p, 'image'); });
    d.categories.forEach(function (c) { fix(c, 'image'); });
    d.collections.forEach(function (c) { fix(c, 'image'); });
    d.hero.forEach(function (h) { fix(h, 'image'); });
    return Promise.all(jobs).then(function () { d.products.forEach(function (p) { if (p.images && p.images.length) p.image = p.images[0]; }); });
  }

  // ---- what the server stores for each kind of record ----
  var LOCAL_ONLY = { adminUser: 1, adminPass: 1, adminPassHash: 1, adminSalt: 1, adminDefault: 1, paymentMethods: 1 };   // never sent (old browser-only login, derived list)
  function productBody(p) {
    var imgs = (p.images && p.images.length ? p.images : (p.image ? [p.image] : [])).filter(function (u) { return /^(https?:\/\/|\/)/.test(u); });
    return { id: p.id, name: p.name, category: p.category, brand: p.brand || '', description: p.description || '', badge: p.badge || '', price: +p.price, comparePrice: +p.comparePrice || 0,
      color: p.color || '#0b2a6f', accent: p.accent || '', shape: p.shape || 'tshirt', pattern: p.pattern || 'solid', origin: p.origin || 'local', sizes: p.sizes || [],
      collections: p.collections || [], images: imgs.slice(0, 8), featured: !!p.featured, flash: !!p.flash, status: p.status || 'active' };
  }
  var catBody = function (c) { return { name: c.name, tagline: c.tagline || '', shape: c.shape || 'tshirt', icon: c.icon || '#0b2a6f', image: /^(https?:\/\/|\/)/.test(c.image || '') ? c.image : '', hidden: !!c.hidden }; };
  var colBody = function (c) { var b = { name: c.name, description: c.description || '', accent: c.accent || '#0b2a6f', image: /^(https?:\/\/|\/)/.test(c.image || '') ? c.image : '', homeRow: !!c.homeRow }; if (c.order) b.order = c.order; return b; };
  var bannerBody = function (h) { return { id: h.id, eyebrow: h.eyebrow || '', title: h.title || '', subtitle: h.subtitle || '', cta: h.cta || '', link: h.link || '#', color: h.color || '#0b2a6f', shape: h.shape || 'tshirt', image: /^(https?:\/\/|\/)/.test(h.image || '') ? h.image : '', style: h.style === 'poster' ? 'poster' : 'card' }; };
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  var byId = function (list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; };

  function push() {
    var cur = SCG.load(), old = synced;
    if (!old) return Promise.resolve();
    var steps = [];
    return uploadAll(cur).then(function () {
      // settings (partial)
      var ch = {};
      Object.keys(cur.settings).forEach(function (k) { if (!(k in LOCAL_ONLY) && !same(cur.settings[k], old.settings[k])) ch[k] = cur.settings[k]; });
      if (Object.keys(ch).length) steps.push(function () { return api('PUT', '/admin/settings', ch); });
      // banners (whole list)
      if (!same(cur.hero.map(bannerBody), old.hero.map(bannerBody))) steps.push(function () { return api('PUT', '/admin/banners', cur.hero.map(bannerBody)); });
      // categories
      var oc = byId(old.categories);
      cur.categories.forEach(function (c) { if (!oc[c.id] || !same(catBody(c), catBody(oc[c.id]))) steps.push(function () { return api('PUT', '/admin/categories/' + encodeURIComponent(c.id), catBody(c)); }); });
      var ncIds = cur.categories.map(function (c) { return c.id; });
      old.categories.forEach(function (c) { if (ncIds.indexOf(c.id) < 0) steps.push(function () { return api('DELETE', '/admin/categories/' + encodeURIComponent(c.id)); }); });
      if (!same(ncIds, old.categories.map(function (c) { return c.id; }).filter(function (id) { return ncIds.indexOf(id) > -1; })))
        steps.push(function () { return api('PUT', '/admin/categories-order', { slugs: ncIds }); });
      // products
      var op = byId(old.products), np = byId(cur.products);
      cur.products.forEach(function (p) {
        if (!op[p.id]) {
          steps.push(function () {
            var body = productBody(p);
            if (p.stockBySize) body.stockBySize = p.stockBySize; else body.stock = Math.max(0, Math.floor(+p.stock || 0));
            return api('POST', '/admin/products', body).then(function (saved) { renameProduct(cur, p.id, saved.id); merge(p, saved); });
          });
          return;
        }
        if (!same(productBody(p), productBody(op[p.id]))) steps.push(function () { return api('PUT', '/admin/products/' + encodeURIComponent(p.id), productBody(p)).then(function (s) { merge(p, s); }); });
        if (p.stockBySize) steps.push(function () { var m = p.stockBySize; delete p.stockBySize; return api('PUT', '/admin/products/' + encodeURIComponent(p.id) + '/stock', { stock: m }).then(function (s) { merge(p, s); }); });
        else if (+p.stock !== +op[p.id].stock) steps.push(function () { return api('PUT', '/admin/products/' + encodeURIComponent(p.id) + '/stock', { total: Math.max(0, Math.floor(+p.stock || 0)) }).then(function (s) { merge(p, s); }); });
      });
      old.products.forEach(function (p) { if (!np[p.id]) steps.push(function () { return api('DELETE', '/admin/products/' + encodeURIComponent(p.id)); }); });
      // collections (after products so new products exist for ordering)
      var ocol = byId(old.collections);
      cur.collections.forEach(function (c) { if (!ocol[c.id] || !same(colBody(c), colBody(ocol[c.id]))) steps.push(function () { return api('PUT', '/admin/collections/' + encodeURIComponent(c.id), colBody(c)); }); });
      var ncol = byId(cur.collections);
      old.collections.forEach(function (c) { if (!ncol[c.id]) steps.push(function () { return api('DELETE', '/admin/collections/' + encodeURIComponent(c.id)); }); });
      return steps.reduce(function (pr, f) { return pr.then(f); }, Promise.resolve()).then(function () { synced = snap(cur); return steps.length; });
    });
  }
  function merge(p, saved) { ['id', 'stock', 'variants', 'sizes', 'images', 'image', 'sold', 'rating', 'reviews', 'createdAt', 'stockDetail'].forEach(function (k) { if (saved && saved[k] !== undefined) p[k] = saved[k]; }); }
  function renameProduct(d, from, to) {
    if (!to || from === to) return;
    d.collections.forEach(function (c) { if (c.order) c.order = c.order.map(function (x) { return x === from ? to : x; }); });
  }
  var queue = Promise.resolve(), pending = 0;
  SCG.sync = function () {
    if (!synced) return false;
    pending++; emit('saving');
    queue = queue.then(push).then(function (n) {
      pending--; if (!pending) emit('saved', n);
    }, function (err) {
      pending--;
      emit('error', err);
      return SCG.adminState().catch(function () {}).then(function () { emit('reverted'); });   // show what the server really has
    });
    return true;
  };
  SCG.syncing = function () { return pending > 0; };
  SCG.whenSynced = function () { return queue; };

  /* ---------------- start-up ---------------- */
  if (SB && !IS_ADMIN) SB.takeAuthRedirect();   // email links (confirm / reset) carry a session in the address
  SCG.ready = IS_ADMIN ? Promise.resolve() : Promise.all([SCG.refresh(), SCG.loadCustomer()]);
  SCG.whenReady = function (fn) {
    SCG.ready.then(fn, function (err) {
      var app = document.getElementById('app');
      if (app) app.innerHTML = '<div class="container" style="padding:60px 16px;text-align:center"><h2>The shop is taking a short break</h2><p class="muted">' +
        SCG.escapeHTML(err && err.message || 'Please try again in a moment.') + '</p><p><button class="btn" onclick="location.reload()">Try again</button></p></div>';
    });
  };
})(window);
