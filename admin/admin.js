/* =========================================================
   Source Connect Global — Admin Panel
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = SCG.escapeHTML;
  var db = SCG.load();
  var SESSION = 'scg_admin_session';
  var MIN_PER_CATEGORY = 10;
  var BADGES = ['', 'New', 'Best Seller', 'Flash Sale', 'Limited', 'Hot'];
  var SHAPES = Object.keys(SCG.SHAPES);

  /* ---------------- Auth ---------------- */
  function loggedIn() { try { return sessionStorage.getItem(SESSION) === '1'; } catch (e) { return false; } }
  function showApp() { $('#login').hidden = true; $('#shell').hidden = false; route(); }
  $('#loginForm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    if (f.get('user') === db.settings.adminUser && f.get('pass') === db.settings.adminPass) {
      try { sessionStorage.setItem(SESSION, '1'); } catch (err) {}
      showApp();
    } else { $('#loginErr').textContent = 'Incorrect username or password.'; }
  };
  $('#logout').onclick = function () { try { sessionStorage.removeItem(SESSION); } catch (e) {} location.hash = ''; location.reload(); };
  $('#menuBtn').onclick = function (e) { e.stopPropagation(); $('#side').classList.toggle('open'); };
  document.addEventListener('click', function (e) { if (!e.target.closest('#side') && !e.target.closest('#menuBtn')) $('#side').classList.remove('open'); });

  /* ---------------- Helpers ---------------- */
  function commit(msg) { if (SCG.save()) toast(msg || 'Saved'); }
  var tt;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function openModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').classList.add('open'); }
  function closeModal() { $('#modal').classList.remove('open'); }
  $('#modal').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  function setActions(html) { $('#topActions').innerHTML = html || ''; }
  function thumb(p) {
    return '<div class="thumb" style="background:' + SCG.shade(p.color || '#0b2a6f', 160) + '">' + SCG.productVisual(p) + '</div>';
  }
  function countIn(catId) { return db.products.filter(function (p) { return p.category === catId; }).length; }
  function orders() { return SCG.getOrders(); }
  function updatePill() { var n = orders().filter(function (o) { return o.status === 'Pending'; }).length; $('#orderPill').textContent = n || ''; }

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

  /* ---------------- Views ---------------- */
  var VIEWS = {
    dashboard: { title: 'Dashboard', render: dashboard },
    products: { title: 'Products', render: products },
    categories: { title: 'Categories', render: categories },
    collections: { title: 'Collections', render: collections },
    hero: { title: 'Promo Banners', render: hero },
    orders: { title: 'Orders', render: ordersView },
    settings: { title: 'Settings', render: settings }
  };

  function route() {
    if (!loggedIn()) return;
    var parts = location.hash.replace('#', '').split('/');
    var key = VIEWS[parts[0]] ? parts[0] : 'dashboard';
    $$('#sideNav a').forEach(function (a) { a.classList.toggle('active', a.dataset.v === key); });
    $('#viewTitle').textContent = VIEWS[key].title;
    $('#side').classList.remove('open');
    var v = $('#view'); v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
    setActions('');
    VIEWS[key].render(v, parts[1]);
    updatePill();
  }
  window.addEventListener('hashchange', route);

  /* ----- Dashboard ----- */
  function dashboard(v) {
    var os = orders();
    var revenue = os.filter(function (o) { return o.status !== 'Cancelled'; }).reduce(function (s, o) { return s + o.total; }, 0);
    var low = db.products.filter(function (p) { return p.stock <= 5; });
    var max = Math.max.apply(null, db.categories.map(function (c) { return countIn(c.id); }).concat([1]));
    setActions('<a class="btn primary" href="#products/new">+ Add Product</a>');
    v.innerHTML =
      '<div class="stats">' +
      stat('Products', db.products.length, '#0b2a6f') + stat('Categories', db.categories.length, '#d7141a') +
      stat('Collections', db.collections.length, '#6d28d9') + stat('Orders', os.length, '#0f766e') +
      stat('Revenue', SCG.money(revenue), '#f59e0b') + stat('Low stock', low.length, '#d7141a') + '</div>' +
      '<div class="cols"><div class="panel"><h3>Products per category <span class="hint">(target: at least ' + MIN_PER_CATEGORY + ' each)</span></h3><div class="bars">' +
      db.categories.map(function (c) {
        var n = countIn(c.id);
        return '<div class="bar-row"><a href="#products/cat:' + c.id + '">' + esc(c.name) + '</a><div class="bar-track"><i style="width:' + (n / max * 100) + '%"></i></div><b>' + n + '</b></div>' +
          (n < MIN_PER_CATEGORY ? '<div class="warn-text">⚠ ' + esc(c.name) + ' needs ' + (MIN_PER_CATEGORY - n) + ' more item(s)</div>' : '');
      }).join('') + '</div></div>' +
      '<div class="panel"><h3>Recent orders</h3>' + (os.length ? os.slice(0, 6).map(function (o) {
        return '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)"><span><b>' + esc(o.id) + '</b><br><small class="muted">' + esc(o.customer.name) + '</small></span><span style="text-align:right">' + SCG.money(o.total) + '<br>' + statusTag(o.status) + '</span></div>';
      }).join('') : '<p class="muted">No orders yet. Orders placed on the website appear here.</p>') + '</div></div>' +
      '<div class="panel"><h3>Low stock (5 or fewer)</h3>' + (low.length ? '<div class="filters">' + low.map(function (p) { return '<a class="tag warn" href="#products/edit:' + p.id + '">' + esc(p.name) + ' · ' + p.stock + '</a>'; }).join('') + '</div>' : '<p class="muted">All products are well stocked.</p>') + '</div>';
  }
  function stat(label, val, color) { return '<div class="stat" style="--a:' + color + '"><small>' + label + '</small><b>' + val + '</b></div>'; }
  function statusTag(s) { return '<span class="tag ' + ({ Pending: 'warn', Delivered: 'ok', Cancelled: 'red' }[s] || '') + '">' + esc(s) + '</span>'; }

  /* ----- Products ----- */
  var pf = { q: '', cat: 'all', coll: 'all' };
  function products(v, arg) {
    if (arg && arg.indexOf('cat:') === 0) pf.cat = arg.slice(4);
    setActions('<a class="btn primary" href="#products/new">+ Add Product</a>');
    v.innerHTML =
      '<div class="filters"><input id="pq" type="search" placeholder="Search products…" value="' + esc(pf.q) + '">' +
      '<select id="pc"><option value="all">All categories</option>' + db.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + ' (' + countIn(c.id) + ')</option>'; }).join('') + '</select>' +
      '<select id="pco"><option value="all">All collections</option>' + db.collections.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<span class="muted" id="pcount" style="align-self:center"></span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Collections</th><th>Price</th><th>Stock</th><th>Badge</th><th></th></tr></thead><tbody id="ptb"></tbody></table></div>';
    $('#pc').value = pf.cat; $('#pco').value = pf.coll;
    function draw() {
      var q = pf.q.toLowerCase();
      var list = db.products.filter(function (p) {
        return (pf.cat === 'all' || p.category === pf.cat) && (pf.coll === 'all' || (p.collections || []).indexOf(pf.coll) > -1) && (!q || p.name.toLowerCase().indexOf(q) > -1 || p.id.indexOf(q) > -1);
      });
      $('#pcount').textContent = list.length + ' items';
      $('#ptb').innerHTML = list.map(function (p) {
        var c = SCG.categoryById(p.category);
        return '<tr><td><div class="prod-cell">' + thumb(p) + '<div><b>' + esc(p.name) + '</b><small>' + esc(p.id) + (p.featured ? ' · ★ Featured' : '') + '</small></div></div></td>' +
          '<td>' + esc(c ? c.name : '—') + '</td>' +
          '<td>' + (p.collections || []).map(function (id) { var co = SCG.collectionById(id); return co ? '<span class="tag">' + esc(co.name) + '</span>' : ''; }).join('') + '</td>' +
          '<td><b>' + SCG.money(p.price) + '</b>' + (p.comparePrice ? '<br><s class="muted">' + SCG.money(p.comparePrice) + '</s>' : '') + '</td>' +
          '<td><span class="tag ' + (p.stock <= 0 ? 'red' : p.stock <= 5 ? 'warn' : 'ok') + '">' + p.stock + '</span></td>' +
          '<td>' + (p.badge ? '<span class="tag red">' + esc(p.badge) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td><div class="actions"><button class="btn sm" data-edit="' + p.id + '">Edit</button><button class="btn sm" data-dup="' + p.id + '">Duplicate</button><button class="btn sm danger" data-del="' + p.id + '">Delete</button></div></td></tr>';
      }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:40px">No products found.</td></tr>';
    }
    $('#pq').oninput = function (e) { pf.q = e.target.value; draw(); };
    $('#pc').onchange = function (e) { pf.cat = e.target.value; draw(); };
    $('#pco').onchange = function (e) { pf.coll = e.target.value; draw(); };
    $('#ptb').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) productForm(b.dataset.edit);
      if (b.dataset.dup) {
        var src = db.products.filter(function (p) { return p.id === b.dataset.dup; })[0];
        var copy = JSON.parse(JSON.stringify(src)); copy.id = SCG.uid(src.category); copy.name = src.name + ' (Copy)'; copy.createdAt = Date.now();
        db.products.unshift(copy); commit('Product duplicated'); draw();
      }
      if (b.dataset.del) {
        var p = db.products.filter(function (x) { return x.id === b.dataset.del; })[0];
        if (confirm('Delete "' + p.name + '"? This cannot be undone.')) {
          db.products = db.products.filter(function (x) { return x.id !== p.id; }); commit('Product deleted'); draw();
        }
      }
    };
    draw();
    if (arg === 'new') productForm(null);
    if (arg && arg.indexOf('edit:') === 0) productForm(arg.slice(5));
  }

  function productForm(id) {
    var p = id ? db.products.filter(function (x) { return x.id === id; })[0] : null;
    var isNew = !p;
    var d = p ? JSON.parse(JSON.stringify(p)) : {
      name: '', category: pf.cat !== 'all' ? pf.cat : db.categories[0].id, collections: [], price: 0, comparePrice: 0, stock: 20,
      color: '#0b2a6f', accent: '#f3f4f6', shape: '', pattern: 'solid', brand: 'SC Global', origin: 'china', flash: false,
      rating: 4.5, reviews: 0, sold: 0, image: '', sizes: ['S', 'M', 'L', 'XL', 'XXL'], badge: 'New', featured: false, description: ''
    };
    function curShape() { var c = SCG.categoryById(d.category); return d.shape || (c ? c.shape : 'tshirt'); }
    function preview() { return d.image ? '<img src="' + d.image + '" alt="">' : SCG.productSVG(curShape(), d.color, d.pattern, d.accent); }
    openModal(isNew ? 'Add Product' : 'Edit Product',
      '<form class="form" id="pform">' +
      '<label class="full">Product name<input name="name" required value="' + esc(d.name) + '" placeholder="e.g. Classic Crew Tee"></label>' +
      '<label>Category<select name="category">' + db.categories.map(function (c) { return '<option value="' + c.id + '"' + (c.id === d.category ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Brand<input name="brand" value="' + esc(d.brand || '') + '"></label>' +
      '<label>Price (' + esc(db.settings.currency) + ')<input name="price" type="number" min="0" step="10" required value="' + d.price + '"></label>' +
      '<label>Original price (before discount)<input name="comparePrice" type="number" min="0" step="10" placeholder="Optional, shows -% off" value="' + (d.comparePrice || '') + '"></label>' +
      '<label>Stock quantity<input name="stock" type="number" min="0" required value="' + d.stock + '"></label>' +
      '<label>Ships from<select name="origin"><option value="china"' + (d.origin === 'china' ? ' selected' : '') + '>China Direct (10–14 days)</option><option value="local"' + (d.origin !== 'china' ? ' selected' : '') + '>Colombo stock (2–4 days)</option></select></label>' +
      '<label>Badge<select name="badge">' + BADGES.map(function (b) { return '<option' + (b === d.badge ? ' selected' : '') + ' value="' + b + '">' + (b || 'None') + '</option>'; }).join('') + '</select></label>' +
      '<label>Rating (0–5)<input name="rating" type="number" min="0" max="5" step="0.1" value="' + (d.rating || 0) + '"></label>' +
      '<label>Ratings count<input name="reviews" type="number" min="0" value="' + (d.reviews || 0) + '"></label>' +
      '<label>Units sold<input name="sold" type="number" min="0" value="' + (d.sold || 0) + '"></label>' +
      '<label class="full">Sizes (comma separated, leave empty for bags and watches)<input name="sizes" value="' + esc((d.sizes || []).join(', ')) + '"></label>' +
      '<div class="full"><label style="margin-bottom:8px">Collections</label><div class="checks">' + db.collections.map(function (c) {
        return '<label><input type="checkbox" name="collections" value="' + c.id + '"' + ((d.collections || []).indexOf(c.id) > -1 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
      }).join('') + '</div></div>' +
      '<div class="full"><label style="margin-bottom:8px">Product photo</label><div class="uploader" id="pup"><div class="preview">' + preview() + '</div><div class="btns">' +
      '<input type="file" accept="image/*"><button type="button" class="btn sm danger" data-rm-img>Remove photo</button>' +
      '<span class="hint">No photo? The illustration below is shown instead. Photos are auto-resized.</span></div></div></div>' +
      '<label>Illustration<select name="shape"><option value="">Same as category</option>' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (s === d.shape ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Pattern<select name="pattern">' + SCG.PATTERNS.map(function (s) { return '<option' + (s === (d.pattern || 'solid') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Main colour<input name="color" type="color" value="' + esc(d.color) + '"></label>' +
      '<label>Accent colour<input name="accent" type="color" value="' + esc(d.accent || '#f3f4f6') + '"></label>' +
      '<label class="full">Description<textarea name="description" rows="3">' + esc(d.description) + '</textarea></label>' +
      '<div class="full checks"><label><input type="checkbox" name="flash"' + (d.flash ? ' checked' : '') + '> Show in Flash Sale</label><label><input type="checkbox" name="featured"' + (d.featured ? ' checked' : '') + '> Featured</label></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">' + (isNew ? 'Add Product' : 'Save Changes') + '</button></div></form>');
    var f = $('#pform');
    bindUploader($('#pup'), preview, function (url) { d.image = url; });
    f.category.onchange = f.color.oninput = f.accent.oninput = f.shape.onchange = f.pattern.onchange = function () {
      d.category = f.category.value; d.color = f.color.value; d.accent = f.accent.value; d.shape = f.shape.value; d.pattern = f.pattern.value;
      if (!d.image) $('#pup .preview').innerHTML = preview();
    };
    f.onsubmit = function (e) {
      e.preventDefault();
      var out = Object.assign(d, {
        name: f.elements.name.value.trim(), category: f.category.value, badge: f.badge.value, brand: f.brand.value.trim(),
        price: +f.price.value || 0, comparePrice: +f.comparePrice.value || 0, stock: +f.stock.value || 0,
        color: f.color.value, accent: f.accent.value, shape: f.shape.value, pattern: f.pattern.value, origin: f.origin.value,
        rating: Math.min(5, +f.rating.value || 0), reviews: +f.reviews.value || 0, sold: +f.sold.value || 0,
        sizes: f.sizes.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        collections: $$('input[name=collections]:checked', f).map(function (x) { return x.value; }),
        description: f.description.value.trim(), featured: f.featured.checked, flash: f.flash.checked
      });
      if (isNew) { out.id = SCG.uid(out.category); out.createdAt = Date.now(); db.products.unshift(out); }
      else { var i = db.products.indexOf(p); db.products[i] = out; }
      if (!commit(isNew ? 'Product added' : 'Product updated')) return;
      closeModal();
      if (location.hash !== '#products') location.hash = 'products'; else route();
    };
  }

  /* ----- Categories ----- */
  function categories(v) {
    setActions('<button class="btn primary" id="addCat">+ Add Category</button>');
    v.innerHTML = '<div class="cards">' + db.categories.map(function (c) {
      var n = countIn(c.id), sample = db.products.filter(function (p) { return p.category === c.id; })[0];
      var color = sample ? sample.color : '#0b2a6f';
      return '<div class="item-card"><div class="cover" style="background:radial-gradient(circle,' + SCG.shade(color, 140) + ',' + SCG.shade(color, 60) + ')">' + SCG.garmentSVG(c.shape, color) + '</div>' +
        '<div class="body"><h4>' + esc(c.name) + '</h4><p>' + esc(c.tagline || '') + '</p><p style="margin-top:8px"><span class="tag ' + (n < MIN_PER_CATEGORY ? 'warn' : 'ok') + '">' + n + ' products</span> <span class="tag">' + esc(c.shape) + '</span></p></div>' +
        '<div class="foot"><a class="btn sm" href="#products/cat:' + c.id + '">View items</a><button class="btn sm" data-edit="' + c.id + '">Edit</button><button class="btn sm danger" data-del="' + c.id + '">Delete</button></div></div>';
    }).join('') + '</div>';
    $('#addCat').onclick = function () { catForm(null); };
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) catForm(b.dataset.edit);
      if (b.dataset.del) {
        var n = countIn(b.dataset.del);
        if (n) { alert('This category still has ' + n + ' products. Move or delete them first.'); return; }
        if (confirm('Delete this category?')) { db.categories = db.categories.filter(function (c) { return c.id !== b.dataset.del; }); commit('Category deleted'); route(); }
      }
    };
  }
  function catForm(id) {
    var c = id ? SCG.categoryById(id) : null;
    openModal(c ? 'Edit Category' : 'Add Category',
      '<form class="form" id="cform"><label>Name<input name="name" required value="' + esc(c ? c.name : '') + '"></label>' +
      '<label>Illustration style<select name="shape">' + SHAPES.map(function (s) { return '<option' + (c && c.shape === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label class="full">Tagline<input name="tagline" value="' + esc(c ? c.tagline : '') + '"></label>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    $('#cform').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      if (c) { c.name = f.name.value.trim(); c.shape = f.shape.value; c.tagline = f.tagline.value.trim(); }
      else {
        var nid = SCG.slug(f.name.value); if (SCG.categoryById(nid)) nid = SCG.uid(nid);
        db.categories.push({ id: nid, name: f.name.value.trim(), shape: f.shape.value, tagline: f.tagline.value.trim() });
      }
      commit('Category saved'); closeModal(); route();
    };
  }

  /* ----- Collections ----- */
  function collections(v) {
    setActions('<button class="btn primary" id="addColl">+ Add Collection</button>');
    v.innerHTML = '<div class="cards">' + db.collections.map(function (c) {
      var n = db.products.filter(function (p) { return (p.collections || []).indexOf(c.id) > -1; }).length;
      return '<div class="item-card"><div class="cover" style="background:linear-gradient(150deg,' + SCG.shade(c.accent, 40) + ',' + SCG.shade(c.accent, -60) + ')">' +
        (c.image ? '<img src="' + c.image + '" alt="">' : '<b style="font-family:Playfair Display,serif;font-size:26px;padding:0 16px;text-align:center">' + esc(c.name) + '</b>') + '</div>' +
        '<div class="body"><h4>' + esc(c.name) + '</h4><p>' + esc(c.description || '') + '</p><p style="margin-top:8px"><span class="tag">' + n + ' products</span></p></div>' +
        '<div class="foot"><button class="btn sm" data-edit="' + c.id + '">Edit</button><button class="btn sm danger" data-del="' + c.id + '">Delete</button></div></div>';
    }).join('') + '</div>';
    $('#addColl').onclick = function () { collForm(null); };
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) collForm(b.dataset.edit);
      if (b.dataset.del && confirm('Delete this collection? Products will stay, just untagged.')) {
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
      '<label>Accent colour<input type="color" name="accent" value="' + esc(d.accent) + '"></label>' +
      '<label class="full">Description<textarea name="description" rows="2">' + esc(d.description) + '</textarea></label>' +
      '<div class="full"><label style="margin-bottom:8px">Cover image (optional)</label><div class="uploader" id="coup"><div class="preview">' + prev() + '</div><div class="btns"><input type="file" accept="image/*"><button type="button" class="btn sm danger" data-rm-img>Remove</button></div></div></div>' +
      '<div class="full"><label style="margin-bottom:8px">Products in this collection</label><input id="cosearch" placeholder="Filter…" style="margin-bottom:8px"><div class="checks" id="coprods" style="max-height:220px;overflow:auto">' +
      db.products.map(function (p) { return '<label data-n="' + esc(p.name.toLowerCase()) + '"><input type="checkbox" value="' + p.id + '"' + (inColl.indexOf(p.id) > -1 ? ' checked' : '') + '> ' + esc(p.name) + '</label>'; }).join('') + '</div></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    bindUploader($('#coup'), prev, function (u) { d.image = u; });
    $('#cosearch').oninput = function (e) { var q = e.target.value.toLowerCase(); $$('#coprods label').forEach(function (l) { l.hidden = l.dataset.n.indexOf(q) < 0; }); };
    $('#coform').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      d.name = f.name.value.trim(); d.description = f.description.value.trim(); d.accent = f.accent.value;
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

  /* ----- Hero banners ----- */
  function hero(v) {
    setActions('<button class="btn primary" id="addHero">+ Add Slide</button>');
    v.innerHTML = '<p class="muted" style="margin-top:0">The first two banners show beside the globe at the top of the homepage. The rest show as wide banners below the categories. The globe headline is edited in Settings.</p><div class="cards">' + db.hero.map(function (h, i) {
      return '<div class="item-card"><div class="cover" style="background:linear-gradient(120deg,#050b1c,' + h.color + ')">' + (h.image ? '<img src="' + h.image + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color)) + '</div>' +
        '<div class="body"><small class="muted">SLIDE ' + (i + 1) + ' · ' + esc(h.eyebrow) + '</small><h4>' + esc(h.title).replace(/\n/g, ' ') + '</h4><p>' + esc(h.subtitle) + '</p></div>' +
        '<div class="foot"><button class="btn sm" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="btn sm" data-edit="' + i + '">Edit</button><button class="btn sm danger" data-del="' + i + '">Delete</button></div></div>';
    }).join('') + '</div>';
    $('#addHero').onclick = function () { heroForm(-1); };
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) heroForm(+b.dataset.edit);
      if (b.dataset.up) { var i = +b.dataset.up, t = db.hero[i]; db.hero[i] = db.hero[i - 1]; db.hero[i - 1] = t; commit('Order updated'); route(); }
      if (b.dataset.del) { if (db.hero.length <= 1) { alert('Keep at least one slide.'); return; } if (confirm('Delete this slide?')) { db.hero.splice(+b.dataset.del, 1); commit('Slide deleted'); route(); } }
    };
  }
  function heroForm(i) {
    var h = i > -1 ? JSON.parse(JSON.stringify(db.hero[i])) : { id: SCG.uid('h'), eyebrow: 'New Season', title: 'Your Headline\nHere', subtitle: '', cta: 'Shop Now', link: '#shop', color: '#0b2a6f', shape: 'tshirt', image: '' };
    function prev() { return h.image ? '<img src="' + h.image + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color); }
    var links = ['#shop'].concat(db.categories.map(function (c) { return '#category/' + c.id; }), db.collections.map(function (c) { return '#collection/' + c.id; }));
    openModal(i > -1 ? 'Edit Slide' : 'Add Slide',
      '<form class="form" id="hform"><label>Eyebrow (small label)<input name="eyebrow" value="' + esc(h.eyebrow) + '"></label>' +
      '<label>Button text<input name="cta" value="' + esc(h.cta) + '"></label>' +
      '<label class="full">Title <span class="hint">(new line = second animated line)</span><textarea name="title" rows="2" required>' + esc(h.title) + '</textarea></label>' +
      '<label class="full">Subtitle<input name="subtitle" value="' + esc(h.subtitle) + '"></label>' +
      '<label>Button link<input name="link" list="hlinks" value="' + esc(h.link) + '"><datalist id="hlinks">' + links.map(function (l) { return '<option value="' + l + '">'; }).join('') + '</datalist></label>' +
      '<label>Glow colour<input type="color" name="color" value="' + esc(h.color) + '"></label>' +
      '<label>Illustration (if no image)<select name="shape">' + SHAPES.map(function (s) { return '<option' + (s === h.shape ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<div class="full"><label style="margin-bottom:8px">Feature image (optional, e.g. model photo, transparent PNG works best)</label><div class="uploader" id="hup"><div class="preview">' + prev() + '</div><div class="btns"><input type="file" accept="image/*"><button type="button" class="btn sm danger" data-rm-img>Remove</button></div></div></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    var f = $('#hform');
    bindUploader($('#hup'), prev, function (u) { h.image = u; });
    f.shape.onchange = f.color.oninput = function () { h.shape = f.shape.value; h.color = f.color.value; if (!h.image) $('#hup .preview').innerHTML = prev(); };
    f.onsubmit = function (e) {
      e.preventDefault();
      ['eyebrow', 'cta', 'title', 'subtitle', 'link', 'color', 'shape'].forEach(function (k) { h[k] = f[k].value; });
      if (i > -1) db.hero[i] = h; else db.hero.push(h);
      commit('Slide saved'); closeModal(); route();
    };
  }

  /* ----- Orders ----- */
  function ordersView(v) {
    var os = orders();
    v.innerHTML = os.length ? '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>' +
      os.map(function (o, i) {
        return '<tr><td><b>' + esc(o.id) + '</b><br><small class="muted">' + new Date(o.date).toLocaleString() + '</small></td>' +
          '<td><b>' + esc(o.customer.name) + '</b><br><a href="tel:' + esc(o.customer.phone) + '">' + esc(o.customer.phone) + '</a><br><small class="muted">' + esc(o.customer.address) + '</small></td>' +
          '<td>' + o.items.map(function (it) { return esc(it.name) + ' <span class="muted">(' + esc(it.size) + ') ×' + it.qty + '</span>'; }).join('<br>') + '</td>' +
          '<td><b>' + SCG.money(o.total) + '</b></td>' +
          '<td><select data-st="' + i + '" style="width:auto">' + ['Pending', 'Confirmed', 'Shipped', 'Arrived in Sri Lanka', 'Delivered', 'Cancelled'].map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td>' +
          '<td><button class="btn sm danger" data-del="' + i + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="panel" style="text-align:center;padding:60px"><h3>No orders yet</h3><p class="muted">When customers check out on the website, their orders appear here.</p></div>';
    v.onchange = function (e) { var s = e.target.closest('[data-st]'); if (!s) return; var all = orders(); all[+s.dataset.st].status = s.value; SCG.saveOrders(all); toast('Status updated'); updatePill(); };
    v.onclick = function (e) { var b = e.target.closest('[data-del]'); if (!b) return; if (confirm('Delete this order?')) { var all = orders(); all.splice(+b.dataset.del, 1); SCG.saveOrders(all); route(); } };
  }

  /* ----- Settings ----- */
  function settings(v) {
    var s = db.settings;
    v.innerHTML =
      '<div class="panel"><h3>Store details</h3><form class="form" id="sform">' +
      '<label class="full">Announcement bar text<textarea name="announcement" rows="2">' + esc(s.announcement) + '</textarea></label>' +
      '<label class="full">Homepage globe headline (new line = second line)<textarea name="heroTitle" rows="2">' + esc(s.heroTitle) + '</textarea></label>' +
      '<label class="full">Homepage globe text<textarea name="heroSubtitle" rows="2">' + esc(s.heroSubtitle) + '</textarea></label>' +
      '<label>Currency symbol<input name="currency" value="' + esc(s.currency) + '"></label>' +
      '<label>Free delivery over (0 = never)<input name="freeShipping" type="number" min="0" value="' + (s.freeShipping || 0) + '"></label>' +
      '<label>Delivery fee<input name="shippingFee" type="number" min="0" value="' + (s.shippingFee || 0) + '"></label>' +
      '<label>Phone<input name="phone" value="' + esc(s.phone) + '"></label>' +
      '<label>Email<input name="email" type="email" value="' + esc(s.email) + '"></label>' +
      '<label>WhatsApp number <span class="hint">(international, digits only)</span><input name="whatsapp" value="' + esc(s.whatsapp) + '"></label>' +
      '<label class="full">Address<input name="address" value="' + esc(s.address) + '"></label>' +
      '<div class="form-foot"><button class="btn primary">Save details</button></div></form></div>' +

      '<div class="panel"><h3>Admin login</h3><form class="form" id="aform">' +
      '<label>Username<input name="adminUser" required value="' + esc(s.adminUser) + '"></label>' +
      '<label>New password<input name="adminPass" type="password" minlength="6" placeholder="Leave blank to keep current"></label>' +
      '<div class="form-foot"><button class="btn dark">Update login</button></div></form></div>' +

      '<div class="panel"><h3>Backup & data</h3><p class="muted" style="margin-top:0">Data is stored in this browser. Export a backup regularly, or import it on another computer.</p>' +
      '<div class="filters"><button class="btn" id="exp">⬇ Export JSON</button><label class="btn" style="display:inline-flex;color:var(--text);font-size:13px">⬆ Import JSON<input type="file" accept="application/json" id="imp" hidden></label>' +
      '<button class="btn danger" id="rst">Reset to demo data</button></div></div>';
    $('#sform').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      ['announcement', 'heroTitle', 'heroSubtitle', 'currency', 'phone', 'email', 'whatsapp', 'address'].forEach(function (k) { s[k] = f.elements[k].value.trim(); });
      s.freeShipping = +f.elements.freeShipping.value || 0; s.shippingFee = +f.elements.shippingFee.value || 0;
      commit('Store details saved');
    };
    $('#aform').onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      s.adminUser = f.adminUser.value.trim(); if (f.adminPass.value) s.adminPass = f.adminPass.value;
      commit('Login updated'); f.adminPass.value = '';
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
    $('#rst').onclick = function () {
      if (confirm('Reset ALL products, categories, collections and banners to the demo data?')) { db = SCG.reset(); toast('Demo data restored'); route(); }
    };
  }

  if (loggedIn()) showApp();
})();
