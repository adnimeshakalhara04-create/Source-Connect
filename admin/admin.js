/* =========================================================
   Source Connect Global — Seller Center (admin panel)
   Every part of the storefront is editable from here.
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = SCG.escapeHTML, money = SCG.money;
  var db = SCG.load();
  var SESSION = 'scg_admin_session';
  var MIN_PER_CATEGORY = 10;
  var BADGES = ['', 'New', 'Best Seller', 'Flash Sale', 'Limited', 'Hot'];
  var STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Arrived in Sri Lanka', 'Delivered', 'Cancelled'];
  var ICONS = ['bolt', 'plane', 'tag', 'star', 'cash', 'truck', 'swap', 'pin', 'shield', 'globe', 'box', 'heart'];
  var SITE = '../';

  /* ---------------- auth ---------------- */
  function loggedIn() { try { return sessionStorage.getItem(SESSION) === '1'; } catch (e) { return false; } }
  function showApp() { $('#login').hidden = true; $('#shell').hidden = false; route(); }
  $('#loginForm').onsubmit = function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.elements.user.value === db.settings.adminUser && f.elements.pass.value === db.settings.adminPass) {
      try { sessionStorage.setItem(SESSION, '1'); } catch (err) {}
      showApp();
    } else $('#loginErr').textContent = 'Incorrect username or password.';
  };
  $('#logout').onclick = function () { try { sessionStorage.removeItem(SESSION); } catch (e) {} location.hash = ''; location.reload(); };
  $('#menuBtn').onclick = function (e) { e.stopPropagation(); $('#side').classList.toggle('open'); };
  document.addEventListener('click', function (e) { if (!e.target.closest('#side') && !e.target.closest('#menuBtn')) $('#side').classList.remove('open'); });

  /* ---------------- helpers ---------------- */
  var tt;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function commit(msg) { if (SCG.save()) { toast(msg || 'Saved'); return true; } return false; }
  function openModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').classList.add('open'); }
  function closeModal() { $('#modal').classList.remove('open'); }
  $('#modal').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  function setActions(html) { $('#topActions').innerHTML = html || ''; }
  function preview(hash, label) { return '<a class="btn" target="_blank" rel="noopener" href="' + SITE + (hash || '') + '">' + (label || 'Preview on site') + ' ↗</a>'; }
  function thumb(p, color) { return '<div class="thumb" style="background:' + SCG.shade(color || p.color || '#0b2a6f', 165) + '">' + SCG.productVisual(p, color) + '</div>'; }
  function countIn(catId) { return db.products.filter(function (p) { return p.category === catId; }).length; }
  function orders() { return SCG.getOrders(); }
  function updatePill() { var n = orders().filter(function (o) { return o.status === 'Pending'; }).length; $('#orderPill').textContent = n || ''; }
  function statusTag(s) { return '<span class="tag ' + ({ Pending: 'warn', Delivered: 'ok', Cancelled: 'red' }[s] || '') + '">' + esc(s) + '</span>'; }
  function sw(name, on, label) { return '<label class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><i></i>' + (label || '') + '</label>'; }
  function waNumber(phone) { var d = String(phone || '').replace(/\D/g, ''); if (d.indexOf('0') === 0) d = '94' + d.slice(1); return d; }
  function bindUploader(root, current, onChange) {
    var file = $('input[type=file]', root), prev = $('.preview', root);
    file.onchange = function () {
      if (!file.files[0]) return;
      SCG.imageToDataURL(file.files[0], 900).then(function (url) { prev.innerHTML = '<img src="' + url + '" alt="">'; onChange(url); })
        .catch(function () { toast('Could not read that image'); });
    };
    var rm = $('[data-rm-img]', root);
    if (rm) rm.onclick = function () { onChange(''); prev.innerHTML = current(); file.value = ''; };
  }

  /* Repeater: an editable list of rows. fields: [{k, label, type, options, w}] */
  function repeater(el, items, fields, blank) {
    var cols = fields.map(function (f) { return f.w || '1fr'; }).join(' ') + ' auto';
    function rowHTML(it) {
      return '<div class="rep-row" style="grid-template-columns:' + cols + '">' + fields.map(function (f) {
        var v = it[f.k];
        if (f.type === 'checkbox') return '<label style="align-self:center">' + sw(f.k, !!v, f.label) + '</label>';
        if (f.type === 'select') return '<label>' + f.label + '<select data-k="' + f.k + '">' + f.options.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label>';
        if (f.type === 'textarea') return '<label>' + f.label + '<textarea data-k="' + f.k + '" rows="2">' + esc(v || '') + '</textarea></label>';
        return '<label>' + f.label + '<input data-k="' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(v == null ? '' : v) + '"></label>';
      }).join('') + '<div class="tools"><button type="button" data-up title="Move up">↑</button><button type="button" data-down title="Move down">↓</button><button type="button" class="del" data-del title="Remove">✕</button></div></div>';
    }
    el.innerHTML = '<div class="rep">' + items.map(rowHTML).join('') + '</div><button type="button" class="btn sm rep-add" style="margin-top:8px">+ Add</button>';
    var list = $('.rep', el);
    $('.rep-add', el).onclick = function () { list.insertAdjacentHTML('beforeend', rowHTML(JSON.parse(JSON.stringify(blank)))); };
    list.addEventListener('click', function (e) {
      var row = e.target.closest('.rep-row'); if (!row) return;
      if (e.target.closest('[data-del]')) row.remove();
      if (e.target.closest('[data-up]') && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      if (e.target.closest('[data-down]') && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    });
    return function collect() {
      return $$('.rep-row', list).map(function (r) {
        var o = {};
        fields.forEach(function (f) {
          if (f.type === 'checkbox') o[f.k] = $('input[name="' + f.k + '"]', r).checked;
          else { var v = $('[data-k="' + f.k + '"]', r).value; o[f.k] = f.type === 'number' ? +v || 0 : v.trim(); }
        });
        return o;
      });
    };
  }

  /* ---------------- router ---------------- */
  var VIEWS = {
    dashboard: { title: 'Dashboard', sub: 'Your store at a glance', render: dashboard },
    orders: { title: 'Orders', sub: 'Orders placed on the website', render: ordersView },
    customers: { title: 'Customers', sub: 'Everyone who has ordered', render: customers },
    products: { title: 'Products', sub: 'Everything listed on the site', render: products },
    flash: { title: 'Flash Sale', sub: 'Countdown, timing and flash deals', render: flashView },
    categories: { title: 'Categories', sub: 'Category menu, grid and filters', render: categories },
    collections: { title: 'Collections', sub: 'China Direct, New Arrivals, Best Sellers…', render: collections },
    homepage: { title: 'Homepage & Globe', sub: 'Globe hero, section order and service icons', render: homepage },
    banners: { title: 'Promo Banners', sub: 'Banners beside the globe and below categories', render: banners },
    header: { title: 'Header & Footer', sub: 'Announcement bar, menu links and footer', render: headerView },
    pages: { title: 'China Direct & FAQ', sub: '“How it works” page and help answers', render: pages },
    settings: { title: 'Store Settings', sub: 'Contact, delivery, payments, login and backup', render: settings }
  };
  var previewGlobe = null;
  function route() {
    if (!loggedIn()) return;
    if (previewGlobe) { previewGlobe.destroy(); previewGlobe = null; }
    var parts = location.hash.replace('#', '').split('/');
    var key = VIEWS[parts[0]] ? parts[0] : (parts[0] === 'hero' ? 'banners' : 'dashboard');
    $$('#sideNav a').forEach(function (a) { a.classList.toggle('active', a.dataset.v === key); });
    $('#viewTitle').textContent = VIEWS[key].title; $('#viewSub').textContent = VIEWS[key].sub;
    $('#side').classList.remove('open');
    var v = $('#view'); v.onclick = null; v.onchange = null; v.oninput = null;
    v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
    setActions('');
    VIEWS[key].render(v, decodeURIComponent(parts.slice(1).join('/')));
    updatePill();
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
     DASHBOARD
     ========================================================= */
  function dashboard(v) {
    var os = orders(), live = os.filter(function (o) { return o.status !== 'Cancelled'; });
    var revenue = live.reduce(function (s, o) { return s + o.total; }, 0);
    var low = db.products.filter(function (p) { return p.stock <= 5; });
    var flashN = db.products.filter(function (p) { return p.flash; }).length;
    var max = Math.max.apply(null, db.categories.map(function (c) { return countIn(c.id); }).concat([1]));
    var days = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 6; i >= 0; i--) { var d = new Date(today); d.setDate(d.getDate() - i); days.push({ d: d, total: 0, n: 0 }); }
    live.forEach(function (o) { var od = new Date(o.date); od.setHours(0, 0, 0, 0); days.forEach(function (x) { if (+x.d === +od) { x.total += o.total; x.n++; } }); });
    var dmax = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
    var top = db.products.slice().sort(function (a, b) { return b.sold - a.sold; }).slice(0, 6);
    setActions('<a class="btn primary" href="#products/new">+ Add Product</a>' + preview('', 'View website'));
    v.innerHTML =
      '<div class="stats">' +
      stat('Revenue', money(revenue), '#f59e0b') + stat('Orders', os.length, '#0f766e') +
      stat('Pending', os.filter(function (o) { return o.status === 'Pending'; }).length, '#d97706') +
      stat('Products', db.products.length, '#0b2a6f') + stat('Flash deals', flashN, '#d7141a') + stat('Low stock', low.length, '#d7141a') + '</div>' +
      '<div class="cols"><div class="panel"><h3>Sales, last 7 days</h3><div class="chart">' + days.map(function (x) {
        return '<div class="col"><div class="bar" style="height:' + Math.max(1, x.total / dmax * 100) + '%" title="' + money(x.total) + '"></div><b>' + (x.total ? (x.total / 1000).toFixed(1) + 'k' : '0') + '</b><small>' + x.d.toLocaleDateString('en', { weekday: 'short' }) + '</small></div>';
      }).join('') + '</div></div>' +
      '<div class="panel"><h3>Orders by status</h3><div class="status-pills">' + STATUSES.map(function (s) {
        return '<a href="#orders/' + encodeURIComponent(s) + '"><b>' + os.filter(function (o) { return o.status === s; }).length + '</b>' + esc(s) + '</a>';
      }).join('') + '</div></div></div>' +
      '<div class="cols"><div class="panel"><h3>Products per category <small>target: at least ' + MIN_PER_CATEGORY + ' each</small></h3><div class="bars">' +
      db.categories.map(function (c) {
        var n = countIn(c.id);
        return '<div class="bar-row"><a href="#products/cat:' + c.id + '">' + esc(c.name) + '</a><div class="bar-track"><i style="width:' + (n / max * 100) + '%"></i></div><b>' + n + '</b></div>' +
          (n < MIN_PER_CATEGORY ? '<div class="warn-text">⚠ ' + esc(c.name) + ' needs ' + (MIN_PER_CATEGORY - n) + ' more item(s)</div>' : '');
      }).join('') + '</div></div>' +
      '<div class="panel"><h3>Top selling products</h3><div class="top-list">' + top.map(function (p) {
        return '<a href="#products/edit:' + p.id + '">' + thumb(p) + '<span>' + esc(p.name) + '<br><small class="muted">' + money(p.price) + '</small></span><b>' + p.sold + ' sold</b></a>';
      }).join('') + '</div></div></div>' +
      '<div class="cols"><div class="panel"><h3>Recent orders</h3>' + (os.length ? os.slice(0, 6).map(function (o) {
        return '<a href="#orders/id:' + o.id + '" style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)"><span><b>' + esc(o.id) + '</b><br><small class="muted">' + esc(o.customer.name) + '</small></span><span style="text-align:right">' + money(o.total) + '<br>' + statusTag(o.status) + '</span></a>';
      }).join('') : '<p class="muted">No orders yet. Orders placed on the website appear here.</p>') + '</div>' +
      '<div class="panel"><h3>Low stock <small>5 or fewer</small></h3>' + (low.length ? '<div class="filters">' + low.map(function (p) { return '<a class="tag warn" href="#products/edit:' + p.id + '">' + esc(p.name) + ' · ' + p.stock + '</a>'; }).join('') + '</div>' : '<p class="muted">All products are well stocked.</p>') + '</div></div>';
  }
  function stat(label, val, color) { return '<div class="stat" style="--a:' + color + '"><small>' + label + '</small><b>' + val + '</b></div>'; }

  /* =========================================================
     PRODUCTS (with bulk actions + quick edits)
     ========================================================= */
  var pf = { q: '', cat: 'all', coll: 'all', extra: 'all' };
  function products(v, arg) {
    if (arg && arg.indexOf('cat:') === 0) pf.cat = arg.slice(4);
    var sel = {};
    setActions('<a class="btn primary" href="#products/new">+ Add Product</a>' + preview('#shop'));
    v.innerHTML =
      '<div class="filters"><input id="pq" type="search" placeholder="Search name, brand or SKU…" value="' + esc(pf.q) + '">' +
      '<select id="pc"><option value="all">All categories</option>' + db.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + ' (' + countIn(c.id) + ')</option>'; }).join('') + '</select>' +
      '<select id="pco"><option value="all">All collections</option>' + db.collections.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<select id="px"><option value="all">Any status</option><option value="flash">In flash sale</option><option value="china">China Direct</option><option value="local">Colombo stock</option><option value="low">Low stock (≤5)</option><option value="out">Out of stock</option><option value="nophoto">No photo yet</option></select>' +
      '<span class="muted" id="pcount" style="align-self:center"></span></div>' +
      '<div class="bulkbar" id="bulk" hidden><b id="bn"></b>' +
        '<button class="btn sm" data-b="flash-on">⚡ Add to flash sale</button><button class="btn sm" data-b="flash-off">Remove from flash</button>' +
        '<span style="display:inline-flex;gap:4px"><input id="bdisc" type="number" min="1" max="90" placeholder="% off" style="width:80px"><button class="btn sm" data-b="disc">Apply discount</button></span>' +
        '<button class="btn sm" data-b="china">Ship from China</button><button class="btn sm" data-b="local">Ship from Colombo</button>' +
        '<span style="display:inline-flex;gap:4px"><select id="bcoll">' + db.collections.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select><button class="btn sm" data-b="coll">Add to collection</button></span>' +
        '<button class="btn sm" data-b="del" style="border-color:#f87171">Delete</button><button class="btn sm" data-b="clear">Clear</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th class="chk"><input type="checkbox" id="pall" aria-label="Select all"></th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Ships from</th><th>Flash</th><th></th></tr></thead><tbody id="ptb"></tbody></table></div>';
    $('#pc').value = pf.cat; $('#pco').value = pf.coll; $('#px').value = pf.extra;
    var shown = [];
    function list() {
      var q = pf.q.toLowerCase();
      return db.products.filter(function (p) {
        if (pf.cat !== 'all' && p.category !== pf.cat) return false;
        if (pf.coll !== 'all' && (p.collections || []).indexOf(pf.coll) < 0) return false;
        if (pf.extra === 'flash' && !p.flash) return false;
        if (pf.extra === 'china' && p.origin !== 'china') return false;
        if (pf.extra === 'local' && p.origin === 'china') return false;
        if (pf.extra === 'low' && p.stock > 5) return false;
        if (pf.extra === 'out' && p.stock > 0) return false;
        if (pf.extra === 'nophoto' && p.image) return false;
        return !q || (p.name + ' ' + (p.brand || '') + ' ' + p.id).toLowerCase().indexOf(q) > -1;
      });
    }
    function draw() {
      shown = list();
      $('#pcount').textContent = shown.length + ' items';
      $('#ptb').innerHTML = shown.map(function (p) {
        var c = SCG.categoryById(p.category), off = SCG.discount(p);
        return '<tr data-id="' + p.id + '" class="' + (sel[p.id] ? 'sel' : '') + '"><td class="chk"><input type="checkbox" data-sel' + (sel[p.id] ? ' checked' : '') + ' aria-label="Select"></td>' +
          '<td><div class="prod-cell">' + thumb(p) + '<div><b>' + esc(p.name) + '</b><small>' + esc(p.brand || '') + ' · ' + esc(p.id) + '</small></div></div></td>' +
          '<td>' + esc(c ? c.name : '—') + '</td>' +
          '<td><input class="inline" type="number" min="0" step="10" data-f="price" value="' + p.price + '" aria-label="Price">' + (off ? '<br><small class="muted"><s>' + money(p.comparePrice) + '</s> -' + off + '%</small>' : '') + '</td>' +
          '<td><input class="inline" type="number" min="0" data-f="stock" value="' + p.stock + '" aria-label="Stock" style="width:64px' + (p.stock <= 5 ? ';border-color:#f59e0b' : '') + '"></td>' +
          '<td><select data-f="origin" style="width:auto;padding:6px"><option value="china"' + (p.origin === 'china' ? ' selected' : '') + '>China</option><option value="local"' + (p.origin !== 'china' ? ' selected' : '') + '>Colombo</option></select></td>' +
          '<td>' + sw('flash', p.flash) + '</td>' +
          '<td><div class="actions"><a class="btn sm" target="_blank" rel="noopener" href="' + SITE + '#p/' + p.id + '" title="View on site">↗</a><button class="btn sm" data-edit>Edit</button><button class="btn sm" data-dup>Copy</button><button class="btn sm danger" data-del>Delete</button></div></td></tr>';
      }).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:40px">No products found.</td></tr>';
      bulkUI();
    }
    function ids() { return Object.keys(sel).filter(function (k) { return sel[k]; }); }
    function bulkUI() { var n = ids().length; $('#bulk').hidden = !n; $('#bn').textContent = n + ' selected'; $('#pall').checked = shown.length && shown.every(function (p) { return sel[p.id]; }); }
    function prod(id) { return SCG.productById(id); }

    $('#pq').oninput = function (e) { pf.q = e.target.value; draw(); };
    $('#pc').onchange = function (e) { pf.cat = e.target.value; draw(); };
    $('#pco').onchange = function (e) { pf.coll = e.target.value; draw(); };
    $('#px').onchange = function (e) { pf.extra = e.target.value; draw(); };
    $('#pall').onchange = function (e) { shown.forEach(function (p) { sel[p.id] = e.target.checked; }); draw(); };
    $('#ptb').addEventListener('change', function (e) {
      var tr = e.target.closest('tr'); if (!tr) return; var p = prod(tr.dataset.id);
      if (e.target.matches('[data-sel]')) { sel[p.id] = e.target.checked; tr.classList.toggle('sel', e.target.checked); bulkUI(); return; }
      if (e.target.name === 'flash') { p.flash = e.target.checked; if (p.flash && !p.comparePrice) { p.comparePrice = Math.round(p.price * 1.3 / 10) * 10; } commit(p.flash ? 'Added to flash sale' : 'Removed from flash sale'); return; }
      var f = e.target.dataset.f; if (!f) return;
      p[f] = f === 'origin' ? e.target.value : Math.max(0, +e.target.value || 0);
      commit('Updated ' + p.name);
    });
    $('#ptb').addEventListener('click', function (e) {
      var tr = e.target.closest('tr'), b = e.target.closest('button'); if (!tr || !b) return;
      var p = prod(tr.dataset.id);
      if (b.hasAttribute('data-edit')) productForm(p.id);
      if (b.hasAttribute('data-dup')) { var c = JSON.parse(JSON.stringify(p)); c.id = SCG.uid(p.category); c.name = p.name + ' (Copy)'; c.createdAt = Date.now(); c.sold = 0; db.products.unshift(c); commit('Product copied'); draw(); }
      if (b.hasAttribute('data-del') && confirm('Delete "' + p.name + '"? This cannot be undone.')) { db.products = db.products.filter(function (x) { return x.id !== p.id; }); delete sel[p.id]; commit('Product deleted'); draw(); }
    });
    $('#bulk').onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return;
      var list = ids().map(prod).filter(Boolean), act = b.dataset.b;
      if (act === 'clear') { sel = {}; draw(); return; }
      if (act === 'disc' && !(+$('#bdisc').value)) { toast('Enter a discount % first'); return; }
      if (act === 'del') { if (!confirm('Delete ' + list.length + ' products? This cannot be undone.')) return; var gone = ids(); db.products = db.products.filter(function (p) { return gone.indexOf(p.id) < 0; }); sel = {}; }
      list.forEach(function (p) {
        if (act === 'flash-on') { p.flash = true; if (!p.comparePrice) p.comparePrice = Math.round(p.price * 1.3 / 10) * 10; }
        if (act === 'flash-off') p.flash = false;
        if (act === 'china') p.origin = 'china';
        if (act === 'local') p.origin = 'local';
        if (act === 'coll') { var c = $('#bcoll').value; p.collections = p.collections || []; if (p.collections.indexOf(c) < 0) p.collections.push(c); }
        if (act === 'disc') {
          var pct = Math.min(90, Math.max(1, +$('#bdisc').value || 0));
          var base = p.comparePrice > p.price ? p.comparePrice : p.price;
          p.comparePrice = base; p.price = Math.round(base * (1 - pct / 100) / 10) * 10;
        }
      });
      commit(list.length + ' products updated'); draw();
    };
    draw();
    if (arg === 'new') productForm(null);
    if (arg && arg.indexOf('edit:') === 0) productForm(arg.slice(5));
  }

  function productForm(id) {
    var p = id ? SCG.productById(id) : null, isNew = !p;
    var d = p ? JSON.parse(JSON.stringify(p)) : {
      name: '', category: pf.cat !== 'all' ? pf.cat : db.categories[0].id, collections: [], price: 0, comparePrice: 0, stock: 20,
      color: '#0b2a6f', accent: '#f3f4f6', shape: '', pattern: 'solid', brand: 'SC Global', origin: 'china', flash: false,
      rating: 4.5, reviews: 0, sold: 0, image: '', sizes: ['S', 'M', 'L', 'XL', 'XXL'], badge: 'New', featured: false, description: ''
    };
    function curShape() { var c = SCG.categoryById(d.category); return d.shape || (c ? c.shape : 'tshirt'); }
    function prev() { return d.image ? '<img src="' + d.image + '" alt="">' : SCG.productSVG(curShape(), d.color, d.pattern, d.accent); }
    openModal(isNew ? 'Add Product' : 'Edit Product',
      '<form class="form" id="pform">' +
      '<label class="full">Product name<input name="name" required value="' + esc(d.name) + '" placeholder="e.g. Classic Crew Tee"></label>' +
      '<label>Category<select name="category">' + db.categories.map(function (c) { return '<option value="' + c.id + '"' + (c.id === d.category ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Brand<input name="brand" value="' + esc(d.brand || '') + '"></label>' +
      '<label>Price (' + esc(db.settings.currency) + ')<input name="price" type="number" min="0" step="10" required value="' + d.price + '"></label>' +
      '<label>Original price (before discount)<input name="comparePrice" type="number" min="0" step="10" placeholder="Optional, shows -% off" value="' + (d.comparePrice || '') + '"></label>' +
      '<label>Stock quantity<input name="stock" type="number" min="0" required value="' + d.stock + '"></label>' +
      '<label>Ships from<select name="origin"><option value="china"' + (d.origin === 'china' ? ' selected' : '') + '>China Direct (' + esc(db.settings.chinaDays) + ' days)</option><option value="local"' + (d.origin !== 'china' ? ' selected' : '') + '>Colombo stock (' + esc(db.settings.localDays) + ' days)</option></select></label>' +
      '<label>Badge<select name="badge">' + BADGES.map(function (b) { return '<option' + (b === d.badge ? ' selected' : '') + ' value="' + b + '">' + (b || 'None') + '</option>'; }).join('') + '</select></label>' +
      '<label>Rating (0–5)<input name="rating" type="number" min="0" max="5" step="0.1" value="' + (d.rating || 0) + '"></label>' +
      '<label>Ratings count<input name="reviews" type="number" min="0" value="' + (d.reviews || 0) + '"></label>' +
      '<label>Units sold<input name="sold" type="number" min="0" value="' + (d.sold || 0) + '"></label>' +
      '<label class="full">Sizes (comma separated, leave empty for bags and watches)<input name="sizes" value="' + esc((d.sizes || []).join(', ')) + '"></label>' +
      '<div class="full"><label style="margin-bottom:8px">Collections</label><div class="checks">' + db.collections.map(function (c) {
        return '<label><input type="checkbox" name="collections" value="' + c.id + '"' + ((d.collections || []).indexOf(c.id) > -1 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
      }).join('') + '</div></div>' +
      '<div class="full"><label style="margin-bottom:8px">Product photo</label><div class="uploader" id="pup"><div class="preview">' + prev() + '</div><div class="btns">' +
      '<input type="file" accept="image/*"><button type="button" class="btn sm danger" data-rm-img>Remove photo</button>' +
      '<span class="hint">No photo? The illustration below is shown instead. Photos are auto-resized.</span></div></div></div>' +
      '<label>Illustration<select name="shape"><option value="">Same as category</option>' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (s === d.shape ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Pattern<select name="pattern">' + SCG.PATTERNS.map(function (s) { return '<option' + (s === (d.pattern || 'solid') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Main colour<input name="color" type="color" value="' + esc(d.color) + '"></label>' +
      '<label>Accent colour<input name="accent" type="color" value="' + esc(d.accent || '#f3f4f6') + '"></label>' +
      '<label class="full">Description<textarea name="description" rows="3">' + esc(d.description) + '</textarea></label>' +
      '<div class="full" style="display:flex;gap:18px;flex-wrap:wrap">' + sw('flash', d.flash, 'Show in Flash Sale') + sw('featured', d.featured, 'Featured') + '</div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">' + (isNew ? 'Add Product' : 'Save Changes') + '</button></div></form>');
    var f = $('#pform'), E = f.elements;
    bindUploader($('#pup'), prev, function (url) { d.image = url; });
    E.category.onchange = E.color.oninput = E.accent.oninput = E.shape.onchange = E.pattern.onchange = function () {
      d.category = E.category.value; d.color = E.color.value; d.accent = E.accent.value; d.shape = E.shape.value; d.pattern = E.pattern.value;
      if (!d.image) $('#pup .preview').innerHTML = prev();
    };
    f.onsubmit = function (e) {
      e.preventDefault();
      var out = Object.assign(d, {
        name: E.name.value.trim(), category: E.category.value, badge: E.badge.value, brand: E.brand.value.trim(),
        price: +E.price.value || 0, comparePrice: +E.comparePrice.value || 0, stock: +E.stock.value || 0,
        color: E.color.value, accent: E.accent.value, shape: E.shape.value, pattern: E.pattern.value, origin: E.origin.value,
        rating: Math.min(5, +E.rating.value || 0), reviews: +E.reviews.value || 0, sold: +E.sold.value || 0,
        sizes: E.sizes.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        collections: $$('input[name=collections]:checked', f).map(function (x) { return x.value; }),
        description: E.description.value.trim(), featured: E.featured.checked, flash: E.flash.checked
      });
      if (isNew) { out.id = SCG.uid(out.category); out.createdAt = Date.now(); db.products.unshift(out); }
      else db.products[db.products.indexOf(p)] = out;
      if (!commit(isNew ? 'Product added' : 'Product updated')) return;
      closeModal();
      var back = location.hash.indexOf('#flash') === 0 ? 'flash' : 'products';
      if (location.hash !== '#' + back) location.hash = back; else route();
    };
  }

  /* =========================================================
     FLASH SALE
     ========================================================= */
  function flashView(v) {
    var s = db.settings, list = db.products.filter(function (p) { return p.flash; });
    setActions(preview('#flash', 'View flash sale'));
    var untilVal = '';
    if (s.flashUntil) { var u = new Date(s.flashUntil); if (!isNaN(u)) untilVal = new Date(u - u.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }
    v.innerHTML =
      '<div class="grid2"><form class="panel" id="ff"><h3>Timing &amp; title</h3><div class="form">' +
        '<label class="full">Section title<input name="flashTitle" value="' + esc(s.flashTitle || 'Flash Sale') + '"></label>' +
        '<div class="full checks">' +
          '<label><input type="radio" name="flashMode" value="daily"' + (s.flashMode === 'daily' || !s.flashMode ? ' checked' : '') + '> Every day (countdown resets at midnight)</label>' +
          '<label><input type="radio" name="flashMode" value="until"' + (s.flashMode === 'until' ? ' checked' : '') + '> Ends at a set date &amp; time</label>' +
          '<label><input type="radio" name="flashMode" value="off"' + (s.flashMode === 'off' ? ' checked' : '') + '> Turned off (hidden on the site)</label></div>' +
        '<label class="full">End date &amp; time<input type="datetime-local" name="flashUntil" value="' + esc(untilVal) + '"></label>' +
        '<div class="form-foot"><button class="btn primary">Save timing</button></div></div></form>' +
      '<div class="panel"><h3>Quick actions</h3><p class="muted" style="margin-top:0">' + list.length + ' products are in the flash sale.</p>' +
        '<div class="filters"><input id="fpct" type="number" min="1" max="90" placeholder="% off" style="min-width:0;width:100px"><button class="btn" id="fapply">Apply % to all flash products</button></div>' +
        '<div class="filters"><button class="btn" id="fadd">+ Add products to flash sale</button><button class="btn danger" id="fclear">Remove all from flash</button></div></div></div>' +
      '<div class="panel" style="padding:0;overflow:hidden"><div class="table-wrap" style="border:0"><table><thead><tr><th>Product</th><th>Flash price</th><th>Original price</th><th>Discount</th><th>Stock</th><th></th></tr></thead><tbody id="ftb">' +
      (list.length ? list.map(function (p) {
        return '<tr data-id="' + p.id + '"><td><div class="prod-cell">' + thumb(p) + '<b>' + esc(p.name) + '</b></div></td>' +
          '<td><input class="inline" type="number" min="0" step="10" data-f="price" value="' + p.price + '"></td>' +
          '<td><input class="inline" type="number" min="0" step="10" data-f="comparePrice" value="' + (p.comparePrice || '') + '"></td>' +
          '<td><span class="tag red">-' + SCG.discount(p) + '%</span></td><td>' + p.stock + '</td>' +
          '<td><div class="actions"><button class="btn sm" data-edit>Edit</button><button class="btn sm danger" data-rm>Remove</button></div></td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:40px">No flash deals yet. Click “Add products to flash sale”.</td></tr>') + '</tbody></table></div></div>';
    $('#ff').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      var mode = $('input[name=flashMode]:checked', e.target).value;
      var until = E.flashUntil.value ? new Date(E.flashUntil.value).toISOString() : '';
      if (mode === 'until' && !until) { toast('Pick an end date & time'); return; }
      s.flashTitle = E.flashTitle.value.trim() || 'Flash Sale'; s.flashMode = mode; s.flashUntil = until;
      commit('Flash sale timing saved');
    };
    $('#ftb').addEventListener('change', function (e) {
      var tr = e.target.closest('tr'), f = e.target.dataset.f; if (!tr || !f) return;
      var p = SCG.productById(tr.dataset.id); p[f] = +e.target.value || 0; commit('Price updated'); route();
    });
    $('#ftb').addEventListener('click', function (e) {
      var tr = e.target.closest('tr'), b = e.target.closest('button'); if (!tr || !b) return;
      var p = SCG.productById(tr.dataset.id);
      if (b.hasAttribute('data-rm')) { p.flash = false; commit('Removed from flash sale'); route(); }
      if (b.hasAttribute('data-edit')) productForm(p.id);
    });
    $('#fapply').onclick = function () {
      var pct = Math.min(90, +$('#fpct').value || 0); if (!pct) { toast('Enter a % first'); return; }
      list.forEach(function (p) { var base = p.comparePrice > p.price ? p.comparePrice : p.price; p.comparePrice = base; p.price = Math.round(base * (1 - pct / 100) / 10) * 10; });
      commit(pct + '% off applied to ' + list.length + ' products'); route();
    };
    $('#fclear').onclick = function () { if (!list.length || !confirm('Remove all ' + list.length + ' products from the flash sale?')) return; list.forEach(function (p) { p.flash = false; }); commit('Flash sale cleared'); route(); };
    $('#fadd').onclick = function () {
      var others = db.products.filter(function (p) { return !p.flash; });
      openModal('Add to Flash Sale', '<input id="fs" placeholder="Search products…" style="margin-bottom:10px"><div class="checks" id="fl" style="max-height:340px;overflow:auto">' +
        others.map(function (p) { return '<label data-n="' + esc(p.name.toLowerCase()) + '"><input type="checkbox" value="' + p.id + '"> ' + esc(p.name) + ' <span class="muted">' + money(p.price) + '</span></label>'; }).join('') +
        '</div><div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><input id="fpct2" type="number" min="0" max="90" placeholder="% off (optional)" style="width:160px"><button class="btn primary" id="fok">Add selected</button></div>');
      $('#fs').oninput = function (e) { var q = e.target.value.toLowerCase(); $$('#fl label').forEach(function (l) { l.hidden = l.dataset.n.indexOf(q) < 0; }); };
      $('#fok').onclick = function () {
        var pct = Math.min(90, +$('#fpct2').value || 0), chosen = $$('#fl input:checked').map(function (x) { return SCG.productById(x.value); });
        if (!chosen.length) { toast('Tick at least one product'); return; }
        chosen.forEach(function (p) { p.flash = true; if (pct) { var base = p.comparePrice > p.price ? p.comparePrice : p.price; p.comparePrice = base; p.price = Math.round(base * (1 - pct / 100) / 10) * 10; } else if (!p.comparePrice) p.comparePrice = Math.round(p.price * 1.3 / 10) * 10; });
        commit(chosen.length + ' added to flash sale'); closeModal(); route();
      };
    };
  }

  /* =========================================================
     CATEGORIES
     ========================================================= */
  function categories(v) {
    setActions('<button class="btn primary" id="addCat">+ Add Category</button>' + preview('#categories'));
    v.innerHTML = '<p class="muted" style="margin-top:0">Categories appear in the header menu, the homepage sidebar and grid, the search box and the filters. Use ↑ ↓ to change their order.</p><div class="cards">' + db.categories.map(function (c, i) {
      var n = countIn(c.id), color = c.icon || '#0b2a6f';
      return '<div class="item-card"><div class="cover" style="background:radial-gradient(circle,' + SCG.shade(color, 170) + ',' + SCG.shade(color, 110) + ')">' + SCG.productSVG(c.shape, color, 'solid', '#f3f4f6') + '</div>' +
        '<div class="body"><h4>' + esc(c.name) + '</h4><p>' + esc(c.tagline || '') + '</p><p style="margin-top:8px"><span class="tag ' + (n < MIN_PER_CATEGORY ? 'warn' : 'ok') + '">' + n + ' products</span></p></div>' +
        '<div class="foot"><button class="btn sm" data-up="' + i + '"' + (i ? '' : ' disabled') + '>↑</button><button class="btn sm" data-down="' + i + '"' + (i < db.categories.length - 1 ? '' : ' disabled') + '>↓</button><a class="btn sm" href="#products/cat:' + c.id + '">Items</a><button class="btn sm" data-edit="' + c.id + '">Edit</button><button class="btn sm danger" data-del="' + c.id + '">Delete</button></div></div>';
    }).join('') + '</div>';
    $('#addCat').onclick = function () { catForm(null); };
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var cs = db.categories;
      if (b.dataset.up) { var i = +b.dataset.up; cs.splice(i - 1, 0, cs.splice(i, 1)[0]); commit('Order updated'); route(); }
      if (b.dataset.down) { var j = +b.dataset.down; cs.splice(j + 1, 0, cs.splice(j, 1)[0]); commit('Order updated'); route(); }
      if (b.dataset.edit) catForm(b.dataset.edit);
      if (b.dataset.del) {
        var n = countIn(b.dataset.del);
        if (n) { alert('This category still has ' + n + ' products. Move or delete them first.'); return; }
        if (confirm('Delete this category?')) { db.categories = cs.filter(function (c) { return c.id !== b.dataset.del; }); commit('Category deleted'); route(); }
      }
    };
  }
  function catForm(id) {
    var c = id ? SCG.categoryById(id) : null;
    var d = c ? JSON.parse(JSON.stringify(c)) : { name: '', shape: 'tshirt', icon: '#0b2a6f', tagline: '' };
    function prev() { return SCG.productSVG(d.shape, d.icon || '#0b2a6f', 'solid', '#f3f4f6'); }
    openModal(c ? 'Edit Category' : 'Add Category',
      '<form class="form" id="cform"><label>Name<input name="name" required value="' + esc(d.name) + '"></label>' +
      '<label>Tagline<input name="tagline" value="' + esc(d.tagline || '') + '"></label>' +
      '<label>Icon picture<select name="shape">' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (d.shape === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Icon colour<input type="color" name="icon" value="' + esc(d.icon || '#0b2a6f') + '"></label>' +
      '<div class="full uploader"><div class="preview" id="cprev">' + prev() + '</div><span class="hint">This picture is used in the menu and the category grid.</span></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    var f = $('#cform'), E = f.elements;
    E.shape.onchange = E.icon.oninput = function () { d.shape = E.shape.value; d.icon = E.icon.value; $('#cprev').innerHTML = prev(); };
    f.onsubmit = function (e) {
      e.preventDefault();
      var vals = { name: E.name.value.trim(), shape: E.shape.value, icon: E.icon.value, tagline: E.tagline.value.trim() };
      if (c) Object.assign(c, vals);
      else { vals.id = SCG.slug(vals.name); if (SCG.categoryById(vals.id)) vals.id = SCG.uid(vals.id); db.categories.push(vals); }
      commit('Category saved'); closeModal(); route();
    };
  }

  /* =========================================================
     COLLECTIONS
     ========================================================= */
  function collections(v) {
    setActions('<button class="btn primary" id="addColl">+ Add Collection</button>');
    v.innerHTML = '<p class="muted" style="margin-top:0">Collections are the curated pages like China Direct, New Arrivals and Best Sellers. Link to them from menu links, banners or service icons with <code>#col/collection-id</code>.</p><div class="cards">' + db.collections.map(function (c) {
      var n = db.products.filter(function (p) { return (p.collections || []).indexOf(c.id) > -1; }).length;
      return '<div class="item-card"><div class="cover" style="background:linear-gradient(150deg,' + SCG.shade(c.accent, 40) + ',' + SCG.shade(c.accent, -60) + ')">' +
        (c.image ? '<img src="' + c.image + '" alt="">' : '<b style="font-family:Playfair Display,serif;font-size:24px;padding:0 16px;text-align:center">' + esc(c.name) + '</b>') + '</div>' +
        '<div class="body"><h4>' + esc(c.name) + '</h4><p>' + esc(c.description || '') + '</p><p style="margin-top:8px"><span class="tag">' + n + ' products</span> <code class="muted">#col/' + esc(c.id) + '</code></p></div>' +
        '<div class="foot"><a class="btn sm" target="_blank" rel="noopener" href="' + SITE + '#col/' + c.id + '">View ↗</a><button class="btn sm" data-edit="' + c.id + '">Edit</button><button class="btn sm danger" data-del="' + c.id + '">Delete</button></div></div>';
    }).join('') + '</div>';
    $('#addColl').onclick = function () { collForm(null); };
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) collForm(b.dataset.edit);
      if (b.dataset.del && confirm('Delete this collection? Products stay, they are just untagged.')) {
        var id = b.dataset.del;
        db.collections = db.collections.filter(function (c) { return c.id !== id; });
        db.products.forEach(function (p) { p.collections = (p.collections || []).filter(function (x) { return x !== id; }); });
        commit('Collection deleted'); route();
      }
    };
  }
  function collForm(id) {
    var c = id ? SCG.collectionById(id) : null;
    var d = c ? JSON.parse(JSON.stringify(c)) : { name: '', description: '', accent: '#0b2a6f', image: '' };
    var inColl = db.products.filter(function (p) { return c && (p.collections || []).indexOf(c.id) > -1; }).map(function (p) { return p.id; });
    function prev() { return d.image ? '<img src="' + d.image + '" alt="">' : '<span class="hint">No cover</span>'; }
    openModal(c ? 'Edit Collection' : 'Add Collection',
      '<form class="form" id="coform"><label>Name<input name="name" required value="' + esc(d.name) + '"></label>' +
      '<label>Colour<input type="color" name="accent" value="' + esc(d.accent) + '"></label>' +
      '<label class="full">Description<textarea name="description" rows="2">' + esc(d.description) + '</textarea></label>' +
      '<div class="full"><label style="margin-bottom:8px">Cover image (optional)</label><div class="uploader" id="coup"><div class="preview">' + prev() + '</div><div class="btns"><input type="file" accept="image/*"><button type="button" class="btn sm danger" data-rm-img>Remove</button></div></div></div>' +
      '<div class="full"><label style="margin-bottom:8px">Products in this collection</label><input id="cosearch" placeholder="Filter…" style="margin-bottom:8px"><div class="checks" id="coprods" style="max-height:220px;overflow:auto">' +
      db.products.map(function (p) { return '<label data-n="' + esc(p.name.toLowerCase()) + '"><input type="checkbox" value="' + p.id + '"' + (inColl.indexOf(p.id) > -1 ? ' checked' : '') + '> ' + esc(p.name) + '</label>'; }).join('') + '</div></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    bindUploader($('#coup'), prev, function (u) { d.image = u; });
    $('#cosearch').oninput = function (e) { var q = e.target.value.toLowerCase(); $$('#coprods label').forEach(function (l) { l.hidden = l.dataset.n.indexOf(q) < 0; }); };
    $('#coform').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      d.name = E.name.value.trim(); d.description = E.description.value.trim(); d.accent = E.accent.value;
      if (c) Object.assign(c, d); else { d.id = SCG.slug(d.name); if (SCG.collectionById(d.id)) d.id = SCG.uid(d.id); db.collections.push(d); }
      var chosen = $$('#coprods input:checked').map(function (x) { return x.value; });
      db.products.forEach(function (p) {
        var arr = (p.collections || []).filter(function (x) { return x !== d.id; });
        if (chosen.indexOf(p.id) > -1) arr.push(d.id);
        p.collections = arr;
      });
      commit('Collection saved'); closeModal(); route();
    };
  }

  /* =========================================================
     HOMEPAGE & GLOBE
     ========================================================= */
  function homepage(v) {
    var s = db.settings, cities = (window.SCGGlobe && SCGGlobe.CITIES) || ['Shenzhen', 'Yiwu', 'Shanghai', 'Guangzhou', 'Beijing'];
    setActions(preview('', 'Preview homepage'));
    v.innerHTML =
      '<div class="grid2"><div class="panel"><h3>Globe hero</h3><div class="form" style="grid-template-columns:1fr">' +
        '<label>Headline (new line = second, gold line)<textarea id="hTitle" rows="2">' + esc(s.heroTitle) + '</textarea></label>' +
        '<label>Text under the headline<textarea id="hSub" rows="3">' + esc(s.heroSubtitle) + '</textarea></label>' +
        '<div><label style="margin-bottom:8px">Chinese cities that ship to Colombo</label><div class="checks" id="hCities">' + cities.map(function (c) { return '<label><input type="checkbox" value="' + c + '"' + ((s.globeCities || []).indexOf(c) > -1 ? ' checked' : '') + '> ' + c + '</label>'; }).join('') + '</div></div>' +
      '</div></div>' +
      '<div class="panel"><div class="head"><h3>Live preview</h3><button class="btn sm" id="hPrev">Replay</button></div><div class="globe-prev"><span class="cap">China → Sri Lanka</span><canvas></canvas></div></div></div>' +
      '<div class="grid2"><div class="panel"><h3>Numbers under the headline <small>tick “Live” to count up as parcels arrive</small></h3><div id="hStats"></div></div>' +
      '<div class="panel"><h3>Shipping timeline <small>5 steps along the bottom of the globe</small></h3><div id="hSteps"></div></div></div>' +
      '<div class="panel"><h3>Homepage sections <small>switch on/off, rename and reorder</small></h3><div class="sections" id="hSecs"></div></div>' +
      '<div class="panel"><h3>Quick service icons <small>the round icons under the globe</small></h3><div id="hSvc"></div></div>' +
      '<div class="save-bar"><button class="btn primary" id="hSave">Save homepage</button></div>';

    var getStats = repeater($('#hStats'), s.globeStats || [], [{ k: 'value', label: 'Number' }, { k: 'label', label: 'Label', w: '1.6fr' }, { k: 'live', label: 'Live', type: 'checkbox', w: 'auto' }], { value: '', label: '', live: false });
    var getSteps = repeater($('#hSteps'), s.globeSteps || [], [{ k: 'title', label: 'Step' }, { k: 'text', label: 'Small text', w: '1.4fr' }], { title: '', text: '' });
    var getSvc = repeater($('#hSvc'), s.services || [], [{ k: 'label', label: 'Label', w: '1.3fr' }, { k: 'link', label: 'Opens (e.g. #flash, #c/shoes)', w: '1.4fr' }, { k: 'icon', label: 'Icon', type: 'select', options: ICONS }, { k: 'color', label: 'Colour', type: 'color', w: '70px' }], { label: 'New', link: '#shop', icon: 'tag', color: '#0b2a6f' });

    var secs = JSON.parse(JSON.stringify(s.sections || []));
    function drawSecs() {
      $('#hSecs').innerHTML = '<div class="sec-row" style="background:#f8f9fc"><span style="width:38px"></span><b>Globe hero + promo banners</b><span class="fixed-tag">Always first</span><span></span></div>' +
        secs.map(function (x, i) {
          var titled = x.title !== undefined;
          return '<div class="sec-row' + (x.on ? '' : ' off') + '" data-i="' + i + '"><label class="switch"><input type="checkbox" data-on' + (x.on ? ' checked' : '') + ' aria-label="Show ' + esc(x.name) + '"><i></i></label><b>' + esc(x.name) + '</b>' +
            (titled ? '<input type="text" data-title value="' + esc(x.title) + '" placeholder="Section title" aria-label="Section title">' : '<span class="fixed-tag">—</span>') +
            '<div class="tools"><button type="button" data-u' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button><button type="button" data-d' + (i < secs.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button></div></div>';
        }).join('');
    }
    drawSecs();
    $('#hSecs').addEventListener('click', function (e) {
      var row = e.target.closest('[data-i]'), b = e.target.closest('button'); if (!row || !b) return;
      var i = +row.dataset.i;
      if (b.hasAttribute('data-u')) secs.splice(i - 1, 0, secs.splice(i, 1)[0]);
      if (b.hasAttribute('data-d')) secs.splice(i + 1, 0, secs.splice(i, 1)[0]);
      drawSecs();
    });
    $('#hSecs').addEventListener('change', function (e) { var row = e.target.closest('[data-i]'); if (row && e.target.hasAttribute('data-on')) { secs[+row.dataset.i].on = e.target.checked; row.classList.toggle('off', !e.target.checked); } });
    $('#hSecs').addEventListener('input', function (e) { var row = e.target.closest('[data-i]'); if (row && e.target.hasAttribute('data-title')) secs[+row.dataset.i].title = e.target.value; });

    function chosenCities() { return $$('#hCities input:checked').map(function (x) { return x.value; }); }
    function mountPrev() {
      if (previewGlobe) previewGlobe.destroy();
      if (window.SCGGlobe) previewGlobe = SCGGlobe.mount($('.globe-prev canvas'), { cities: chosenCities(), fit: true });
    }
    mountPrev();
    $('#hPrev').onclick = mountPrev;
    $('#hCities').onchange = mountPrev;
    $('#hSave').onclick = function () {
      s.heroTitle = $('#hTitle').value.trim(); s.heroSubtitle = $('#hSub').value.trim();
      s.globeCities = chosenCities(); s.globeStats = getStats(); s.globeSteps = getSteps().slice(0, 5);
      s.services = getSvc(); s.sections = secs;
      commit(s.globeCities.length ? 'Homepage saved' : 'Saved. No cities ticked, so no routes will show.');
    };
  }

  /* =========================================================
     PROMO BANNERS
     ========================================================= */
  function banners(v) {
    setActions('<button class="btn primary" id="addHero">+ Add Banner</button>' + preview('', 'Preview homepage'));
    v.innerHTML = '<p class="muted" style="margin-top:0">Banners 1–2 sit beside the globe. Banners 3 and up show as wide banners below the categories (that section can be switched on or off in Homepage &amp; Globe). Use ↑ to reorder.</p><div class="cards">' + db.hero.map(function (h, i) {
      return '<div class="item-card"><div class="cover" style="background:linear-gradient(120deg,' + h.color + ',' + SCG.shade(h.color, -70) + ')">' + (h.image ? '<img src="' + h.image + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color)) + '</div>' +
        '<div class="body"><small class="muted">' + (i < 2 ? 'BESIDE GLOBE' : 'WIDE BANNER') + ' · ' + esc(h.eyebrow) + '</small><h4>' + esc(h.title) + '</h4><p>' + esc(h.subtitle) + '</p><p><code class="muted">' + esc(h.link) + '</code></p></div>' +
        '<div class="foot"><button class="btn sm" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="btn sm" data-edit="' + i + '">Edit</button><button class="btn sm danger" data-del="' + i + '">Delete</button></div></div>';
    }).join('') + '</div>';
    $('#addHero').onclick = function () { bannerForm(-1); };
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) bannerForm(+b.dataset.edit);
      if (b.dataset.up) { var i = +b.dataset.up, t = db.hero[i]; db.hero[i] = db.hero[i - 1]; db.hero[i - 1] = t; commit('Order updated'); route(); }
      if (b.dataset.del && confirm('Delete this banner?')) { db.hero.splice(+b.dataset.del, 1); commit('Banner deleted'); route(); }
    };
  }
  function linkOptions() {
    return ['#shop', '#flash', '#china-direct', '#track', '#help', '#categories'].concat(db.categories.map(function (c) { return '#c/' + c.id; }), db.collections.map(function (c) { return '#col/' + c.id; }));
  }
  function bannerForm(i) {
    var h = i > -1 ? JSON.parse(JSON.stringify(db.hero[i])) : { id: SCG.uid('h'), eyebrow: 'New Season', title: 'Your headline', subtitle: '', cta: 'Shop Now', link: '#shop', color: '#0b2a6f', shape: 'tshirt', image: '' };
    function prev() { return h.image ? '<img src="' + h.image + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color); }
    openModal(i > -1 ? 'Edit Banner' : 'Add Banner',
      '<form class="form" id="hform"><label>Small label<input name="eyebrow" value="' + esc(h.eyebrow) + '"></label>' +
      '<label>Button text<input name="cta" value="' + esc(h.cta) + '"></label>' +
      '<label class="full">Title<input name="title" required value="' + esc(h.title) + '"></label>' +
      '<label class="full">Subtitle<input name="subtitle" value="' + esc(h.subtitle) + '"></label>' +
      '<label>Opens<input name="link" list="hlinks" value="' + esc(h.link) + '"><datalist id="hlinks">' + linkOptions().map(function (l) { return '<option value="' + l + '">'; }).join('') + '</datalist></label>' +
      '<label>Background colour<input type="color" name="color" value="' + esc(h.color) + '"></label>' +
      '<label>Picture (if no image)<select name="shape">' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (s === h.shape ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<div class="full"><label style="margin-bottom:8px">Image (optional; a product photo on a plain background works best)</label><div class="uploader" id="hup"><div class="preview" style="background:' + esc(h.color) + '">' + prev() + '</div><div class="btns"><input type="file" accept="image/*"><button type="button" class="btn sm danger" data-rm-img>Remove</button></div></div></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    var f = $('#hform'), E = f.elements;
    bindUploader($('#hup'), prev, function (u) { h.image = u; });
    E.shape.onchange = E.color.oninput = function () { h.shape = E.shape.value; h.color = E.color.value; $('#hup .preview').style.background = h.color; if (!h.image) $('#hup .preview').innerHTML = prev(); };
    f.onsubmit = function (e) {
      e.preventDefault();
      ['eyebrow', 'cta', 'title', 'subtitle', 'link', 'color', 'shape'].forEach(function (k) { h[k] = E[k].value; });
      if (i > -1) db.hero[i] = h; else db.hero.push(h);
      commit('Banner saved'); closeModal(); route();
    };
  }

  /* =========================================================
     HEADER & FOOTER
     ========================================================= */
  function headerView(v) {
    var s = db.settings;
    setActions(preview('', 'Preview'));
    v.innerHTML =
      '<div class="panel"><h3>Announcement bar <small>the scrolling line at the very top; separate messages with ✦</small></h3><textarea id="ann" rows="2">' + esc(s.announcement) + '</textarea></div>' +
      '<div class="panel"><h3>Menu links <small>shown next to “Categories” in the header</small></h3><div id="nav"></div></div>' +
      '<div class="panel"><h3>Payment methods in the footer</h3><div id="pay"></div></div>' +
      '<div class="panel"><h3>Footer contact details</h3><p class="muted" style="margin:0">Address, phone, email and WhatsApp are edited in <a href="#settings" style="color:var(--red)">Store Settings</a>.</p></div>' +
      '<div class="save-bar"><button class="btn primary" id="save">Save header &amp; footer</button></div>';
    var getNav = repeater($('#nav'), s.navLinks || [], [{ k: 'label', label: 'Text' }, { k: 'link', label: 'Opens (e.g. #flash, #col/new-arrivals)', w: '1.4fr' }, { k: 'hot', label: 'Red', type: 'checkbox', w: 'auto' }], { label: 'New link', link: '#shop', hot: false });
    var getPay = repeater($('#pay'), (s.paymentMethods || []).map(function (m) { return { name: m }; }), [{ k: 'name', label: 'Payment method' }], { name: '' });
    $('#save').onclick = function () {
      s.announcement = $('#ann').value.trim();
      s.navLinks = getNav().filter(function (x) { return x.label; });
      s.paymentMethods = getPay().map(function (x) { return x.name; }).filter(Boolean);
      commit('Header & footer saved');
    };
  }

  /* =========================================================
     CHINA DIRECT PAGE & FAQ
     ========================================================= */
  function pages(v) {
    var s = db.settings;
    setActions(preview('#china-direct', 'View page'));
    v.innerHTML =
      '<div class="panel"><h3>“How China Direct works” steps</h3><div id="steps"></div></div>' +
      '<div class="panel"><h3>Questions &amp; answers <small>shown on the China Direct and Help pages</small></h3><div id="faq"></div></div>' +
      '<div class="save-bar"><button class="btn primary" id="save">Save pages</button></div>';
    var getSteps = repeater($('#steps'), s.chinaSteps || [], [{ k: 'title', label: 'Step title' }, { k: 'text', label: 'Description', type: 'textarea', w: '2.4fr' }], { title: '', text: '' });
    var getFaq = repeater($('#faq'), s.faq || [], [{ k: 'q', label: 'Question' }, { k: 'a', label: 'Answer', type: 'textarea', w: '1.6fr' }], { q: '', a: '' });
    $('#save').onclick = function () {
      s.chinaSteps = getSteps().filter(function (x) { return x.title; });
      s.faq = getFaq().filter(function (x) { return x.q; });
      commit('Pages saved');
    };
  }

  /* =========================================================
     ORDERS
     ========================================================= */
  function ordersView(v, arg) {
    var os = orders(), filt = 'All', q = '';
    if (arg && STATUSES.indexOf(arg) > -1) filt = arg;
    if (arg && arg.indexOf('q:') === 0) q = arg.slice(2);
    var openId = arg && arg.indexOf('id:') === 0 ? arg.slice(3) : '';
    v.innerHTML = '<div class="chip-tabs" id="otabs"></div><div class="filters"><input id="oq" type="search" placeholder="Search order no, name or phone…" value="' + esc(q) + '"></div><div id="olist"></div>';
    function draw() {
      os = orders();
      $('#otabs').innerHTML = ['All'].concat(STATUSES).map(function (s) {
        var n = s === 'All' ? os.length : os.filter(function (o) { return o.status === s; }).length;
        return '<button data-s="' + esc(s) + '" class="' + (s === filt ? 'on' : '') + '">' + esc(s) + '<span>' + n + '</span></button>';
      }).join('');
      var ql = q.toLowerCase().replace(/\s/g, '');
      var list = os.map(function (o, i) { return { o: o, i: i }; }).filter(function (x) {
        if (filt !== 'All' && x.o.status !== filt) return false;
        return !ql || (x.o.id + x.o.customer.name + x.o.customer.phone).toLowerCase().replace(/\s/g, '').indexOf(ql) > -1;
      });
      $('#olist').innerHTML = list.length ? '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>' +
        list.map(function (x) {
          var o = x.o;
          return '<tr class="click" data-i="' + x.i + '"><td><b>' + esc(o.id) + '</b><br><small class="muted">' + new Date(o.date).toLocaleString() + '</small></td>' +
            '<td><b>' + esc(o.customer.name) + '</b><br><small class="muted">' + esc(o.customer.phone) + '</small></td>' +
            '<td>' + o.items.reduce(function (s, it) { return s + it.qty; }, 0) + ' item(s)<br><small class="muted">' + esc(o.items[0] ? o.items[0].name : '') + (o.items.length > 1 ? ' +' + (o.items.length - 1) : '') + '</small></td>' +
            '<td><b>' + money(o.total) + '</b></td><td><small>' + esc(o.payment || 'Cash on Delivery') + '</small></td>' +
            '<td><select data-st style="width:auto" aria-label="Status">' + STATUSES.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="panel" style="text-align:center;padding:50px"><h3>No orders here</h3><p class="muted">When customers check out on the website, their orders appear here.</p></div>';
      updatePill();
    }
    $('#otabs').onclick = function (e) { var b = e.target.closest('button'); if (b) { filt = b.dataset.s; draw(); } };
    $('#oq').oninput = function (e) { q = e.target.value; draw(); };
    $('#olist').addEventListener('change', function (e) {
      if (!e.target.hasAttribute('data-st')) return;
      var all = orders(), i = +e.target.closest('tr').dataset.i; all[i].status = e.target.value; SCG.saveOrders(all); toast('Status: ' + e.target.value); draw();
    });
    $('#olist').addEventListener('click', function (e) {
      if (e.target.closest('select')) return;
      var tr = e.target.closest('tr[data-i]'); if (tr) orderDetail(+tr.dataset.i, draw);
    });
    draw();
    if (openId) { var idx = os.map(function (o) { return o.id; }).indexOf(openId); if (idx > -1) orderDetail(idx, draw); }
  }
  function orderDetail(i, redraw) {
    var o = orders()[i]; if (!o) return;
    var wa = waNumber(o.customer.phone);
    var msg = encodeURIComponent('Hello ' + o.customer.name + ', this is Source Connect Global about your order ' + o.id + ' (' + money(o.total) + '). Status: ' + o.status + '.');
    openModal('Order ' + o.id,
      '<div class="od-grid"><div class="box"><h4>Customer</h4><b>' + esc(o.customer.name) + '</b><br>' + esc(o.customer.phone) + '<br>' + esc(o.customer.address) + (o.customer.note ? '<br><i class="muted">Note: ' + esc(o.customer.note) + '</i>' : '') + '</div>' +
      '<div class="box"><h4>Order</h4>Placed ' + new Date(o.date).toLocaleString() + '<br>Payment: <b>' + esc(o.payment || 'Cash on Delivery') + '</b><br>Status: ' + statusTag(o.status) + '</div></div>' +
      '<div class="od-items">' + o.items.map(function (it) {
        var p = SCG.productById(it.id) || { name: it.name, color: it.color || '#0b2a6f', category: '', shape: 'tshirt' };
        return '<div class="od-item">' + thumb(p, it.color) + '<div><b>' + esc(it.name) + '</b><br><small class="muted">' + (it.size ? 'Size ' + esc(it.size) + ' · ' : '') + 'Qty ' + it.qty + (it.origin === 'china' ? ' · China Direct' : '') + '</small></div><b>' + money(it.price * it.qty) + '</b></div>';
      }).join('') + '</div>' +
      '<div style="text-align:right;font-size:13px">' + (o.subtotal !== undefined ? 'Subtotal ' + money(o.subtotal) + ' · Delivery ' + (o.shipping ? money(o.shipping) : 'FREE') + '<br>' : '') + '<b style="font-size:18px;color:var(--red)">Total ' + money(o.total) + '</b></div>' +
      '<div class="od-actions"><label style="display:flex;gap:8px;align-items:center;flex-direction:row">Status <select id="odst" style="width:auto">' + STATUSES.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/' + wa + '?text=' + msg + '">WhatsApp customer</a><a class="btn" href="tel:' + esc(o.customer.phone) + '">Call</a>' +
      '<a class="btn" href="#customers/' + encodeURIComponent(o.customer.phone) + '" data-close>Customer history</a><button class="btn danger" id="oddel">Delete order</button></div>');
    $('#odst').onchange = function (e) { var a = orders(); a[i].status = e.target.value; SCG.saveOrders(a); toast('Status: ' + e.target.value); if (redraw) redraw(); };
    $('#oddel').onclick = function () { if (!confirm('Delete order ' + o.id + '?')) return; var a = orders(); a.splice(i, 1); SCG.saveOrders(a); closeModal(); if (redraw) redraw(); };
  }

  /* =========================================================
     CUSTOMERS
     ========================================================= */
  function customers(v, arg) {
    var map = {};
    orders().forEach(function (o) {
      var key = String(o.customer.phone).replace(/\D/g, '').slice(-9);
      var c = map[key] = map[key] || { name: o.customer.name, phone: o.customer.phone, address: o.customer.address, n: 0, spent: 0, last: o.date };
      c.n++; if (o.status !== 'Cancelled') c.spent += o.total;
      if (o.date > c.last) { c.last = o.date; c.address = o.customer.address; c.name = o.customer.name; }
    });
    var list = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.spent - a.spent; });
    var focus = arg ? String(arg).replace(/\D/g, '').slice(-9) : '';
    v.innerHTML = list.length ? '<div class="filters"><input id="cq" type="search" placeholder="Search name or phone…"><span class="muted" style="align-self:center">' + list.length + ' customers</span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th>Orders</th><th>Total spent</th><th>Last order</th><th></th></tr></thead><tbody id="ctb">' +
      list.map(function (c) {
        var key = String(c.phone).replace(/\D/g, '').slice(-9);
        return '<tr data-n="' + esc((c.name + c.phone).toLowerCase()) + '"' + (focus === key ? ' class="sel"' : '') + '><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.phone) + '</td><td><small>' + esc(c.address) + '</small></td><td>' + c.n + '</td><td><b>' + money(c.spent) + '</b></td><td><small>' + new Date(c.last).toLocaleDateString() + '</small></td>' +
          '<td><div class="actions"><a class="btn sm wa" target="_blank" rel="noopener" href="https://wa.me/' + waNumber(c.phone) + '">WhatsApp</a><a class="btn sm" href="#orders/q:' + encodeURIComponent(c.phone) + '">Orders</a></div></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="panel" style="text-align:center;padding:50px"><h3>No customers yet</h3><p class="muted">Customers appear here after their first order.</p></div>';
    if ($('#cq')) $('#cq').oninput = function (e) { var q = e.target.value.toLowerCase(); $$('#ctb tr').forEach(function (tr) { tr.hidden = tr.dataset.n.indexOf(q) < 0; }); };
  }

  /* =========================================================
     STORE SETTINGS
     ========================================================= */
  function settings(v) {
    var s = db.settings;
    v.innerHTML =
      '<div class="grid2"><form class="panel" id="sform"><h3>Store &amp; contact</h3><div class="form">' +
      '<label>Store name<input name="brand" value="' + esc(s.brand) + '"></label>' +
      '<label>Currency symbol<input name="currency" value="' + esc(s.currency) + '"></label>' +
      '<label>Phone<input name="phone" value="' + esc(s.phone) + '"></label>' +
      '<label>Email<input name="email" type="email" value="' + esc(s.email) + '"></label>' +
      '<label>WhatsApp (international, digits only)<input name="whatsapp" value="' + esc(s.whatsapp) + '"></label>' +
      '<label>Address<input name="address" value="' + esc(s.address) + '"></label>' +
      '<div class="form-foot"><button class="btn primary">Save</button></div></div></form>' +

      '<form class="panel" id="dform"><h3>Delivery &amp; payment</h3><div class="form">' +
      '<label>China Direct delivery (days)<input name="chinaDays" value="' + esc(s.chinaDays) + '"></label>' +
      '<label>Colombo stock delivery (days)<input name="localDays" value="' + esc(s.localDays) + '"></label>' +
      '<label>Delivery fee<input name="shippingFee" type="number" min="0" value="' + (s.shippingFee || 0) + '"></label>' +
      '<label>Free delivery over (0 = never)<input name="freeShipping" type="number" min="0" value="' + (s.freeShipping || 0) + '"></label>' +
      '<label>Return period (days)<input name="returnDays" type="number" min="0" value="' + (s.returnDays || 0) + '"></label>' +
      '<div class="full" style="display:flex;gap:18px;flex-wrap:wrap">' + sw('payCOD', s.payCOD !== false, 'Cash on Delivery at checkout') + sw('payBank', !!s.payBank, 'Bank transfer at checkout') + '</div>' +
      '<label class="full">Bank details (shown after a bank transfer order)<textarea name="bankDetails" rows="2">' + esc(s.bankDetails || '') + '</textarea></label>' +
      '<div class="form-foot"><button class="btn primary">Save</button></div></div></form></div>' +

      '<div class="grid2"><div class="panel"><h3>Seller rating on product pages</h3><div id="sstats"></div><div style="margin-top:10px;display:flex;justify-content:flex-end"><button class="btn primary" id="ssave">Save</button></div></div>' +
      '<form class="panel" id="aform"><h3>Admin login</h3><div class="form">' +
      '<label>Username<input name="adminUser" required value="' + esc(s.adminUser) + '" autocomplete="username"></label>' +
      '<label>New password<input name="adminPass" type="password" minlength="6" placeholder="Leave blank to keep current" autocomplete="new-password"></label>' +
      '<div class="form-foot"><button class="btn dark">Update login</button></div></div></form></div>' +

      '<div class="panel"><h3>Backup &amp; data</h3><p class="muted" style="margin-top:0">Everything is stored in this browser. Export a backup regularly, or import it on another computer.</p>' +
      '<div class="filters"><button class="btn" id="exp">⬇ Export backup</button><label class="btn" style="display:inline-flex;color:var(--text);font-size:13px">⬆ Import backup<input type="file" accept="application/json" id="imp" hidden></label>' +
      '<button class="btn danger" id="rst">Reset to demo data</button><button class="btn danger" id="rstOrders">Delete all orders</button></div></div>';

    $('#sform').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements; ['brand', 'currency', 'phone', 'email', 'whatsapp', 'address'].forEach(function (k) { s[k] = E[k].value.trim(); }); commit('Store details saved'); };
    $('#dform').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      if (!E.payCOD.checked && !E.payBank.checked) { toast('Turn on at least one payment method'); return; }
      s.chinaDays = E.chinaDays.value.trim(); s.localDays = E.localDays.value.trim();
      s.shippingFee = +E.shippingFee.value || 0; s.freeShipping = +E.freeShipping.value || 0; s.returnDays = +E.returnDays.value || 0;
      s.payCOD = E.payCOD.checked; s.payBank = E.payBank.checked; s.bankDetails = E.bankDetails.value.trim();
      commit('Delivery & payment saved');
    };
    var getSS = repeater($('#sstats'), s.sellerStats || [], [{ k: 'value', label: 'Value', w: '.7fr' }, { k: 'label', label: 'Label' }], { value: '', label: '' });
    $('#ssave').onclick = function () { s.sellerStats = getSS().slice(0, 3); commit('Seller rating saved'); };
    $('#aform').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      s.adminUser = E.adminUser.value.trim(); if (E.adminPass.value) s.adminPass = E.adminPass.value;
      commit('Login updated'); E.adminPass.value = '';
    };
    $('#exp').onclick = function () {
      var blob = new Blob([JSON.stringify({ db: db, orders: orders() }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'scg-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    $('#imp').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      file.text().then(function (txt) {
        var data = JSON.parse(txt), next = data.db || data;
        if (!next.products || !next.categories) throw new Error('bad');
        if (!confirm('Replace all current data with this backup?')) return;
        localStorage.setItem(SCG.keys.DB_KEY, JSON.stringify(next));
        if (data.orders) SCG.saveOrders(data.orders);
        location.reload();
      }).catch(function () { alert('That file is not a valid Source Connect backup.'); });
    };
    $('#rst').onclick = function () { if (confirm('Reset ALL products, categories, collections, banners and site texts to the demo data? Orders are kept.')) { db = SCG.reset(); toast('Demo data restored'); route(); } };
    $('#rstOrders').onclick = function () { if (confirm('Delete ALL orders? This cannot be undone.')) { SCG.saveOrders([]); toast('All orders deleted'); route(); } };
  }

  if (loggedIn()) showApp();
})();
