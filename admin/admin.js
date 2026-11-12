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
  // Signed in = signed in on this browser within the last 12 hours (shared by all tabs; Log out ends it everywhere).
  function loggedIn() {
    try { var t = +localStorage.getItem('scg_admin_on'); return !!t && Date.now() - t < 12 * 3600e3; }
    catch (e) { try { return sessionStorage.getItem(SESSION) === '1'; } catch (e2) { return false; } }
  }
  window.addEventListener('storage', function (e) { if (e.key === 'scg_admin_on' && !e.newValue) location.reload(); });
  function showApp() { try { localStorage.setItem('scg_admin_on', String(Date.now())); } catch (e) {} $('#login').hidden = true; $('#shell').hidden = false; route(); }
  // Older saves kept the password as plain text: hash it once and remove the plain copy.
  (function upgradePassword() {
    var st = db.settings;
    if (st.adminPass === undefined) return;
    var plain = st.adminPass, salt = SCG.uid('s');
    SCG.hashPassword(plain, salt).then(function (h) {
      if (plain !== 'admin123') { st.adminPassHash = h; st.adminSalt = salt; st.adminDefault = false; }
      delete st.adminPass; SCG.save(); if ($('#defHint')) $('#defHint').hidden = st.adminDefault === false;
    });
  })();
  if (db.settings.adminDefault === false && $('#defHint')) $('#defHint').hidden = true;
  $('#loginForm').onsubmit = function (e) {
    e.preventDefault();
    var f = e.target, st = db.settings, user = f.elements.user.value.trim(), pass = f.elements.pass.value;
    var check = st.adminPassHash ? SCG.hashPassword(pass, st.adminSalt || '').then(function (h) { return h === st.adminPassHash; }) : Promise.resolve(pass === 'admin123');
    check.then(function (ok) {
      if (ok && user === st.adminUser) {
        try { sessionStorage.setItem(SESSION, '1'); } catch (err) {}
        showApp();
      } else $('#loginErr').textContent = 'Incorrect username or password.';
    });
  };
  // Website edit mode: the ADMIN bar on the site only appears after "Edit on Website".
  $('#editSite').onclick = function () { try { localStorage.setItem('scg_edit_mode', '1'); } catch (e) {} };
  $('#viewSite').onclick = function () { try { localStorage.removeItem('scg_edit_mode'); } catch (e) {} };
  $('#logout').onclick = function () { try { sessionStorage.removeItem(SESSION); localStorage.removeItem('scg_admin_on'); localStorage.removeItem('scg_edit_mode'); } catch (e) {} location.hash = ''; location.reload(); };
  $('#menuBtn').onclick = function (e) { e.stopPropagation(); $('#side').classList.toggle('open'); };
  document.addEventListener('click', function (e) { if (!e.target.closest('#side') && !e.target.closest('#menuBtn')) $('#side').classList.remove('open'); });

  /* ---------------- helpers ---------------- */
  var tt;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function commit(msg) { if (SCG.save()) { toast(msg || 'Saved'); return true; } toast('Not saved: browser storage is full. Remove photos or use image links.'); return false; }
  // every admin form: a required box that only has spaces counts as empty
  document.addEventListener('submit', function (e) {
    var bad = Array.prototype.filter.call(e.target.querySelectorAll('input[required], textarea[required]'), function (x) { return x.type !== 'number' && x.type !== 'file' && !x.value.trim(); })[0];
    if (bad) { e.preventDefault(); e.stopImmediatePropagation(); bad.value = ''; bad.focus(); var lb = ((bad.closest('label') || {}).firstChild || {}).textContent; toast('Please fill in ' + (lb && lb.trim() ? lb.trim() : 'this box')); }
  }, true);
  // inline number fields: no negative numbers, and a price can't be empty or 0
  function okNum(input, p, f) {
    var v = +input.value, bad = input.value === '' || isNaN(v) || v < 0 || (f === 'price' && v <= 0);
    if (bad) { input.value = p[f] || 0; toast(f === 'price' ? 'Price must be more than 0' : 'Please enter 0 or more'); return false; }
    return true;
  }
  function openModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').classList.add('open'); }
  function closeModal() { $('#modal').classList.remove('open'); }
  $('#modal').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  function setActions(html) { $('#topActions').innerHTML = html || ''; }
  function preview(hash, label) { return '<a class="btn" target="_blank" rel="noopener" data-edit-mode href="' + SITE + (hash || '') + '">' + (label || 'Preview on site') + ' ↗</a>'; }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-edit-mode]')) { try { localStorage.setItem('scg_edit_mode', '1'); } catch (err) {} } });
  function thumb(p, color) { return '<div class="thumb" style="background:' + SCG.shade(color || p.color || '#0b2a6f', 165) + '">' + SCG.productVisual(p, color) + '</div>'; }
  function countIn(catId) { return db.products.filter(function (p) { return p.category === catId; }).length; }
  function orders() { return SCG.getOrders(); }
  function updatePill() { var n = orders().filter(function (o) { return o.status === 'Pending'; }).length; $('#orderPill').textContent = n || ''; }
  function statusTag(s) { return '<span class="tag ' + ({ Pending: 'warn', Delivered: 'ok', Cancelled: 'red' }[s] || '') + '">' + esc(s) + '</span>'; }
  function sw(name, on, label) { return '<label class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><i></i>' + (label || '') + '</label>'; }
  function originOptions(sel) {
    return SCG.origins().map(function (o) { return '<option value="' + o.id + '"' + (o.id === sel ? ' selected' : '') + '>' + esc(o.name) + (o.on ? '' : ' (off)') + '</option>'; }).join('') +
      '<option value="local"' + (!sel || sel === 'local' ? ' selected' : '') + '>Colombo stock</option>';
  }
  function originName(id) { var o = SCG.originById(id); return o ? o.name : 'Colombo'; }
  function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function storageMeter() {
    var used = SCG.storageUsed(), cap = 5 * 1048576, pct = Math.min(100, used / cap * 100);
    return '<div class="meter"><div><b>' + fmtBytes(used) + '</b> of about 5 MB browser storage used</div><div class="bar-track"><i style="width:' + pct + '%;' + (pct > 80 ? 'background:var(--red)' : '') + '"></i></div>' +
      (pct > 80 ? '<small style="color:var(--red)">Storage is nearly full. Use image links instead of uploads, or remove unused photos.</small>' : '<small class="muted">Uploaded photos are compressed. Image links (URLs) use almost no space.</small>') + '</div>';
  }
  function waNumber(phone) { var d = String(phone || '').replace(/\D/g, ''); if (d.indexOf('0') === 0) d = '94' + d.slice(1); return d; }
  function bindUploader(root, current, onChange) {
    var file = $('input[type=file]', root), prev = $('.preview', root);
    file.onchange = function () {
      if (!file.files[0]) return;
      SCG.imageToDataURL(file.files[0], 900).then(function (url) { prev.innerHTML = '<img src="' + SCG.imgSrc(url) + '" alt="">'; onChange(url); })
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
    editor: { title: 'Visual Editor', sub: 'Your website with click-to-edit. Point at anything and click ✎ Edit.', render: editorView },
    dashboard: { title: 'Dashboard', sub: 'Your store at a glance', render: dashboard },
    orders: { title: 'Orders', sub: 'Orders placed on the website', render: ordersView },
    customers: { title: 'Customers', sub: 'Everyone who has ordered', render: customers },
    products: { title: 'Products', sub: 'Everything listed on the site', render: products },
    flash: { title: 'Flash Sale', sub: 'Countdown, timing and flash deals', render: flashView },
    categories: { title: 'Categories', sub: 'Category menu, grid and filters', render: categories },
    collections: { title: 'Collections', sub: 'Open a collection to manage the products inside it', render: collections },
    origins: { title: 'Import Countries', sub: 'Countries you import from, delivery times and globe routes', render: originsView },
    homepage: { title: 'Homepage & Globe', sub: 'Globe hero, section order and service icons', render: homepage },
    banners: { title: 'Promo Banners', sub: 'Banners beside the globe and below categories', render: banners },
    header: { title: 'Header & Footer', sub: 'Announcement bar, menu links and footer', render: headerView },
    pages: { title: 'Importing Page & FAQ', sub: '“How importing works” page and help answers', render: pages },
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
    var arg = decodeURIComponent(parts.slice(1).join('/'));
    $('#shell').classList.toggle('pv-full', key === 'editor');
    var pr = PV_PAGES[key]; pvShow(typeof pr === 'function' ? pr(arg) : pr);
    VIEWS[key].render(v, arg);
    updatePill();
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
     LIVE PREVIEW PANEL + CLICK-TO-EDIT
     ========================================================= */
  // which website page each admin screen previews (undefined = no preview)
  var PV_PAGES = {
    editor: function () { return pv.page || ''; }, homepage: '', banners: '', header: '', settings: '#help',
    pages: '#china-direct', flash: '#flash', categories: '#categories',
    products: function (a) { return a && a.indexOf('edit:') === 0 ? '#p/' + a.slice(5) : undefined; },   // keep the table full width
    collections: function (a) { return a ? '#col/' + a : '#shop'; }
  };
  var pv = { page: '', dev: 'desktop', loaded: false, hidden: false };
  try { pv.hidden = localStorage.getItem('scg_pv_hidden') === '1'; } catch (e) {}
  var pvIf = $('#pvIf');
  function pvPages() {
    var opts = [['', 'Home'], ['#shop', 'All products'], ['#flash', 'Flash sale'], ['#categories', 'Categories']]
      .concat(db.collections.map(function (c) { return ['#col/' + c.id, 'Collection: ' + c.name]; }))
      .concat(db.categories.map(function (c) { return ['#c/' + c.id, 'Category: ' + c.name]; }))
      .concat(db.products[0] ? [['#p/' + db.products[0].id, 'A product page']] : [])
      .concat([['#china-direct', 'How importing works'], ['#help', 'Help'], ['#cart', 'Cart'], ['#account', 'My account']]);
    if (pv.page && !opts.some(function (o) { return o[0] === pv.page; })) opts.unshift([pv.page, 'Current page']);
    $('#pvPage').innerHTML = opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === pv.page ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function pvScale() {
    var fr = $('#pvFrame'), fw = fr.clientWidth, fh = fr.clientHeight; if (!fw) return;
    var W = pv.dev === 'mobile' ? 390 : 1280, fit = Math.min(1, fw / W);
    var k = pv.zoom === 'fit' ? fit : +pv.zoom;
    if (pv.dev === 'mobile' && pv.zoom !== 'fit') k = Math.min(1, k * 1.6);   // phone view needs less shrinking
    var sz = $('#pvSizer');
    sz.style.width = Math.round(W * k) + 'px'; sz.style.height = fh - (W * k > fw ? 12 : 0) + 'px';
    pvIf.style.width = W + 'px'; pvIf.style.height = Math.round(sz.clientHeight / k) + 'px';
    pvIf.style.transform = 'scale(' + k + ')';
    fr.classList.toggle('scrolls', W * k > fw + 1);
  }
  // ---- resizable split between the admin and the preview ----
  pv.zoom = 'fit';
  try { pv.zoom = localStorage.getItem('scg_pv_zoom') || 'fit'; } catch (e) {}
  $('#pvZoom').value = pv.zoom;
  $('#pvZoom').onchange = function (e) { pv.zoom = e.target.value; try { localStorage.setItem('scg_pv_zoom', pv.zoom); } catch (err) {} pvScale(); };
  function pvWidthKey() { return $('#shell').classList.contains('pv-full') ? 'scg_pv_wf' : 'scg_pv_w'; }
  function pvApplyWidth() {
    var w = null; try { w = localStorage.getItem(pvWidthKey()); } catch (e) {}
    var full = $('#shell').classList.contains('pv-full');
    var px = w ? +w : Math.round((innerWidth - 250) * (full ? .72 : .5));
    px = Math.max(360, Math.min(px, innerWidth - 250 - (full ? 240 : 380)));
    document.documentElement.style.setProperty('--pvw', px + 'px');
    pvScale();
  }
  (function () {
    var sp = $('#pvSplit'), drag = false;
    function move(x) {
      var full = $('#shell').classList.contains('pv-full');
      var px = Math.max(360, Math.min(innerWidth - x, innerWidth - 250 - (full ? 240 : 380)));
      document.documentElement.style.setProperty('--pvw', px + 'px'); pvScale();
      try { localStorage.setItem(pvWidthKey(), String(px)); } catch (e) {}
    }
    sp.addEventListener('pointerdown', function (e) { drag = true; sp.setPointerCapture(e.pointerId); document.body.classList.add('pv-dragging'); e.preventDefault(); });
    sp.addEventListener('pointermove', function (e) { if (drag) move(e.clientX); });
    function end() { drag = false; document.body.classList.remove('pv-dragging'); }
    sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
    sp.addEventListener('dblclick', function () { try { localStorage.removeItem(pvWidthKey()); } catch (e) {} pvApplyWidth(); });
    sp.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault();
      var cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pvw'), 10) || 600;
      move(innerWidth - cur + (e.key === 'ArrowLeft' ? -40 : 40));
    });
  })();
  function pvGo(page) {
    pv.page = page || '';
    $('#pvOpen').href = SITE + pv.page;
    if (!pv.loaded) { pv.loaded = true; pvIf.src = SITE + '?preview=1' + pv.page; }
    else { try { var w = pvIf.contentWindow; if (w.location.hash !== pv.page) w.location.hash = pv.page || '#'; } catch (e) { pvIf.src = SITE + '?preview=1' + pv.page; } }
    pvPages();
  }
  function pvNarrow() { return innerWidth <= 1100; }
  function pvShow(page) {
    var shell = $('#shell'), has = page !== undefined && page !== null;
    // big screens: beside the editor unless hidden; smaller screens: a sheet you open with "Show preview"
    var visible = !!(has && (shell.classList.contains('pv-full') || (pvNarrow() ? pv.sheet : !pv.hidden)));
    shell.classList.toggle('has-pv', visible);
    $('#pv').hidden = !visible; $('#pvFab').hidden = !(has && !visible);
    document.body.classList.toggle('pv-on', visible); document.body.classList.toggle('pv-wide', visible && shell.classList.contains('pv-full'));
    if (visible) { pvGo(page); pvApplyWidth(); requestAnimationFrame(pvScale); }
  }
  $('#pvPage').onchange = function (e) { pvGo(e.target.value); };
  $('#pvReload').onclick = function () { pvIf.src = SITE + '?preview=1' + pv.page; };
  $('#pvHide').onclick = function () { if (pvNarrow()) { pv.sheet = false; if ($('#shell').classList.contains('pv-full')) { location.hash = 'dashboard'; } else route(); return; } pv.hidden = true; try { localStorage.setItem('scg_pv_hidden', '1'); } catch (e) {} if ($('#shell').classList.contains('pv-full')) location.hash = 'dashboard'; else route(); };
  $('#pvFab').onclick = function () { if (pvNarrow()) { pv.sheet = true; route(); return; } pv.hidden = false; try { localStorage.removeItem('scg_pv_hidden'); } catch (e) {} route(); };
  $$('.pv-dev button').forEach(function (b) { b.onclick = function () { pv.dev = b.dataset.dev; $$('.pv-dev button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('#pvFrame').classList.toggle('mobile', pv.dev === 'mobile'); pvScale(); }; });
  window.addEventListener('resize', function () { if (!$('#pv').hidden) pvApplyWidth(); });
  if ('ResizeObserver' in window) new ResizeObserver(pvScale).observe($('#pvFrame'));
  function currentHash() { return location.hash.replace('#', '') || 'dashboard'; }

  // messages from the preview: open the right editor or apply a new photo
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== pvIf.contentWindow || !e.data || !loggedIn()) return;
    var d = e.data;
    if (d.type === 'scg-page') { pv.page = d.page || ''; $('#pvOpen').href = SITE + pv.page; pvPages(); return; }
    if (d.type === 'scg-edit') {
      var go = { services: 'homepage', sections: 'homepage', flash: 'flash', origins: 'origins', header: 'header', settings: 'settings', pages: 'pages' };
      if (d.ed === 'product') productForm(d.id, { back: currentHash() });
      else if (d.ed === 'banner') bannerForm(d.i);
      else if (d.ed === 'category') catForm(d.id);
      else if (d.ed === 'collection') location.hash = 'collections/' + d.id;
      else if (d.ed === 'hero') heroForm();
      else if (go[d.ed]) location.hash = go[d.ed];
      return;
    }
    if (d.type === 'scg-photo' && typeof d.url === 'string' && /^data:image\//.test(d.url)) {
      var name = '';
      if (d.ed === 'product') { var p = SCG.productById(d.id); if (!p) return; var imgs = SCG.productImages(p).slice(); imgs[0] = d.url; p.images = imgs.slice(0, 8); p.image = d.url; name = p.name; }
      else if (d.ed === 'banner') { if (!db.hero[d.i]) return; db.hero[d.i].image = d.url; name = db.hero[d.i].title; }
      else if (d.ed === 'category') { var c = SCG.categoryById(d.id); if (!c) return; c.image = d.url; name = c.name; }
      else if (d.ed === 'collection') { var co = SCG.collectionById(d.id); if (!co) return; co.image = d.url; name = co.name; }
      else return;
      if (commit('Photo changed: ' + name) && !$('#modal').classList.contains('open')) route();
    }
  });
  // the preview (or another tab) saved something: pick it up so we never overwrite it
  window.addEventListener('storage', function (e) {
    if (e.key !== SCG.keys.DB_KEY || !e.newValue) return;
    db = SCG.reload();
    if (loggedIn() && !$('#modal').classList.contains('open')) route();
  });

  /* Globe headline: quick editor opened from the preview */
  function heroForm() {
    var s = db.settings;
    openModal('Globe headline',
      '<form class="form" id="heroF"><label class="full">Headline (new line = second, gold line)<textarea name="t" rows="2">' + esc(s.heroTitle) + '</textarea></label>' +
      '<label class="full">Text under the headline<textarea name="s" rows="3">' + esc(s.heroSubtitle) + '</textarea></label>' +
      '<p class="full muted" style="margin:0;font-size:12.5px">Numbers, timeline, cities and the welcome intro are in <a href="#homepage" data-close style="color:var(--red)">Homepage &amp; Globe</a>.</p>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    $('#heroF').onsubmit = function (e) { e.preventDefault(); s.heroTitle = e.target.elements.t.value.trim(); s.heroSubtitle = e.target.elements.s.value.trim(); commit('Headline saved'); closeModal(); };
  }

  /* Visual Editor: the website, big, with shortcuts on the left */
  function editorView(v) {
    if (pv.hidden) { pv.hidden = false; try { localStorage.removeItem('scg_pv_hidden'); } catch (e) {} pvShow(pv.page || ''); }
    var jump = [['', 'Home page'], ['#shop', 'All products'], ['#flash', 'Flash sale'], ['#categories', 'Categories'], ['#china-direct', 'Importing page']]
      .concat(db.collections.slice(0, 7).map(function (c) { return ['#col/' + c.id, c.name]; }));
    v.innerHTML =
      '<div class="ed-help"><h3>How to edit</h3><ol><li><b>Point</b> at anything on the website: a product, banner, category, headline, menu or footer.</li><li>Click <b>✎ Edit</b> to change its text, price or settings.</li><li>Click <b>🖼 Change photo</b> to pick a new picture from your computer or phone.</li><li>Changes save straight away and appear in the preview.</li></ol></div>' +
      '<div class="ed-help"><h3>Go to a page</h3><div class="ed-jump">' + jump.map(function (j) { return '<button type="button" data-p="' + esc(j[0]) + '">' + esc(j[1]) + '</button>'; }).join('') + '</div></div>' +
      '<div class="ed-help"><h3>Add something new</h3><div class="ed-jump"><button type="button" data-new="product">+ Product</button><button type="button" data-new="banner">+ Banner</button><button type="button" data-new="collection">+ Collection</button><button type="button" data-new="category">+ Category</button></div></div>';
    v.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.p !== undefined) pvGo(b.dataset.p);
      if (b.dataset.new === 'product') productForm(null, { back: 'editor' });
      if (b.dataset.new === 'banner') bannerForm(-1);
      if (b.dataset.new === 'category') catForm(null);
      if (b.dataset.new === 'collection') { var id = SCG.uid('collection'); db.collections.push({ id: id, name: 'New collection', description: '', accent: '#0b2a6f', image: '', order: [] }); commit('Collection created'); location.hash = 'collections/' + id; }
    };
  }

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
    v.innerHTML = launchChecklist() +
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
  /* What still has to change before real customers use the shop. */
  function launchChecklist() {
    var s = db.settings, demo = db.products.filter(SCG.isDemoProduct).length;
    var noPhoto = db.products.filter(function (p) { return !SCG.productImages(p).length; }).length;
    var items = [
      [s.adminDefault === false, 'Change the admin password from the default', '#settings'],
      [s.phone && s.phone.replace(/\D/g, '') !== '94770000000', 'Enter your real phone number', '#settings'],
      [s.whatsapp && s.whatsapp !== '94770000000', 'Enter your real WhatsApp number', '#settings'],
      [!/0000000000/.test(s.bankDetails || '') || !s.payBank, 'Enter real bank details (or turn bank transfer off)', '#settings'],
      [!(s.globeStats || []).some(function (x) { return x.value === '1,248'; }), 'Replace the sample numbers under the globe', '#homepage'],
      [!demo, demo + ' demo products are still listed (prices, ratings and sold counts are made up)', '#settings'],
      [!noPhoto, noPhoto + ' products have no real photo yet', '#products/'],
      [false, 'Connect an online database so orders from every phone reach this panel', null, 'Needs the backend step'],
      [false, 'Server-side admin login (the current one runs in the browser)', null, 'Needs the backend step']
    ];
    var done = items.filter(function (x) { return x[0]; }).length;
    if (done === items.length) return '';
    return '<div class="panel checklist"><div class="head"><h3>Before you go live <small>' + done + ' of ' + items.length + ' done</small></h3><div class="bar-track" style="width:200px"><i style="width:' + (done / items.length * 100) + '%"></i></div></div>' +
      items.map(function (x) {
        return '<div class="ck' + (x[0] ? ' ok' : '') + '"><span class="ck-i">' + (x[0] ? '✓' : '!') + '</span><span>' + esc(x[1]) + '</span>' +
          (x[0] ? '' : x[2] ? '<a class="btn sm" href="' + x[2] + '"' + (x[2] === '#products/' ? ' data-nophoto' : '') + '>Fix</a>' : '<span class="tag">' + esc(x[3]) + '</span>') + '</div>';
      }).join('') + '</div>';
  }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-nophoto]')) pf.extra = 'nophoto'; });
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
      '<div class="filters"><input id="pq" type="search" aria-label="Search products" placeholder="Search name, brand or SKU…" value="' + esc(pf.q) + '">' +
      '<select id="pc" aria-label="Filter by category"><option value="all">All categories</option>' + db.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + ' (' + countIn(c.id) + ')</option>'; }).join('') + '</select>' +
      '<select id="pco" aria-label="Filter by collection"><option value="all">All collections</option>' + db.collections.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<select id="px" aria-label="Filter by status"><option value="all">Any status</option><option value="flash">In flash sale</option>' + SCG.origins().map(function (o) { return '<option value="o:' + o.id + '">From ' + esc(o.name) + '</option>'; }).join('') + '<option value="o:local">Colombo stock</option><option value="low">Low stock (≤5)</option><option value="out">Out of stock</option><option value="nophoto">No photo yet</option></select>' +
      '<span class="muted" id="pcount" style="align-self:center"></span></div>' +
      '<div class="bulkbar" id="bulk" hidden><b id="bn"></b>' +
        '<button class="btn sm" data-b="flash-on">⚡ Add to flash sale</button><button class="btn sm" data-b="flash-off">Remove from flash</button>' +
        '<span style="display:inline-flex;gap:4px"><input id="bdisc" type="number" aria-label="Discount percent" min="1" max="90" placeholder="% off" style="width:80px"><button class="btn sm" data-b="disc">Apply discount</button></span>' +
        '<span style="display:inline-flex;gap:4px"><select id="borig" aria-label="Ships from">' + originOptions('china') + '</select><button class="btn sm" data-b="origin">Set ships from</button></span>' +
        '<span style="display:inline-flex;gap:4px"><select id="bcoll" aria-label="Collection">' + db.collections.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select><button class="btn sm" data-b="coll">Add to collection</button></span>' +
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
        if (pf.extra.indexOf('o:') === 0 && (p.origin || 'local') !== pf.extra.slice(2)) return false;
        if (pf.extra === 'low' && p.stock > 5) return false;
        if (pf.extra === 'out' && p.stock > 0) return false;
        if (pf.extra === 'nophoto' && SCG.productImages(p).length) return false;
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
          '<td><input class="inline" type="number" min="0" data-f="price" value="' + p.price + '" aria-label="Price">' + (off ? '<br><small class="muted"><s>' + money(p.comparePrice) + '</s> -' + off + '%</small>' : '') + '</td>' +
          '<td><input class="inline" type="number" min="0" data-f="stock" value="' + p.stock + '" aria-label="Stock" style="width:64px' + (p.stock <= 5 ? ';border-color:#f59e0b' : '') + '"></td>' +
          '<td><select data-f="origin" aria-label="Ships from" style="width:auto;padding:6px">' + originOptions(p.origin) + '</select></td>' +
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
      if (f !== 'origin' && !okNum(e.target, p, f)) return;
      p[f] = f === 'origin' ? e.target.value : Math.max(0, Math.round(+e.target.value || 0));
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
        if (act === 'origin') p.origin = $('#borig').value;
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

  function productForm(id, opts) {
    opts = opts || {};
    if (id && !$('#pv').hidden) pvGo('#p/' + id);
    var p = id ? SCG.productById(id) : null, isNew = !p;
    var d = p ? JSON.parse(JSON.stringify(p)) : {
      name: '', category: pf.cat !== 'all' ? pf.cat : db.categories[0].id, collections: opts.collection ? [opts.collection] : [], price: 0, comparePrice: 0, stock: 20,
      color: '#0b2a6f', accent: '#f3f4f6', shape: '', pattern: 'solid', brand: 'SC Global', origin: 'china', flash: false,
      rating: 0, reviews: 0, sold: 0, image: '', images: [], sizes: ['S', 'M', 'L', 'XL', 'XXL'], badge: 'New', featured: false, description: ''
    };
    d.images = SCG.productImages(d).slice();
    function curShape() { var c = SCG.categoryById(d.category); return d.shape || (c ? c.shape : 'tshirt'); }
    function prev() { return d.images[0] ? '<img src="' + SCG.imgSrc(d.images[0]) + '" alt="">' : SCG.productSVG(curShape(), d.color, d.pattern, d.accent); }
    openModal(isNew ? 'Add Product' : 'Edit Product',
      '<form class="form" id="pform">' +
      '<label class="full">Product name<input name="name" required value="' + esc(d.name) + '" placeholder="e.g. Classic Crew Tee"></label>' +
      '<label>Category<select name="category">' + db.categories.map(function (c) { return '<option value="' + c.id + '"' + (c.id === d.category ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Brand<input name="brand" value="' + esc(d.brand || '') + '"></label>' +
      '<label>Price (' + esc(db.settings.currency) + ')<input name="price" type="number" min="1" required value="' + d.price + '"></label>' +
      '<label>Original price (before discount)<input name="comparePrice" type="number" min="0" placeholder="Optional, shows -% off" value="' + (d.comparePrice || '') + '"></label>' +
      '<label>Stock quantity<input name="stock" type="number" min="0" required value="' + d.stock + '"></label>' +
      '<label>Ships from<select name="origin">' + originOptions(d.origin) + '</select></label>' +
      '<label>Badge<select name="badge">' + BADGES.map(function (b) { return '<option' + (b === d.badge ? ' selected' : '') + ' value="' + b + '">' + (b || 'None') + '</option>'; }).join('') + '</select></label>' +
      '<label>Rating (0–5)<input name="rating" type="number" min="0" max="5" step="0.1" value="' + (d.rating || 0) + '"></label>' +
      '<label>Ratings count<input name="reviews" type="number" min="0" value="' + (d.reviews || 0) + '"></label>' +
      '<label>Units sold<input name="sold" type="number" min="0" value="' + (d.sold || 0) + '"></label>' +
      '<label class="full">Sizes (comma separated, leave empty for bags and watches)<input name="sizes" value="' + esc((d.sizes || []).join(', ')) + '"></label>' +
      '<div class="full"><label style="margin-bottom:8px">Collections</label><div class="checks">' + db.collections.map(function (c) {
        return '<label><input type="checkbox" name="collections" value="' + c.id + '"' + ((d.collections || []).indexOf(c.id) > -1 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
      }).join('') + '</div></div>' +
      '<div class="full"><label style="margin-bottom:8px">Product photos <span class="hint">(up to 8; the first one is the main photo)</span></label>' +
        '<div class="gal" id="gal"></div>' +
        '<div class="gal-add"><label class="btn sm">⬆ Upload photos<input type="file" accept="image/*" multiple id="gfile" hidden></label>' +
        '<input id="gurl" type="url" aria-label="Image link" placeholder="…or paste an image link (https://…)"><button type="button" class="btn sm" id="gurlBtn">Add link</button></div>' +
        '<div id="gmeter">' + storageMeter() + '</div></div>' +
      '<label>Illustration<select name="shape"><option value="">Same as category</option>' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (s === d.shape ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Pattern<select name="pattern">' + SCG.PATTERNS.map(function (s) { return '<option' + (s === (d.pattern || 'solid') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Main colour<input name="color" type="color" value="' + esc(d.color) + '"></label>' +
      '<label>Accent colour<input name="accent" type="color" value="' + esc(d.accent || '#f3f4f6') + '"></label>' +
      '<label class="full">Description<textarea name="description" rows="3">' + esc(d.description) + '</textarea></label>' +
      '<div class="full" style="display:flex;gap:18px;flex-wrap:wrap">' + sw('flash', d.flash, 'Show in Flash Sale') + sw('featured', d.featured, 'Featured') + '</div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">' + (isNew ? 'Add Product' : 'Save Changes') + '</button></div></form>');
    var f = $('#pform'), E = f.elements;
    function drawGal() {
      $('#gal').innerHTML = (d.images.length ? d.images.map(function (src, i) {
        return '<div class="g" data-i="' + i + '"><img src="' + esc(src) + '" alt="">' + (i ? '' : '<span class="main">MAIN</span>') +
          '<div class="g-tools"><button type="button" data-l title="Move left">←</button><button type="button" data-m title="Make main">★</button><button type="button" data-x title="Remove">✕</button></div></div>';
      }).join('') : '<div class="g empty">' + prev() + '<span class="hint">No photos yet. The illustration is shown on the site.</span></div>');
    }
    drawGal();
    $('#gal').onclick = function (e) {
      var g = e.target.closest('[data-i]'), b = e.target.closest('button'); if (!g || !b) return;
      var i = +g.dataset.i, im = d.images;
      if (b.hasAttribute('data-x')) im.splice(i, 1);
      if (b.hasAttribute('data-m')) im.unshift(im.splice(i, 1)[0]);
      if (b.hasAttribute('data-l') && i > 0) im.splice(i - 1, 0, im.splice(i, 1)[0]);
      drawGal();
    };
    $('#gfile').onchange = function (e) {
      var files = Array.prototype.slice.call(e.target.files, 0, Math.max(0, 8 - d.images.length));
      if (!files.length) { toast('Up to 8 photos per product'); return; }
      toast('Processing ' + files.length + ' photo(s)…');
      Promise.all(files.map(function (fl) { return SCG.imageToDataURL(fl, 800).catch(function () { return null; }); })).then(function (urls) {
        var ok = urls.filter(Boolean); d.images = d.images.concat(ok); drawGal();
        toast(ok.length + ' photo(s) added' + (ok.length < urls.length ? ', some could not be read' : ''));
        e.target.value = '';
      });
    };
    $('#gurlBtn').onclick = function () {
      var u = $('#gurl').value.trim();
      if (!/^https?:\/\/\S+$/i.test(u)) { toast('Paste a full image link that starts with https://'); return; }
      if (d.images.length >= 8) { toast('Up to 8 photos per product'); return; }
      var test = new Image();
      test.onload = function () { d.images.push(u); $('#gurl').value = ''; drawGal(); toast('Image link added'); };
      test.onerror = function () { toast('That link did not load as an image'); };
      test.src = u;
    };
    E.category.onchange = E.color.oninput = E.accent.oninput = E.shape.onchange = E.pattern.onchange = function () {
      d.category = E.category.value; d.color = E.color.value; d.accent = E.accent.value; d.shape = E.shape.value; d.pattern = E.pattern.value;
      if (!d.images.length) drawGal();
    };
    f.onsubmit = function (e) {
      e.preventDefault();
      if (!E.name.value.trim()) { toast('Please type a product name'); E.name.focus(); return; }
      var out = Object.assign(d, {
        name: E.name.value.trim(), category: E.category.value, badge: E.badge.value, brand: E.brand.value.trim(),
        price: +E.price.value || 0, comparePrice: +E.comparePrice.value || 0, stock: +E.stock.value || 0,
        color: E.color.value, accent: E.accent.value, shape: E.shape.value, pattern: E.pattern.value, origin: E.origin.value,
        rating: Math.min(5, +E.rating.value || 0), reviews: +E.reviews.value || 0, sold: +E.sold.value || 0,
        sizes: E.sizes.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        collections: $$('input[name=collections]:checked', f).map(function (x) { return x.value; }),
        description: E.description.value.trim(), featured: E.featured.checked, flash: E.flash.checked
      });
      out.images = d.images.slice(0, 8); out.image = out.images[0] || '';
      if (isNew) { out.id = SCG.uid(out.category); out.createdAt = Date.now(); db.products.unshift(out); }
      else db.products[db.products.indexOf(p)] = out;
      if (!commit(isNew ? 'Product added' : 'Product updated')) return;
      closeModal();
      if (isNew && opts.collection) { var oc = SCG.collectionById(opts.collection); if (oc) oc.order = [out.id].concat(oc.order || []); SCG.save(); }
      var back = opts.back || (location.hash.indexOf('#flash') === 0 ? 'flash' : 'products');
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
        '<div class="filters"><input id="fpct" type="number" aria-label="Discount percent for all flash products" min="1" max="90" placeholder="% off" style="min-width:0;width:100px"><button class="btn" id="fapply">Apply % to all flash products</button></div>' +
        '<div class="filters"><button class="btn" id="fadd">+ Add products to flash sale</button><button class="btn danger" id="fclear">Remove all from flash</button></div></div></div>' +
      '<div class="panel" style="padding:0;overflow:hidden"><div class="table-wrap" style="border:0"><table><thead><tr><th>Product</th><th>Flash price</th><th>Original price</th><th>Discount</th><th>Stock</th><th></th></tr></thead><tbody id="ftb">' +
      (list.length ? list.map(function (p) {
        return '<tr data-id="' + p.id + '"><td><div class="prod-cell">' + thumb(p) + '<b>' + esc(p.name) + '</b></div></td>' +
          '<td><input class="inline" type="number" min="0" data-f="price" aria-label="Flash price" value="' + p.price + '"></td>' +
          '<td><input class="inline" type="number" min="0" data-f="comparePrice" aria-label="Original price" value="' + (p.comparePrice || '') + '"></td>' +
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
      var p = SCG.productById(tr.dataset.id); if (!okNum(e.target, p, f)) return; p[f] = Math.max(0, Math.round(+e.target.value || 0)); commit('Price updated'); route();
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
      openModal('Add to Flash Sale', '<input id="fs" aria-label="Search products" placeholder="Search products…" style="margin-bottom:10px"><div class="checks" id="fl" style="max-height:340px;overflow:auto">' +
        others.map(function (p) { return '<label data-n="' + esc(p.name.toLowerCase()) + '"><input type="checkbox" value="' + p.id + '"> ' + esc(p.name) + ' <span class="muted">' + money(p.price) + '</span></label>'; }).join('') +
        '</div><div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><input id="fpct2" type="number" aria-label="Discount percent (optional)" min="0" max="90" placeholder="% off (optional)" style="width:160px"><button class="btn primary" id="fok">Add selected</button></div>');
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
      return '<div class="item-card"><div class="cover" style="background:radial-gradient(circle,' + SCG.shade(color, 170) + ',' + SCG.shade(color, 110) + ')">' + (c.image ? '<img src="' + SCG.imgSrc(c.image) + '" alt="">' : SCG.productSVG(c.shape, color, 'solid', '#f3f4f6')) + '</div>' +
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
    var d = c ? JSON.parse(JSON.stringify(c)) : { name: '', shape: 'tshirt', icon: '#0b2a6f', tagline: '', image: '' };
    function prev() { return d.image ? '<img src="' + SCG.imgSrc(d.image) + '" alt="">' : SCG.productSVG(d.shape, d.icon || '#0b2a6f', 'solid', '#f3f4f6'); }
    openModal(c ? 'Edit Category' : 'Add Category',
      '<form class="form" id="cform"><label>Name<input name="name" required value="' + esc(d.name) + '"></label>' +
      '<label>Tagline<input name="tagline" value="' + esc(d.tagline || '') + '"></label>' +
      '<label>Icon picture<select name="shape">' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (d.shape === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label>Icon colour<input type="color" name="icon" value="' + esc(d.icon || '#0b2a6f') + '"></label>' +
      '<div class="full uploader" id="cup"><div class="preview" id="cprev">' + prev() + '</div><div class="btns"><input type="file" accept="image/*" aria-label="Upload a picture"><button type="button" class="btn sm danger" data-rm-img>Remove photo</button><span class="hint">Upload a photo, or leave empty to use the picture and colour above. Shown in the menu and the category grid.</span></div></div>' +
      '<div class="form-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>');
    var f = $('#cform'), E = f.elements;
    bindUploader($('#cup'), prev, function (u) { d.image = u; });
    E.shape.onchange = E.icon.oninput = function () { d.shape = E.shape.value; d.icon = E.icon.value; if (!d.image) $('#cprev').innerHTML = prev(); };
    f.onsubmit = function (e) {
      e.preventDefault();
      var vals = { name: E.name.value.trim(), shape: E.shape.value, icon: E.icon.value, tagline: E.tagline.value.trim(), image: d.image || '' };
      if (c) Object.assign(c, vals);
      else { vals.id = SCG.slug(vals.name); if (SCG.categoryById(vals.id)) vals.id = SCG.uid(vals.id); db.categories.push(vals); }
      commit('Category saved'); closeModal(); route();
    };
  }

  /* =========================================================
     COLLECTIONS
     ========================================================= */
  function collections(v, arg) {
    if (arg && SCG.collectionById(arg)) return collectionWorkspace(v, SCG.collectionById(arg));
    setActions('<button class="btn primary" id="addColl">+ New Collection</button>');
    v.innerHTML = '<p class="muted" style="margin-top:0">Click a collection to open it. Inside you can add, create, edit, reorder and discount its products, and choose where it shows on the website.</p><div class="cards">' + db.collections.map(function (c) {
      var list = SCG.collectionProducts(c), inNav = (db.settings.navLinks || []).some(function (l) { return l.link === '#col/' + c.id; });
      return '<a class="item-card coll-open" href="#collections/' + c.id + '"><div class="cover" style="background:linear-gradient(150deg,' + SCG.shade(c.accent, 40) + ',' + SCG.shade(c.accent, -60) + ')">' +
        (c.image ? '<img src="' + SCG.imgSrc(c.image) + '" alt="">' : '<div class="mini-stack">' + list.slice(0, 3).map(function (p) { return '<span>' + SCG.productVisual(p) + '</span>'; }).join('') + '</div>') + '</div>' +
        '<div class="body"><h4>' + esc(c.name) + '</h4><p>' + esc(c.description || '') + '</p><p style="margin-top:8px"><span class="tag">' + list.length + ' products</span>' +
        (inNav ? ' <span class="tag ok">In menu</span>' : '') + (c.homeRow ? ' <span class="tag ok">On homepage</span>' : '') + '</p></div>' +
        '<div class="foot"><span class="btn sm primary">Open →</span></div></a>';
    }).join('') + '</div>';
    $('#addColl').onclick = function () {
      var id = SCG.uid('collection');
      db.collections.push({ id: id, name: 'New collection', description: '', accent: '#0b2a6f', image: '', order: [] });
      commit('Collection created'); location.hash = 'collections/' + id;
    };
  }

  /* One collection: details, where it shows, and the products inside it. */
  function collectionWorkspace(v, c) {
    var sel = {}, q = '';
    var s = db.settings;
    function inNav() { return (s.navLinks || []).some(function (l) { return l.link === '#col/' + c.id; }); }
    function members() { return SCG.collectionProducts(c); }
    function saveOrder(ids) { c.order = ids; commit('Order saved'); }
    $('#viewTitle').textContent = c.name; $('#viewSub').textContent = 'Collection · #col/' + c.id;
    setActions('<a class="btn" href="#collections">← All collections</a>' + preview('#col/' + c.id, 'View on site') + '<button class="btn danger" id="cDel">Delete</button>');
    v.innerHTML =
      '<div class="grid2 ws-top"><form class="panel" id="cInfo"><h3>Details</h3><div class="form">' +
        '<label class="full">Name<input name="name" required value="' + esc(c.name) + '"></label>' +
        '<label class="full">Description<textarea name="description" rows="2">' + esc(c.description || '') + '</textarea></label>' +
        '<label>Colour<input type="color" name="accent" value="' + esc(c.accent || '#0b2a6f') + '"></label>' +
        '<div class="uploader" id="cCover"><div class="preview" style="width:120px;height:80px">' + (c.image ? '<img src="' + SCG.imgSrc(c.image) + '" alt="">' : '<span class="hint">No cover</span>') + '</div><div class="btns"><input type="file" accept="image/*" aria-label="Upload a picture"><button type="button" class="btn sm danger" data-rm-img>Remove cover</button></div></div>' +
        '<div class="full" style="display:flex;gap:18px;flex-wrap:wrap">' + sw('nav', inNav(), 'Show in header menu') + sw('home', !!c.homeRow, 'Show as a row on the homepage') + '</div>' +
        '<div class="form-foot"><button class="btn primary">Save details</button></div></div></form>' +
      '<div class="panel"><h3>Fill quickly <small>add every product that matches</small></h3><div class="form" style="grid-template-columns:1fr">' +
        '<label>Rule<select id="rule"><option value="cat">From a category…</option><option value="from">Ships from a country…</option><option value="under">Priced under…</option><option value="sale">On discount</option><option value="flash">In the flash sale</option><option value="new">Newest 20 products</option></select></label>' +
        '<label id="ruleValWrap">Choose<select id="ruleVal"></select></label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="rulePreview">Preview</button><button type="button" class="btn primary" id="ruleAdd">Add matching products</button></div><p class="muted" id="ruleInfo" style="margin:0"></p></div></div></div>' +
      '<div class="panel"><div class="head"><h3 id="mHead"></h3><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="mq" type="search" aria-label="Search in this collection" placeholder="Search in this collection…" style="width:220px">' +
        '<button class="btn" id="mAdd">+ Add existing products</button><button class="btn primary" id="mNew">+ Create new product here</button></div></div>' +
        '<div class="bulkbar" id="mBulk" hidden><b id="mbn"></b><button class="btn sm" data-b="sel-all">Select all</button>' +
          '<span style="display:inline-flex;gap:4px"><input id="mdisc" type="number" aria-label="Discount percent" min="1" max="90" placeholder="% off" style="width:80px"><button class="btn sm" data-b="disc">Apply discount</button></span>' +
          '<button class="btn sm" data-b="flash-on">⚡ Flash on</button><button class="btn sm" data-b="flash-off">Flash off</button>' +
          '<span style="display:inline-flex;gap:4px"><select id="morig" aria-label="Ships from">' + originOptions('china') + '</select><button class="btn sm" data-b="origin">Set ships from</button></span>' +
          '<button class="btn sm" data-b="remove" style="border-color:#f87171">Remove from collection</button><button class="btn sm" data-b="clear">Clear</button></div>' +
        '<p class="muted" style="margin:0 0 10px;font-size:12.5px">Drag tiles (or use ← →) to set the order customers see. Prices and stock save as you type.</p>' +
        '<div class="tiles" id="tiles"></div></div>';

    // ---- details form
    var cover = c.image || '';
    bindUploader($('#cCover'), function () { return '<span class="hint">No cover</span>'; }, function (u) { cover = u; });
    $('#cInfo').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      c.name = E.name.value.trim() || c.name; c.description = E.description.value.trim(); c.accent = E.accent.value; c.image = cover; c.homeRow = E.home.checked;
      var link = '#col/' + c.id;
      s.navLinks = s.navLinks || [];
      var existing = s.navLinks.filter(function (l) { return l.link === link; })[0];
      if (!E.nav.checked) s.navLinks = s.navLinks.filter(function (l) { return l.link !== link; });
      else if (existing) existing.label = c.name;      // keep its place in the menu
      else s.navLinks.push({ label: c.name, link: link });
      $('#viewTitle').textContent = c.name;
      commit('Collection saved');
    };
    $('#cDel').onclick = function () {
      if (!confirm('Delete the collection "' + c.name + '"? Its products stay in the shop.')) return;
      db.collections = db.collections.filter(function (x) { return x.id !== c.id; });
      db.products.forEach(function (p) { p.collections = (p.collections || []).filter(function (x) { return x !== c.id; }); });
      s.navLinks = (s.navLinks || []).filter(function (l) { return l.link !== '#col/' + c.id; });
      commit('Collection deleted'); location.hash = 'collections';
    };

    // ---- quick fill rules
    function ruleOptions() {
      var r = $('#rule').value, wrap = $('#ruleValWrap'), sv = $('#ruleVal');
      wrap.hidden = r === 'sale' || r === 'flash' || r === 'new';
      if (r === 'cat') sv.innerHTML = db.categories.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
      if (r === 'from') sv.innerHTML = originOptions('china');
      if (r === 'under') sv.innerHTML = [1000, 2000, 3000, 5000, 10000].map(function (x) { return '<option value="' + x + '">' + money(x) + '</option>'; }).join('');
      $('#ruleInfo').textContent = '';
    }
    function matches() {
      var r = $('#rule').value, val = $('#ruleVal').value, list = db.products.slice();
      if (r === 'cat') list = list.filter(function (p) { return p.category === val; });
      if (r === 'from') list = list.filter(function (p) { return (p.origin || 'local') === val; });
      if (r === 'under') list = list.filter(function (p) { return p.price < +val; });
      if (r === 'sale') list = list.filter(function (p) { return p.comparePrice > p.price; });
      if (r === 'flash') list = list.filter(function (p) { return p.flash; });
      if (r === 'new') list = list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 20);
      return list.filter(function (p) { return (p.collections || []).indexOf(c.id) < 0; });
    }
    $('#rule').onchange = ruleOptions; $('#ruleVal').onchange = function () { $('#ruleInfo').textContent = ''; };
    $('#rulePreview').onclick = function () { var m = matches(); $('#ruleInfo').textContent = m.length ? m.length + ' new products would be added: ' + m.slice(0, 5).map(function (p) { return p.name; }).join(', ') + (m.length > 5 ? '…' : '') : 'No new products match (they may already be in this collection).'; };
    $('#ruleAdd').onclick = function () { var m = matches(); if (!m.length) { toast('No new products match'); return; } addProducts(m.map(function (p) { return p.id; })); };
    ruleOptions();

    function addProducts(ids) {
      ids.forEach(function (id) { var p = SCG.productById(id); if (p && (p.collections || []).indexOf(c.id) < 0) p.collections = (p.collections || []).concat([c.id]); });
      c.order = members().map(function (p) { return p.id; });
      commit(ids.length + ' product(s) added'); draw();
    }

    // ---- product tiles
    function draw() {
      var all = members(), ql = q.toLowerCase();
      var list = ql ? all.filter(function (p) { return (p.name + ' ' + (p.brand || '')).toLowerCase().indexOf(ql) > -1; }) : all;
      $('#mHead').innerHTML = 'Products in this collection <small>' + all.length + '</small>';
      $('#tiles').innerHTML = list.length ? list.map(function (p) {
        var o = SCG.originInfo(p), off = SCG.discount(p);
        return '<div class="tile' + (sel[p.id] ? ' sel' : '') + '" draggable="' + (!ql) + '" data-id="' + p.id + '">' +
          '<label class="tchk"><input type="checkbox" data-sel' + (sel[p.id] ? ' checked' : '') + ' aria-label="Select ' + esc(p.name) + '"></label>' +
          '<div class="tthumb" style="background:' + SCG.shade(p.color || '#0b2a6f', 170) + '">' + SCG.productVisual(p) + (off ? '<span class="toff">-' + off + '%</span>' : '') + (p.flash ? '<span class="tflash">⚡</span>' : '') + '</div>' +
          '<b class="tname">' + esc(p.name) + '</b><small class="muted">' + esc(o.local ? 'Colombo stock' : 'From ' + o.name) + '</small>' +
          '<div class="tfields"><label>Price<input type="number" min="0" data-f="price" aria-label="Flash price" value="' + p.price + '"></label><label>Stock<input type="number" min="0" data-f="stock" value="' + p.stock + '"></label></div>' +
          '<div class="ttools"><button type="button" data-l title="Move earlier">←</button><button type="button" data-r title="Move later">→</button><button type="button" data-e title="Edit everything">✎ Edit</button><button type="button" data-x title="Remove from collection">✕</button></div></div>';
      }).join('') : '<div class="empty-ws"><h3>' + (ql ? 'No products match your search' : 'This collection is empty') + '</h3><p class="muted">Use “Add existing products”, “Create new product here” or a quick-fill rule.</p></div>';
      bulkUI();
    }
    function ids() { return Object.keys(sel).filter(function (k) { return sel[k]; }); }
    function bulkUI() { var n = ids().length; $('#mBulk').hidden = !n; $('#mbn').textContent = n + ' selected'; }
    function move(id, dir) {
      var order = members().map(function (p) { return p.id; }), i = order.indexOf(id), j = i + dir;
      if (j < 0 || j >= order.length) return;
      order.splice(j, 0, order.splice(i, 1)[0]); saveOrder(order); draw();
    }
    $('#mq').oninput = function (e) { q = e.target.value; draw(); };
    var tiles = $('#tiles');
    tiles.addEventListener('change', function (e) {
      var t = e.target.closest('.tile'); if (!t) return; var p = SCG.productById(t.dataset.id);
      if (e.target.hasAttribute('data-sel')) { sel[p.id] = e.target.checked; t.classList.toggle('sel', e.target.checked); bulkUI(); return; }
      var f = e.target.dataset.f; if (f) { if (!okNum(e.target, p, f)) return; p[f] = Math.max(0, Math.round(+e.target.value || 0)); commit('Updated ' + p.name); }
    });
    tiles.addEventListener('click', function (e) {
      var t = e.target.closest('.tile'), b = e.target.closest('button'); if (!t || !b) return;
      var id = t.dataset.id;
      if (b.hasAttribute('data-l')) move(id, -1);
      if (b.hasAttribute('data-r')) move(id, 1);
      if (b.hasAttribute('data-e')) productForm(id, { back: 'collections/' + c.id });
      if (b.hasAttribute('data-x')) { var p = SCG.productById(id); p.collections = (p.collections || []).filter(function (x) { return x !== c.id; }); delete sel[id]; commit('Removed from ' + c.name); draw(); }
    });
    // drag & drop ordering
    var dragId = null;
    tiles.addEventListener('dragstart', function (e) { var t = e.target.closest('.tile'); if (!t) return; dragId = t.dataset.id; t.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {} });
    tiles.addEventListener('dragend', function () { dragId = null; $$('.tile', tiles).forEach(function (x) { x.classList.remove('dragging', 'over'); }); });
    tiles.addEventListener('dragover', function (e) { if (!dragId) return; e.preventDefault(); var t = e.target.closest('.tile'); $$('.tile.over', tiles).forEach(function (x) { if (x !== t) x.classList.remove('over'); }); if (t && t.dataset.id !== dragId) t.classList.add('over'); });
    tiles.addEventListener('drop', function (e) {
      e.preventDefault(); var t = e.target.closest('.tile'); if (!dragId || !t || t.dataset.id === dragId) return;
      var order = members().map(function (p) { return p.id; });
      order.splice(order.indexOf(dragId), 1); order.splice(order.indexOf(t.dataset.id), 0, dragId);
      saveOrder(order); draw();
    });
    // bulk actions
    $('#mBulk').onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return;
      var act = b.dataset.b, list = ids().map(SCG.productById).filter(Boolean);
      if (act === 'clear') { sel = {}; draw(); return; }
      if (act === 'sel-all') { members().forEach(function (p) { sel[p.id] = true; }); draw(); return; }
      if (act === 'disc' && !(+$('#mdisc').value)) { toast('Enter a discount % first'); return; }
      list.forEach(function (p) {
        if (act === 'remove') { p.collections = (p.collections || []).filter(function (x) { return x !== c.id; }); delete sel[p.id]; }
        if (act === 'flash-on') { p.flash = true; if (!p.comparePrice) p.comparePrice = Math.round(p.price * 1.3 / 10) * 10; }
        if (act === 'flash-off') p.flash = false;
        if (act === 'origin') p.origin = $('#morig').value;
        if (act === 'disc') { var pct = Math.min(90, Math.max(1, +$('#mdisc').value)), base = p.comparePrice > p.price ? p.comparePrice : p.price; p.comparePrice = base; p.price = Math.round(base * (1 - pct / 100) / 10) * 10; }
      });
      commit(list.length + ' product(s) updated'); draw();
    };
    // add existing / create new
    $('#mNew').onclick = function () { productForm(null, { collection: c.id, back: 'collections/' + c.id }); };
    $('#mAdd').onclick = function () {
      openModal('Add products to ' + c.name,
        '<div class="filters"><input id="pk-q" type="search" aria-label="Search products" placeholder="Search products…"><select id="pk-c" aria-label="Filter by category"><option value="">All categories</option>' + db.categories.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select>' +
        '<select id="pk-o" aria-label="Filter by country"><option value="">Any country</option>' + originOptions('').replace(' selected', '') + '</select></div>' +
        '<div class="picker" id="pk"></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px;flex-wrap:wrap"><span class="muted" id="pk-n">0 selected</span><button class="btn primary" id="pk-ok">Add selected</button></div>');
      var picked = {};
      function drawPick() {
        var qq = $('#pk-q').value.toLowerCase(), cc = $('#pk-c').value, oo = $('#pk-o').value;
        var list = db.products.filter(function (p) {
          return (p.collections || []).indexOf(c.id) < 0 && (!cc || p.category === cc) && (!oo || (p.origin || 'local') === oo) && (!qq || p.name.toLowerCase().indexOf(qq) > -1);
        });
        $('#pk').innerHTML = list.length ? list.map(function (p) {
          return '<label class="pk-item' + (picked[p.id] ? ' on' : '') + '"><input type="checkbox" value="' + p.id + '"' + (picked[p.id] ? ' checked' : '') + '>' + thumb(p) + '<span><b>' + esc(p.name) + '</b><small class="muted">' + money(p.price) + '</small></span></label>';
        }).join('') : '<p class="muted">Every matching product is already in this collection.</p>';
      }
      ['#pk-q', '#pk-c', '#pk-o'].forEach(function (id) { $(id).oninput = $(id).onchange = drawPick; });
      $('#pk').onchange = function (e) { picked[e.target.value] = e.target.checked; e.target.closest('.pk-item').classList.toggle('on', e.target.checked); $('#pk-n').textContent = Object.keys(picked).filter(function (k) { return picked[k]; }).length + ' selected'; };
      $('#pk-ok').onclick = function () { var chosen = Object.keys(picked).filter(function (k) { return picked[k]; }); if (!chosen.length) { toast('Tick at least one product'); return; } closeModal(); addProducts(chosen); };
      drawPick();
    };
    draw();
  }

  /* =========================================================
     HOMEPAGE & GLOBE
     ========================================================= */
  function homepage(v) {
    var s = db.settings;
    setActions(preview('', 'Preview homepage'));
    v.innerHTML =
      '<div class="grid2"><div class="panel"><h3>Globe hero</h3><div class="form" style="grid-template-columns:1fr">' +
        '<label>Headline (new line = second, gold line)<textarea id="hTitle" rows="2">' + esc(s.heroTitle) + '</textarea></label>' +
        '<label>Text under the headline<textarea id="hSub" rows="3">' + esc(s.heroSubtitle) + '</textarea></label>' +
        '<p class="muted" style="margin:0">Which countries and cities appear on the globe is set in <a href="#origins" style="color:var(--red)">Import Countries</a>.</p>' +
      '</div></div>' +
      '<div class="panel gp-panel"><div class="head"><h3>Globe preview</h3><button class="btn sm" id="hPrev">Replay</button></div><div class="globe-prev"><span class="cap">China → Sri Lanka</span><canvas></canvas></div></div></div>' +
      '<div class="grid2"><div class="panel"><h3>Numbers under the headline <small>tick “Live” to count up as parcels arrive</small></h3><div id="hStats"></div></div>' +
      '<div class="panel"><h3>Shipping timeline <small>5 steps along the bottom of the globe</small></h3><div id="hSteps"></div></div></div>' +
      '<div class="panel"><div class="head"><h3>Welcome intro <small>the cinematic screen when the site opens, with an Enter button</small></h3><a class="btn sm" target="_blank" rel="noopener" href="../?intro=1">▶ Preview intro</a></div><div class="form">' +
        '<div class="full" style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">' + sw('wOn', (s.welcome || {}).on !== false, 'Show the welcome intro') +
        '<label style="flex-direction:row;display:flex;align-items:center;gap:8px">Show it<select id="wMode" style="width:auto">' +
        [['session', 'once per visit (recommended)'], ['first', 'only on a customer’s first visit'], ['visit', 'every time a page loads']].map(function (o) { return '<option value="' + o[0] + '"' + (((s.welcome || {}).mode || 'session') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>' +
        '<label>Small text above the logo<input id="wEyebrow" value="' + esc((s.welcome || {}).eyebrow || 'Welcome to') + '"></label>' +
        '<label>Button text<input id="wButton" value="' + esc((s.welcome || {}).button || 'Enter the Store') + '"></label>' +
        '<label class="full">Line under the logo<textarea id="wSub" rows="2">' + esc((s.welcome || {}).subtitle || '') + '</textarea></label>' +
        '<p class="full muted" style="margin:0;font-size:12px">Uses your logo (emblem + “Global Source Connect” wordmark), the globe and the import countries switched on in Import Countries. Visitors can always skip it.</p></div></div>' +
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

    function mountPrev() {
      if (previewGlobe) previewGlobe.destroy();
      if (window.SCGGlobe) previewGlobe = SCGGlobe.mount($('.globe-prev canvas'), { cities: s.globeCities, fit: true });
    }
    mountPrev();
    $('#hPrev').onclick = mountPrev;
    $('#hSave').onclick = function () {
      s.heroTitle = $('#hTitle').value.trim(); s.heroSubtitle = $('#hSub').value.trim();
      s.globeStats = getStats(); s.globeSteps = getSteps().slice(0, 5);
      s.services = getSvc(); s.sections = secs;
      s.welcome = { on: $('input[name=wOn]').checked, mode: $('#wMode').value, eyebrow: $('#wEyebrow').value.trim(), subtitle: $('#wSub').value.trim(), button: $('#wButton').value.trim() || 'Enter the Store' };
      commit('Homepage saved');
    };
  }

  /* =========================================================
     IMPORT COUNTRIES
     ========================================================= */
  function originsView(v) {
    var s = db.settings, list = SCG.origins().map(function (o) { return JSON.parse(JSON.stringify(o)); });
    var cities = (window.SCGGlobe && SCGGlobe.CITIES_FULL) || [];
    setActions(preview('#china-direct', 'View importing page'));
    function count(id) { return db.products.filter(function (p) { return (p.origin || 'local') === id; }).length; }
    v.innerHTML =
      '<div class="panel"><h3>Countries you import from <small>switch a country off to hide it on the site and the globe</small></h3>' +
      '<div class="table-wrap" style="border:0"><table><thead><tr><th>Show</th><th>Code</th><th>Country</th><th>Label on products</th><th>Delivery (days)</th><th>Products</th><th>Globe cities</th></tr></thead><tbody id="otb">' +
      list.map(function (o, i) {
        return '<tr data-i="' + i + '"><td>' + sw('on', o.on) + '</td><td><input data-k="code" aria-label="Country code" value="' + esc(o.code) + '" style="width:60px" maxlength="3"></td>' +
          '<td><input data-k="name" aria-label="Country name" value="' + esc(o.name) + '" style="min-width:130px"></td><td><input data-k="label" aria-label="Label on products" value="' + esc(o.label) + '" style="min-width:140px"></td>' +
          '<td><input data-k="days" aria-label="Delivery days" value="' + esc(o.days) + '" style="width:90px"></td><td><a class="tag" href="#products" data-filter="' + o.id + '">' + count(o.id) + '</a></td>' +
          '<td><div class="checks">' + cities.filter(function (c) { return c.country === o.id; }).map(function (c) {
            return '<label><input type="checkbox" data-city value="' + esc(c.name) + '"' + ((s.globeCities || []).indexOf(c.name) > -1 ? ' checked' : '') + '> ' + esc(c.name) + ' <small class="muted">' + (c.mode === 'air' ? 'air' : 'sea') + '</small></label>';
          }).join('') + '</div></td></tr>';
      }).join('') +
      '<tr><td></td><td><span class="tag ok">LK</span></td><td><b>Colombo stock</b></td><td class="muted">Ships from Colombo</td><td><input id="localDays" aria-label="Colombo stock delivery days" value="' + esc(s.localDays) + '" style="width:90px"></td><td><a class="tag" href="#products" data-filter="local">' + count('local') + '</a></td><td class="muted">Destination on the globe</td></tr>' +
      '</tbody></table></div></div>' +
      '<div class="panel"><div class="head"><h3>Globe preview <small>tick cities above, then Replay</small></h3><button class="btn sm" id="oPrev">Replay</button></div><div class="globe-prev" style="height:380px"><span class="cap">World → Sri Lanka</span><canvas></canvas></div></div>' +
      '<div class="save-bar"><button class="btn primary" id="oSave">Save import countries</button></div>';
    function chosen() {
      var on = {}; $$('#otb tr[data-i]').forEach(function (tr) { on[list[+tr.dataset.i].id] = $('input[name=on]', tr).checked; });
      return $$('#otb [data-city]:checked').filter(function (x) { var c = cities.filter(function (k) { return k.name === x.value; })[0]; return c && on[c.country]; }).map(function (x) { return x.value; });
    }
    function mountPrev() { if (previewGlobe) previewGlobe.destroy(); if (window.SCGGlobe) previewGlobe = SCGGlobe.mount($('.globe-prev canvas'), { cities: chosen(), fit: true }); }
    mountPrev();
    $('#oPrev').onclick = mountPrev;
    $('#otb').addEventListener('click', function (e) { var a = e.target.closest('[data-filter]'); if (a) pf.extra = 'o:' + a.dataset.filter; });
    $('#oSave').onclick = function () {
      $$('#otb tr[data-i]').forEach(function (tr) {
        var o = list[+tr.dataset.i];
        o.on = $('input[name=on]', tr).checked;
        ['code', 'name', 'label', 'days'].forEach(function (k) { var val = $('[data-k="' + k + '"]', tr).value.trim(); if (val) o[k] = k === 'code' ? val.toUpperCase() : val; });
      });
      s.origins = list; s.globeCities = chosen(); s.localDays = $('#localDays').value.trim() || s.localDays;
      commit(s.globeCities.length ? 'Import countries saved' : 'Saved. No cities ticked, so the globe shows no routes.');
      mountPrev();
    };
  }

  /* =========================================================
     PROMO BANNERS
     ========================================================= */
  function banners(v) {
    setActions('<button class="btn primary" id="addHero">+ Add Banner</button>' + preview('', 'Preview homepage'));
    v.innerHTML = '<p class="muted" style="margin-top:0">Banners 1–2 sit beside the globe. Banners 3 and up show as wide banners below the categories (that section can be switched on or off in Homepage &amp; Globe). Use ↑ to reorder.</p><div class="cards">' + db.hero.map(function (h, i) {
      return '<div class="item-card"><div class="cover" style="background:linear-gradient(120deg,' + h.color + ',' + SCG.shade(h.color, -70) + ')">' + (h.image ? '<img src="' + SCG.imgSrc(h.image) + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color)) + '</div>' +
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
    return ['#shop', '#flash', '#china-direct', '#track', '#help', '#categories'].concat(db.categories.map(function (c) { return '#c/' + c.id; }), db.collections.map(function (c) { return '#col/' + c.id; }), SCG.origins().map(function (o) { return '#from/' + o.id; }));
  }
  function bannerForm(i) {
    var h = i > -1 ? JSON.parse(JSON.stringify(db.hero[i])) : { id: SCG.uid('h'), eyebrow: 'New Season', title: 'Your headline', subtitle: '', cta: 'Shop Now', link: '#shop', color: '#0b2a6f', shape: 'tshirt', image: '' };
    function prev() { return h.image ? '<img src="' + SCG.imgSrc(h.image) + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color); }
    openModal(i > -1 ? 'Edit Banner' : 'Add Banner',
      '<form class="form" id="hform"><label>Small label<input name="eyebrow" value="' + esc(h.eyebrow) + '"></label>' +
      '<label>Button text<input name="cta" value="' + esc(h.cta) + '"></label>' +
      '<label class="full">Title<input name="title" required value="' + esc(h.title) + '"></label>' +
      '<label class="full">Subtitle<input name="subtitle" value="' + esc(h.subtitle) + '"></label>' +
      '<label>Opens<input name="link" list="hlinks" value="' + esc(h.link) + '"><datalist id="hlinks">' + linkOptions().map(function (l) { return '<option value="' + l + '">'; }).join('') + '</datalist></label>' +
      '<label>Background colour<input type="color" name="color" value="' + esc(h.color) + '"></label>' +
      '<label>Picture (if no image)<select name="shape">' + Object.keys(SCG.SHAPES).map(function (s) { return '<option' + (s === h.shape ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<div class="full"><label style="margin-bottom:8px">Image (optional; a product photo on a plain background works best)</label><div class="uploader" id="hup"><div class="preview" style="background:' + esc(h.color) + '">' + prev() + '</div><div class="btns"><input type="file" accept="image/*" aria-label="Upload a picture"><button type="button" class="btn sm danger" data-rm-img>Remove</button></div></div></div>' +
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
      '<div class="panel"><h3>Announcement bar <small>the scrolling line at the very top; separate messages with ✦</small></h3><textarea id="ann" aria-label="Announcement text" rows="2">' + esc(s.announcement) + '</textarea></div>' +
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
      '<div class="panel"><h3>“How importing works” steps</h3><div id="steps"></div></div>' +
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
    v.innerHTML = '<div class="chip-tabs" id="otabs"></div><div class="filters"><input id="oq" type="search" aria-label="Search orders" placeholder="Search order no, name or phone…" value="' + esc(q) + '"></div><div id="olist"></div>';
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
        return '<div class="od-item">' + thumb(p, it.color) + '<div><b>' + esc(it.name) + '</b><br><small class="muted">' + (it.size ? 'Size ' + esc(it.size) + ' · ' : '') + 'Qty ' + it.qty + (it.origin && it.origin !== 'local' ? ' · from ' + esc(originName(it.origin)) : '') + '</small></div><b>' + money(it.price * it.qty) + '</b></div>';
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
      var c = map[key] = map[key] || { name: o.customer.name, phone: o.customer.phone, email: '', address: o.customer.address, n: 0, spent: 0, last: o.date, first: o.date, account: false };
      if (o.customer.profileId) c.account = true;
      if (o.customer.email) c.email = o.customer.email;
      if (o.date < c.first) c.first = o.date;
      c.n++; if (o.status !== 'Cancelled') c.spent += o.total;
      if (o.date > c.last) { c.last = o.date; c.address = o.customer.address; c.name = o.customer.name; }
    });
    var list = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.spent - a.spent; });
    var focus = arg ? String(arg).replace(/\D/g, '').slice(-9) : '';
    v.innerHTML = list.length ? '<div class="filters"><input id="cq" type="search" aria-label="Search customers" placeholder="Search name or phone…"><span class="muted" style="align-self:center">' + list.length + ' customers</span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone / email</th><th>Address</th><th>Orders</th><th>Total spent</th><th>Last order</th><th></th></tr></thead><tbody id="ctb">' +
      list.map(function (c) {
        var key = String(c.phone).replace(/\D/g, '').slice(-9);
        return '<tr data-n="' + esc((c.name + c.phone).toLowerCase()) + '"' + (focus === key ? ' class="sel"' : '') + '><td><b>' + esc(c.name) + '</b><br>' + (c.account ? '<span class="tag ok">Account since ' + new Date(c.first).toLocaleDateString() + '</span>' : '<span class="tag">Guest</span>') + '</td><td>' + esc(c.phone) + (c.email ? '<br><small class="muted">' + esc(c.email) + '</small>' : '') + '</td><td><small>' + esc(c.address) + '</small></td><td>' + c.n + '</td><td><b>' + money(c.spent) + '</b></td><td><small>' + new Date(c.last).toLocaleDateString() + '</small></td>' +
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
      '<label class="full">Colombo stock delivery (days)<input name="localDays" value="' + esc(s.localDays) + '"></label>' +
      '<p class="full muted" style="margin:0;font-size:12px">Delivery times for imported products are set per country in <a href="#origins" style="color:var(--red)">Import Countries</a>.</p>' +
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

      '<div class="panel"><h3>Backup &amp; data</h3><p class="muted" style="margin-top:0">Everything is stored in this browser. Export a backup regularly, or import it on another computer.</p>' + storageMeter() +
      '<div class="filters"><button class="btn" id="exp">⬇ Export backup</button><label class="btn" style="display:inline-flex;color:var(--text);font-size:13px">⬆ Import backup<input type="file" accept="application/json" id="imp" hidden></label>' +
      '<button class="btn danger" id="rmDemo">Remove all demo products</button><button class="btn danger" id="rst">Reset to demo data</button><button class="btn danger" id="rstOrders">Delete all orders</button></div></div>';

    $('#sform').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements; ['brand', 'currency', 'phone', 'email', 'whatsapp', 'address'].forEach(function (k) { s[k] = E[k].value.trim(); }); commit('Store details saved'); };
    $('#dform').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      if (!E.payCOD.checked && !E.payBank.checked) { toast('Turn on at least one payment method'); return; }
      s.localDays = E.localDays.value.trim();
      s.shippingFee = +E.shippingFee.value || 0; s.freeShipping = +E.freeShipping.value || 0; s.returnDays = +E.returnDays.value || 0;
      s.payCOD = E.payCOD.checked; s.payBank = E.payBank.checked; s.bankDetails = E.bankDetails.value.trim();
      commit('Delivery & payment saved');
    };
    var getSS = repeater($('#sstats'), s.sellerStats || [], [{ k: 'value', label: 'Value', w: '.7fr' }, { k: 'label', label: 'Label' }], { value: '', label: '' });
    $('#ssave').onclick = function () { s.sellerStats = getSS().slice(0, 3); commit('Seller rating saved'); };
    $('#aform').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      s.adminUser = E.adminUser.value.trim();
      var pw = E.adminPass.value; E.adminPass.value = '';
      if (!pw) { commit('Login updated'); return; }
      if (pw === 'admin123') { toast('Choose a password other than the default'); return; }
      var salt = SCG.uid('s');
      SCG.hashPassword(pw, salt).then(function (h) { s.adminPassHash = h; s.adminSalt = salt; s.adminDefault = false; delete s.adminPass; commit('Password changed. Use it next time you sign in.'); });
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
    $('#rmDemo').onclick = function () {
      var n = db.products.filter(SCG.isDemoProduct).length;
      if (!n) { toast('No demo products left'); return; }
      if (!confirm('Remove the ' + n + ' demo products? Products you added yourself stay. Export a backup first if unsure.')) return;
      db.products = db.products.filter(function (p) { return !SCG.isDemoProduct(p); });
      commit(n + ' demo products removed'); route();
    };
    $('#rst').onclick = function () { if (confirm('Reset ALL products, categories, collections, banners and site texts to the demo data? Orders are kept.')) { db = SCG.reset(); toast('Demo data restored'); route(); } };
    $('#rstOrders').onclick = function () { if (confirm('Delete ALL orders? This cannot be undone.')) { SCG.saveOrders([]); toast('All orders deleted'); route(); } };
  }

  /* =========================================================
     SERVER (API) MODE — real staff login, permissions and database
     Everything above keeps working unchanged; this block swaps the
     browser-only parts (login, orders, customers, backups) for server ones.
     ========================================================= */
  if (SCG.API) (function () {
    var me = null, saveMsg = '';
    var can = function (p) { return !!(me && me.permissions && me.permissions.indexOf(p) > -1); };
    var rs = function (n) { return money(n); };
    var ST = { pending_payment: 'Waiting for card payment', awaiting_bank_transfer: 'Waiting for bank transfer', confirmed: 'Confirmed', processing: 'Packing', shipped: 'Shipped', arrived_lk: 'Arrived in Sri Lanka', delivered: 'Delivered', cancelled: 'Cancelled', expired: 'Expired (not paid)', refunded: 'Refunded' };
    var PAY = { pending: 'Payment pending', paid: 'Paid', cod_pending: 'COD – not collected', cod_collected: 'COD – cash collected', failed: 'Failed', cancelled: 'Cancelled', chargeback: 'CHARGEBACK', refunded: 'Refunded', partially_refunded: 'Partly refunded', unpaid: 'Unpaid' };
    var METHOD = { payhere: 'Card (PayHere)', cod: 'Cash on Delivery', bank_transfer: 'Bank transfer' };
    var FLOW = ['confirmed', 'processing', 'shipped', 'arrived_lk', 'delivered'];
    var when = function (t) { return t ? new Date(t).toLocaleString() : ''; };
    var fail = function (err) { toast(err && err.message || 'Something went wrong'); };
    function refreshPreview() { var f = $('#pvIf'); if (f && f.contentWindow) try { f.contentWindow.postMessage({ type: 'scg-refresh' }, location.origin); } catch (e) {} }

    // ---------- login ----------
    var hint = $('#defHint'); if (hint) hint.hidden = true;
    loggedIn = function () { return !!me; };
    showApp = function () {
      $('#login').hidden = true; $('#shell').hidden = false;
      db = SCG.load();
      applyPermissions(); route();
    };
    function afterAuth(staff) {
      if (!staff) return false;
      me = staff; me.permissions = (SCG.load().me && SCG.load().me.permissions) || staff.permissions || [];
      if (staff.mustChangePassword) { forcePasswordChange(); return true; }
      if (staff.needsMfa) { showMfa(); return true; }
      try { localStorage.setItem('scg_admin_on', String(Date.now())); } catch (e) {}   // only shows the ADMIN bar on the website; not a login
      showApp(); return true;
    }
    $('#loginForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button:not(.pw-eye)'); btn.disabled = true; $('#loginErr').textContent = '';
      SCG.adminLogin(f.elements.user.value.trim(), f.elements.pass.value).then(function (staff) { btn.disabled = false; f.elements.pass.value = ''; afterAuth(staff); },
        function (err) { btn.disabled = false; $('#loginErr').textContent = err.message; });
    };
    $('#logout').onclick = function () {
      SCG.adminLogout().then(function () { try { localStorage.removeItem('scg_admin_on'); localStorage.removeItem('scg_edit_mode'); } catch (e) {} location.hash = ''; location.reload(); });
    };
    function forcePasswordChange() {
      $('#login').hidden = false;
      $('#loginForm').innerHTML = '<h1>Set your own password</h1><p>Your account was created with a temporary password. Choose a new one (12+ characters).</p>' +
        '<label>Temporary password<input name="cur" type="password" required autocomplete="current-password"></label><label>New password<input name="pw" type="password" required minlength="12" autocomplete="new-password"></label>' +
        '<div class="login-err" id="loginErr"></div><button class="btn primary full">Save and continue</button>';
      $('#loginForm').onsubmit = function (e) {
        e.preventDefault(); var E = e.target.elements;
        SCG.api('POST', '/admin/auth/password', { currentPassword: E.cur.value, newPassword: E.pw.value })
          .then(function () { return SCG.adminLogout(); })           // sign in again so the new password takes effect everywhere
          .then(function () { location.reload(); }, function (err) { $('#loginErr').textContent = err.message; });
      };
    }
    // Two-step sign-in (Supabase MFA, TOTP authenticator app). Required for staff; checked again by the database on every action.
    function showMfa() {
      var M = window.SCGSupabase && window.SCGSupabase.mfa;
      if (!M) { $('#loginErr').textContent = 'Two-step sign-in is required but not available.'; return; }
      $('#login').hidden = false;
      var form = $('#loginForm');
      form.innerHTML = '<h1>Two-step sign-in</h1><p class="muted" id="mfaHelp">Checking…</p><div id="mfaQr" style="text-align:center"></div>' +
        '<label>6-digit code from your authenticator app<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required></label>' +
        '<div class="login-err" id="loginErr"></div><button class="btn primary full">Continue</button><button type="button" class="btn link full" id="mfaOut">Use another account</button>';
      $('#mfaOut').onclick = function () { SCG.adminLogout().then(function () { location.reload(); }); };
      var factorId = null;
      M.status().then(function (s) {
        if (s.factors.length) { factorId = s.factors[0].id; $('#mfaHelp').textContent = 'Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) and type the code for Source Connect.'; return; }
        return M.enroll().then(function (f) {
          factorId = f.id;
          $('#mfaHelp').textContent = 'First time: scan this QR code with an authenticator app on your phone, then type the 6-digit code it shows.';
          var qr = f.totp && f.totp.qr_code ? '<img alt="QR code for your authenticator app" style="width:180px;height:180px;background:#fff;padding:8px;border-radius:8px" src="' +
            (f.totp.qr_code.indexOf('data:') === 0 ? f.totp.qr_code : 'data:image/svg+xml;utf8,' + encodeURIComponent(f.totp.qr_code)) + '">' : '';
          $('#mfaQr').innerHTML = qr + '<p class="muted" style="font-size:12px;word-break:break-all">Or type this key: <b>' + esc(f.totp && f.totp.secret || '') + '</b></p>';
        });
      }).catch(function (e) { $('#loginErr').textContent = e.message; });
      form.onsubmit = function (e) {
        e.preventDefault();
        if (!factorId) return;
        M.verify(factorId, e.target.elements.code.value).then(function () { location.reload(); }, function () { $('#loginErr').textContent = 'That code did not work. Check the time on your phone and try again.'; });
      };
    }
    // hide menu items this person cannot use
    var NEED = { dashboard: 'dashboard.view', orders: 'orders.read', customers: 'customers.read', products: 'catalog.read', flash: 'content.write', categories: 'catalog.write', origins: 'settings.write',
      collections: 'catalog.read', homepage: 'content.write', banners: 'content.write', header: 'content.write', pages: 'content.write', settings: 'content.write', editor: 'catalog.read',
      staff: 'staff.manage', audit: 'audit.read', backups: 'backups.read', coupons: 'settings.write', reports: 'reports.view', renewals: 'renewals.manage' };
    function applyPermissions() {
      var nav = $('#sideNav');
      if (!$('#sideNav [data-v=reports]')) {
        var dash = $('#sideNav a[data-v=dashboard]');
        if (dash) dash.insertAdjacentHTML('afterend', '<a href="#reports" data-v="reports"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Sales &amp; Profit</a>');
      }
      if (!$('#sideNav [data-v=staff]')) {
        nav.insertAdjacentHTML('beforeend', '<small class="side-label">Security &amp; data</small>' +
          '<a href="#coupons" data-v="coupons"><svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>Promo Codes</a>' +
          '<a href="#staff" data-v="staff"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c1-4 4-6 7-6s6 2 7 6M17 11l2 2 4-4"/></svg>Staff &amp; Roles</a>' +
          '<a href="#audit" data-v="audit"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3"/></svg>Audit Log</a>' +
          '<a href="#backups" data-v="backups"><svg viewBox="0 0 24 24"><path d="M4 7c0-2 16-2 16 0v10c0 2-16 2-16 0zM4 7c0 2 16 2 16 0M4 12c0 2 16 2 16 0"/></svg>Backups <span class="pill" id="bkPill"></span></a>' +
          '<a href="#renewals" data-v="renewals"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 14v3l2 1"/></svg>Renewals <span class="pill" id="rnPill"></span></a>');
      }
      $$('#sideNav a[data-v]').forEach(function (a) { var p = NEED[a.dataset.v]; a.hidden = !!(p && !can(p)); });
      var who = $('.side-brand small'); if (who && me) who.textContent = (me.displayName || me.username).toUpperCase();
      checkRenewals();
    }

    // ---------- service renewals (owner): warning banner on every page from N days before the date ----------
    var rnTimer = null;
    function rnWhen(n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? 'in ' + n + ' days' : (-n) + ' day' + (n === -1 ? '' : 's') + ' ago'; }
    function rnDate(ymd) { return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
    function checkRenewals() {
      if (!me || !can('renewals.manage')) return;
      clearTimeout(rnTimer); rnTimer = setTimeout(checkRenewals, 30 * 60 * 1000);   // check again every 30 minutes while the admin is open
      SCG.api('GET', '/admin/renewals').then(function (d) {
        var due = d.items.filter(function (r) { return r.status === 'due_soon' || r.status === 'overdue'; });
        var pill = $('#rnPill'); if (pill) { pill.textContent = due.length ? String(due.length) : ''; }
        var b = $('#rnBanner');
        if (!b) { var view = $('#view'); if (!view) return; view.insertAdjacentHTML('beforebegin', '<div id="rnBanner" class="rn-banner" role="alert" hidden></div>'); b = $('#rnBanner'); }
        b.hidden = !due.length;
        b.innerHTML = due.map(function (r) {
          var what = r.cycle === 'once' ? (r.status === 'overdue' ? 'ended' : 'ends') : 'renews';
          return '<a href="#renewals"><b>' + (r.status === 'overdue' ? '⚠ ' : '⏰ ') + esc(r.name) + '</b> ' + what + ' <b>' + rnWhen(r.daysLeft) + '</b> (' + rnDate(r.dueOn) + ')' +
            (r.provider ? ' · ' + esc(r.provider) : '') + (r.note ? ' — ' + esc(r.note) : '') + '</a>';
        }).join('');
      }, function () {});
    }
    var _route = route;
    route = function () {
      var key = location.hash.replace('#', '').split('/')[0] || 'dashboard';
      if (me && NEED[key] && !can(NEED[key])) { var first = Object.keys(NEED).filter(function (k) { return can(NEED[k]) && VIEWS[k]; })[0]; if (first && first !== key) { location.hash = first; return; } }
      _route();
    };
    window.removeEventListener('hashchange', _route); window.addEventListener('hashchange', route);

    // ---------- saving ----------
    commit = function (msg) { saveMsg = msg || 'Saved'; if (!SCG.save()) { toast('Not signed in. Reload the page.'); return false; } return true; };
    SCG.onSync(function (state, info) {
      if (state === 'saving') toast('Saving…');
      else if (state === 'saved') { if (info) toast('✓ ' + saveMsg); refreshPreview(); }
      else if (state === 'error') toast('Not saved: ' + (info && info.message || 'server error'));
      else if (state === 'reverted') { db = SCG.load(); route(); refreshPreview(); }
    });
    window.addEventListener('beforeunload', function (e) { if (SCG.syncing()) { e.preventDefault(); e.returnValue = ''; } });

    // ---------- product form: no hand-typed ratings/sales; stock per size ----------
    var _productForm = productForm;
    productForm = function (id, opts) {
      _productForm(id, opts);
      var f = $('#modal form'); if (!f) return;
      ['rating', 'reviews', 'sold'].forEach(function (n) { var i = f.elements[n]; if (i) { i.required = false; i.closest('label').hidden = true; } });
      var p = id ? SCG.productById(id) : null, det = p && (p.stockDetail || []).filter(function (v) { return v.active; });
      var st = f.elements.stock;
      if (!can('inventory.adjust') && st) { st.readOnly = true; st.title = 'You cannot change stock'; }
      if (det && det.length > 1 && st) {
        var lab = st.closest('label'); lab.hidden = true;
        lab.insertAdjacentHTML('afterend', '<div class="full"><b style="font-size:13px">Stock per size</b> <small class="muted">(on the shelf; reserved = held for unpaid orders)</small><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:6px">' +
          det.map(function (v) { return '<label style="font-size:12px">' + esc(v.size || 'One size') + (v.reserved ? ' <small class="muted">(' + v.reserved + ' reserved)</small>' : '') + '<input type="number" min="' + v.reserved + '" data-size="' + esc(v.size) + '" value="' + v.onHand + '"' + (can('inventory.adjust') ? '' : ' readonly') + '></label>'; }).join('') +
          '</div><small class="muted">New sizes start at 0 — set their stock after saving.</small></div>');
        f.addEventListener('submit', function () {
          var m = {}, total = 0; $$('input[data-size]', f).forEach(function (i) { m[i.dataset.size] = Math.max(0, Math.floor(+i.value || 0)); total += m[i.dataset.size]; });
          st.value = total; SCG.pendingStock = SCG.pendingStock || {}; SCG.pendingStock[p.id] = m;
        }, true);
      }
    };
    // the API sync reads pending per-size stock from here
    var _sync = SCG.sync;
    SCG.sync = function () {
      var pend = SCG.pendingStock; SCG.pendingStock = null;
      if (pend) Object.keys(pend).forEach(function (pid) { var pr = SCG.productById(pid); if (pr) pr.stockBySize = pend[pid]; });
      return _sync();
    };

    // ---------- dashboard ----------
    VIEWS.dashboard.render = function (v) {
      setActions(can('catalog.write') ? '<a class="btn primary" href="#products/new">+ Add Product</a>' : '');
      v.innerHTML = '<p class="muted">Loading…</p>';
      var h0 = location.hash;   // draw only if the person is still on this page
      SCG.api('GET', '/admin/dashboard').then(function (d) { if (location.hash !== h0) return;
        var dmax = Math.max.apply(null, d.last7days.map(function (x) { return x.total; }).concat([1]));
        var alerts = [];
        if (d.needsReview) alerts.push('<a href="#orders/review">⚠ ' + d.needsReview + ' order(s) need review (late payment, chargeback…)</a>');
        if (d.payments.bank) alerts.push('<a href="#orders/awaiting_bank_transfer">' + d.payments.bank + ' bank transfer(s) to check</a>');
        if (d.payments.cod_uncollected) alerts.push(d.payments.cod_uncollected + ' delivered COD order(s) with cash not yet recorded');
        if (d.backups && !d.backups.ok) alerts.push('<a href="#backups">⚠ Backups: ' + esc(d.backups.problems.join(' ')) + '</a>');
        if (!d.payhere.configured) alerts.push('Card payments (PayHere) are not set up on the server yet');
        else if (d.payhere.mode === 'sandbox') alerts.push('PayHere is in SANDBOX (test) mode — no real money is taken');
        var bk = $('#bkPill'); if (bk) { bk.textContent = d.backups && !d.backups.ok ? '!' : ''; bk.className = 'pill' + (d.backups && !d.backups.ok ? ' red' : ''); }
        v.innerHTML = launchChecklistApi(d) + (alerts.length ? '<div class="panel checklist">' + alerts.map(function (a) { return '<div class="ck"><span class="ck-i">!</span><span>' + a + '</span></div>'; }).join('') + '</div>' : '') +
          '<div class="stats">' + stat('Money received', rs(d.received), '#0f766e') + stat('Orders value', rs(d.booked), '#f59e0b') + stat('Orders', d.orders, '#0b2a6f') +
          stat('Need review', d.needsReview, '#d7141a') + stat('Low stock sizes', d.lowStock.length, '#d7141a') + '</div>' +
          '<div class="cols"><div class="panel"><h3>Sales, last 7 days</h3><div class="chart">' + d.last7days.map(function (x) {
            return '<div class="col"><div class="bar" style="height:' + Math.max(1, x.total / dmax * 100) + '%" title="' + rs(x.total) + '"></div><b>' + (x.total ? (x.total / 1000).toFixed(1) + 'k' : '0') + '</b><small>' + x.day.slice(5) + '</small></div>';
          }).join('') + '</div></div>' +
          '<div class="panel"><h3>Orders by status</h3><div class="status-pills">' + Object.keys(ST).map(function (k) { return '<a href="#orders/' + k + '"><b>' + (d.byStatus[k] || 0) + '</b>' + esc(ST[k]) + '</a>'; }).join('') + '</div></div></div>' +
          '<div class="panel"><h3>Low stock <small>at or below the reorder level</small></h3>' + (d.lowStock.length ? '<div class="filters">' + d.lowStock.map(function (x) {
            return '<a class="tag warn" href="#products/edit:' + esc(x.slug) + '">' + esc(x.name) + (x.size ? ' · ' + esc(x.size) : '') + ' · ' + x.available + ' left</a>'; }).join('') + '</div>' : '<p class="muted">All good.</p>') + '</div>';
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    };
    function launchChecklistApi(d) {
      var s = db.settings, demo = db.products.filter(SCG.isDemoProduct).length, noPhoto = db.products.filter(function (p) { return !SCG.productImages(p).length; }).length;
      var items = [
        [s.phone && s.phone.replace(/\D/g, '') !== '94770000000', 'Enter your real phone number', '#settings'],
        [s.whatsapp && s.whatsapp !== '94770000000', 'Enter your real WhatsApp number', '#settings'],
        [!/0000000000/.test(s.bankDetails || '') || !s.payBank, 'Enter real bank details (or turn bank transfer off)', '#settings'],
        [!(s.globeStats || []).some(function (x) { return x.value === '1,248'; }), 'Replace the sample numbers under the globe', '#homepage'],
        [!demo, demo + ' demo products are still listed', '#products/'],
        [!noPhoto, noPhoto + ' products have no real photo yet', '#products/'],
        [!d.backups || d.backups.ok, 'Backups are running and checked', '#backups'],
        [d.payhere.configured && d.payhere.mode === 'live', 'Card payments: PayHere live account approved and switched on (owner approval needed)', null, 'Owner approval']
      ];
      var done = items.filter(function (x) { return x[0]; }).length;
      if (done === items.length) return '';
      return '<div class="panel checklist"><div class="head"><h3>Before you go live <small>' + done + ' of ' + items.length + ' done</small></h3></div>' + items.map(function (x) {
        return '<div class="ck' + (x[0] ? ' ok' : '') + '"><span class="ck-i">' + (x[0] ? '✓' : '!') + '</span><span>' + esc(x[1]) + '</span>' + (x[0] ? '' : x[2] ? '<a class="btn sm" href="' + x[2] + '">Fix</a>' : '<span class="tag">' + esc(x[3]) + '</span>') + '</div>';
      }).join('') + '</div>';
    }

    // ---------- orders ----------
    var of = { status: '', q: '' };
    VIEWS.orders.render = function (v, arg) {
      if (arg === 'review') { of.status = 'review'; } else if (arg && ST[arg]) of.status = arg; else if (arg && /^SC-/.test(arg)) { orderModal(arg); }
      v.innerHTML = '<div class="filters" id="otabs">' + [['', 'All']].concat([['review', '⚠ Needs review']]).concat(Object.keys(ST).map(function (k) { return [k, ST[k]]; })).map(function (t) {
        return '<button class="chip' + (of.status === t[0] ? ' on' : '') + '" data-st="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
        '<div class="panel" style="padding:0"><div style="padding:12px"><input id="oq" type="search" aria-label="Search orders" placeholder="Search order number, name, phone or email" value="' + esc(of.q) + '"></div><div id="olist"><p class="muted" style="padding:12px">Loading…</p></div></div>';
      function load() {
        var qs = '?limit=100' + (of.status === 'review' ? '&review=1' : of.status ? '&status=' + of.status : '') + (of.q ? '&q=' + encodeURIComponent(of.q) : '');
        SCG.api('GET', '/admin/orders' + qs).then(function (r) {
          $('#olist').innerHTML = r.items.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr></thead><tbody>' + r.items.map(function (o) {
            return '<tr data-n="' + esc(o.number) + '" style="cursor:pointer"><td><b>' + esc(o.number) + '</b>' + (o.needsReview ? ' <span class="tag warn">review</span>' : '') + '</td><td>' + esc(o.customer.name) + (o.customer.phone ? '<br><small class="muted">' + esc(o.customer.phone) + '</small>' : '') + '</td><td>' + rs(o.total) + '<br><small class="muted">' + o.items + ' item(s)</small></td>' +
              '<td>' + esc(METHOD[o.paymentMethod]) + '<br><small class="' + (o.paymentStatus === 'paid' || o.paymentStatus === 'cod_collected' ? '' : 'muted') + '">' + esc(PAY[o.paymentStatus] || o.paymentStatus) + '</small></td><td>' + esc(ST[o.status] || o.status) + '</td><td><small>' + when(o.placedAt) + '</small></td></tr>';
          }).join('') + '</tbody></table></div>' + (r.total > r.items.length ? '<p class="muted" style="padding:10px">Showing ' + r.items.length + ' of ' + r.total + '. Search to narrow down.</p>' : '') : '<p class="empty" style="padding:16px">No orders here.</p>';
        }, function (err) { $('#olist').innerHTML = '<p class="muted" style="padding:12px">' + esc(err.message) + '</p>'; });
      }
      load();
      $('#otabs').onclick = function (e) { var b = e.target.closest('[data-st]'); if (!b) return; of.status = b.dataset.st; $$('#otabs .chip').forEach(function (x) { x.classList.toggle('on', x === b); }); load(); };
      var t; $('#oq').oninput = function (e) { clearTimeout(t); t = setTimeout(function () { of.q = e.target.value.trim(); load(); }, 300); };
      $('#olist').onclick = function (e) { var tr = e.target.closest('tr[data-n]'); if (tr) orderModal(tr.dataset.n, load); };
    };
    function orderModal(number, onChange) {
      openModal('Order ' + number, '<p class="muted">Loading…</p>');
      SCG.api('GET', '/admin/orders/' + encodeURIComponent(number)).then(function (o) {
        var next = FLOW[FLOW.indexOf(o.status) + 1], prev = FLOW[FLOW.indexOf(o.status) - 1];
        var c = o.customer || {};
        var acts = [];
        if (can('orders.update') && next) acts.push('<button class="btn primary" data-act="status" data-to="' + next + '">Mark as: ' + esc(ST[next]) + '</button>');
        if (can('orders.update') && prev && FLOW.indexOf(o.status) > -1) acts.push('<button class="btn" data-act="status" data-to="' + prev + '">Back to: ' + esc(ST[prev]) + '</button>');
        if (can('payments.verify') && o.paymentMethod === 'bank_transfer' && o.paymentStatus !== 'paid' && (o.status === 'awaiting_bank_transfer' || o.status === 'expired')) acts.push('<button class="btn primary" data-act="bank">Confirm bank transfer received</button>');
        if (can('payments.verify') && o.paymentMethod === 'cod' && o.paymentStatus === 'cod_pending' && o.status !== 'cancelled') acts.push('<button class="btn" data-act="cod">Cash collected</button>');
        if (can('orders.update') && FLOW.indexOf(o.status) > -1) acts.push('<button class="btn" data-act="ship">Add / update shipment</button>');
        if (o.needsReview && can('payments.verify')) acts.push('<button class="btn" data-act="resolve">Mark review as resolved</button>');
        if (!/cancelled|expired|refunded/.test(o.status)) acts.push('<button class="btn danger" data-act="cancel">' + (o.paymentStatus === 'paid' || o.paymentStatus === 'cod_collected' ? 'Refund / cancel' : 'Cancel order') + '</button>');
        $('#modalBody').innerHTML =
          (o.needsReview ? '<div class="co-err">⚠ Needs review: ' + esc(o.reviewReason) + '</div>' : '') +
          '<div class="grid2"><div><p><b>' + esc(ST[o.status] || o.status) + '</b> · ' + esc(METHOD[o.paymentMethod]) + ' · <b>' + esc(PAY[o.paymentStatus] || o.paymentStatus) + '</b></p>' +
            (c.phone ? '<p>' + esc(c.name) + '<br><a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a> · <a target="_blank" rel="noopener" href="https://wa.me/' + esc(String(c.phone).replace(/\D/g, '').replace(/^0/, '94')) + '">WhatsApp</a>' + (c.email ? '<br>' + esc(c.email) : '') + '<br>' + esc(c.address) + ', ' + esc(c.city) + ', ' + esc(c.district) + (c.note ? '<br><i>Note: ' + esc(c.note) + '</i>' : '') + '</p>' : '<p class="muted">Customer details hidden (no permission).</p>') +
          '</div><div>' + o.items.map(function (it) { return '<div class="sum-row"><span>' + esc(it.name) + ' <small class="muted">' + esc(it.variant) + ' ×' + it.qty + ' · ' + esc(it.sku) + '</small></span><span>' + rs(it.lineTotal) + '</span></div>'; }).join('') +
            '<div class="sum-row"><span>Delivery</span><span>' + rs(o.shipping) + '</span></div>' + (o.discount ? '<div class="sum-row"><span>Discount</span><span>−' + rs(o.discount) + '</span></div>' : '') + '<div class="sum-row total"><span>Total</span><span>' + rs(o.total) + '</span></div></div></div>' +
          '<div class="filters" style="margin:12px 0">' + acts.join('') + '</div>' +
          '<h4>Timeline</h4>' + o.timeline.map(function (h) { return '<div class="sum-row"><span>' + esc(ST[h.to_status] || h.to_status) + ' <small class="muted">' + esc(h.actor) + (h.note ? ' — ' + esc(h.note) : '') + '</small></span><small>' + when(h.created_at) + '</small></div>'; }).join('') +
          (o.payments.length ? '<h4>Payments</h4>' + o.payments.map(function (p) { return '<div class="sum-row"><span>' + esc(METHOD[p.provider]) + ' · ' + esc(p.status) + (p.provider_payment_id ? ' · PayHere ' + esc(p.provider_payment_id) : '') + (p.card_mask ? ' · ' + esc(p.method || '') + ' ' + esc(p.card_mask) : '') + (p.reference ? ' · ref ' + esc(p.reference) : '') + (p.verified_by ? ' · checked by ' + esc(p.verified_by) : '') + '</span><small>' + rs(p.expected) + '</small></div>'; }).join('') : '') +
          (o.paymentEvents.length ? '<h4>PayHere notifications</h4>' + o.paymentEvents.map(function (e) { return '<div class="sum-row"><span>status ' + e.status_code + ' · ' + esc(e.result) + (e.signature_valid ? '' : ' · <b style="color:var(--red)">bad signature</b>') + '</span><small>' + when(e.received_at) + '</small></div>'; }).join('') : '') +
          (o.shipments.length ? '<h4>Shipments</h4>' + o.shipments.map(function (s) { return '<div class="sum-row"><span>' + esc(s.carrier) + ' · ' + esc(s.tracking_number) + ' · ' + esc(s.status) + '</span></div>'; }).join('') : '') +
          (o.refunds.length ? '<h4>Refunds</h4>' + o.refunds.map(function (r) { return '<div class="sum-row"><span>' + esc(r.reason) + ' · by ' + esc(r.username || '') + (r.restock ? ' · restocked' : '') + '</span><span>' + rs(r.amount) + '</span></div>'; }).join('') : '');
        var done = function (msg) { return function () { toast(msg); closeModal(); if (onChange) onChange(); else route(); SCG.adminState().then(function () { db = SCG.load(); refreshPreview(); }); }; };
        var post = function (path, body, msg) { return SCG.api('POST', '/admin/orders/' + encodeURIComponent(o.number) + path, body || {}).then(done(msg), fail); };
        $('#modalBody').onclick = function (e) {
          var b = e.target.closest('[data-act]'); if (!b) return;
          var a = b.dataset.act;
          if (a === 'status') post('/status', { status: b.dataset.to, note: '' }, 'Status: ' + ST[b.dataset.to]);
          if (a === 'cod') { if (confirm('Record that the courier handed over ' + rs(o.total) + ' cash?')) post('/cod-collected', {}, 'Cash recorded'); }
          if (a === 'bank') { var ref = prompt('Check your BANK ACCOUNT (not a customer screenshot).\nEnter the bank reference for ' + rs(o.total) + ':'); if (ref) post('/verify-bank-transfer', { reference: ref, confirmChecked: true }, 'Bank transfer confirmed'); }
          if (a === 'resolve') { var n = prompt('What did you do to resolve it?'); if (n) post('/resolve-review', { note: n }, 'Review resolved'); }
          if (a === 'ship') {
            var carrier = prompt('Courier / carrier (e.g. Domex, Pronto, DHL):'); if (!carrier) return;
            var trk = prompt('Tracking number:') || ''; var st = prompt('Shipment status: preparing, shipped_abroad, arrived_lk, out_for_delivery, delivered', 'shipped_abroad'); if (!st) return;
            post('/shipments', { carrier: carrier, trackingNumber: trk, status: st.trim() }, 'Shipment saved');
          }
          if (a === 'cancel') {
            var reason = prompt('Reason for cancelling:'); if (!reason) return;
            var paid = o.paymentStatus === 'paid' || o.paymentStatus === 'cod_collected', body = { reason: reason };
            if (paid) {
              if (!can('refunds.create')) { toast('This order is paid. Ask finance or the owner to record the refund.'); return; }
              var amt = prompt('Refund amount (you must actually pay this back to the customer):', String(o.total)); if (!amt) return;
              body.refund = { amount: +amt, restock: confirm('Put the items back into stock?') };
            }
            post('/cancel', body, paid ? 'Refund recorded' : 'Order cancelled');
          }
        };
      }, function (err) { $('#modalBody').innerHTML = '<p>' + esc(err.message) + '</p>'; });
    }
    var _updatePill = updatePill;
    updatePill = function () {
      var el = $('#orderPill'); if (!el || !can('orders.read')) return;
      SCG.api('GET', '/admin/orders?status=confirmed&limit=1').then(function (r) { el.textContent = r.total || ''; }, function () {});
    };

    // ---------- customers ----------
    VIEWS.customers.render = function (v) {
      v.innerHTML = '<div class="panel" style="padding:0"><div style="padding:12px"><input id="cq" type="search" aria-label="Search customers" placeholder="Search name, phone or email"></div><div id="clist"><p class="muted" style="padding:12px">Loading…</p></div></div>';
      function load(q) {
        SCG.api('GET', '/admin/customers' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (list) {
          $('#clist').innerHTML = list.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Customer</th><th>Phone</th><th>Account</th><th>Orders</th><th>Paid</th><th>Last order</th></tr></thead><tbody>' + list.map(function (c) {
            return '<tr><td><b>' + esc(c.name) + '</b>' + (c.email ? '<br><small class="muted">' + esc(c.email) + '</small>' : '') + '</td><td>' + esc(c.phone) + '</td><td>' + (c.account ? (c.verified ? 'Verified' : 'Not verified') : 'Guest') + '</td><td>' + c.orders + '</td><td>' + rs(c.spent) + '</td><td><small>' + when(c.last_order) + '</small></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="empty" style="padding:16px">No customers yet.</p>';
        }, function (err) { $('#clist').innerHTML = '<p class="muted" style="padding:12px">' + esc(err.message) + '</p>'; });
      }
      load(''); var t; $('#cq').oninput = function (e) { clearTimeout(t); t = setTimeout(function () { load(e.target.value.trim()); }, 300); };
    };

    // ---------- settings: server password + data panel ----------
    var _settings = VIEWS.settings.render;
    VIEWS.settings.render = function (v) {
      _settings(v);
      var d = $('#dform .full[style*="flex-wrap"]');
      if (d) {
        d.insertAdjacentHTML('beforeend', sw('payOnline', !!db.settings.payOnline, 'Card payment (PayHere) at checkout'));
        $('#dform').addEventListener('submit', function (e) { var c = e.target.elements.payOnline; if (c) db.settings.payOnline = c.checked; }, true);
      }
      var a = $('#aform');
      if (a) {
        a.outerHTML = '<form class="panel" id="aform"><h3>My password</h3><p class="muted" style="margin-top:0">Signed in as <b>' + esc(me ? me.username : '') + '</b>. Staff accounts are managed in <a href="#staff" style="color:var(--red)">Staff &amp; Roles</a>.</p><div class="form">' +
          '<label>Current password<input name="cur" type="password" required autocomplete="current-password"></label><label>New password (12+ characters)<input name="pw" type="password" required minlength="12" autocomplete="new-password"></label>' +
          '<div class="form-foot"><button class="btn dark">Change password</button></div></div></form>';
        $('#aform').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements; SCG.api('POST', '/admin/auth/password', { currentPassword: E.cur.value, newPassword: E.pw.value }).then(function () { toast('Password changed. Other devices were signed out.'); e.target.reset(); }, fail); };
      }
      var exp = $('#exp'); var bp = exp && exp.closest('.panel');
      if (bp) {
        bp.innerHTML = '<h3>Data &amp; backups</h3><p class="muted" style="margin-top:0">Everything is saved in the online database and backed up automatically. See <a href="#backups" style="color:var(--red)">Backups</a> for the latest status.</p>' +
          '<div class="filters"><button class="btn" id="exp2">⬇ Download catalogue (JSON)</button>' + (can('catalog.write') ? '<button class="btn danger" id="rmDemo2">Hide all demo products</button>' : '') + '</div>';
        $('#exp2').onclick = function () { var blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), categories: db.categories, collections: db.collections, hero: db.hero, products: db.products }, null, 1)], { type: 'application/json' }); var u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = 'source-connect-catalogue.json'; l.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
        var rm = $('#rmDemo2'); if (rm) rm.onclick = function () {
          var n = db.products.filter(SCG.isDemoProduct).length; if (!n) { toast('No demo products left'); return; }
          if (!confirm('Hide the ' + n + ' demo products from the website? They are archived, not deleted.')) return;
          db.products = db.products.filter(function (p) { return !SCG.isDemoProduct(p); }); commit(n + ' demo products hidden'); route();
        };
      }
    };

    // ---------- staff & roles ----------
    VIEWS.staff = { title: 'Staff & Roles', sub: 'Who can sign in and what each person may do', render: function (v) {
      setActions('<button class="btn primary" id="addStaff">+ Add staff</button>');
      v.innerHTML = '<p class="muted">Loading…</p>';
      var h0 = location.hash;   // draw only if the person is still on this page
      SCG.api('GET', '/admin/staff').then(function (r) { if (location.hash !== h0) return;
        var shops = (db.shops || []).map(function (s) { return s.id; });
        v.innerHTML = '<div class="panel" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Roles</th><th>Departments</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>' + r.staff.map(function (u) {
          return '<tr><td><b>' + esc(u.display_name) + '</b><br><small class="muted">' + esc(u.username) + '</small></td><td>' + u.roles.map(esc).join(', ') + '</td><td>' + (u.shops.length ? u.shops.map(esc).join(', ') : 'All') + '</td><td>' + esc(u.status) + (u.locked_until && new Date(u.locked_until) > new Date() ? ' · locked' : '') + (u.must_change_password ? ' · temp password' : '') + '</td><td><small>' + when(u.last_login_at) + '</small></td>' +
            '<td><button class="btn sm" data-edit="' + u.id + '">Edit</button></td></tr>';
        }).join('') + '</tbody></table></div></div><div class="panel"><h3>Roles</h3>' + r.roles.map(function (ro) { return '<p><b>' + esc(ro.name) + '</b> <small class="muted">(' + esc(ro.code) + ')</small> — ' + esc(ro.description) + '<br><small class="muted">' + ro.permissions.map(esc).join(', ') + '</small></p>'; }).join('') + '</div>';
        var roleBoxes = function (sel) { return r.roles.map(function (ro) { return '<label class="chk"><input type="checkbox" name="role" value="' + esc(ro.code) + '"' + (sel.indexOf(ro.code) > -1 ? ' checked' : '') + '> ' + esc(ro.name) + '</label>'; }).join(''); };
        var shopBoxes = function (sel) { return shops.map(function (s) { return '<label class="chk"><input type="checkbox" name="shop" value="' + esc(s) + '"' + (sel.indexOf(s) > -1 ? ' checked' : '') + '> ' + esc(s) + '</label>'; }).join(''); };
        var vals = function (f, n) { return $$('input[name=' + n + ']:checked', f).map(function (x) { return x.value; }); };
        $('#addStaff').onclick = function () {
          openModal('Add staff', '<form class="form" id="stf"><label>Username<input name="username" required pattern="[A-Za-z0-9._-]{3,40}"></label><label>Full name<input name="displayName" required></label><label class="full">Email (optional)<input name="email" type="email"></label>' +
            '<label class="full">Temporary password (12+ characters; they must change it at first sign-in)<input name="pw" required minlength="12"></label><div class="full"><b>Roles</b><br>' + roleBoxes([]) + '</div><div class="full"><b>Departments</b> <small class="muted">(only for “Department Staff”)</small><br>' + shopBoxes([]) + '</div>' +
            '<div class="form-foot"><button class="btn primary">Create</button></div></form>');
          $('#stf').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements;
            SCG.api('POST', '/admin/staff', { username: E.username.value.trim(), displayName: E.displayName.value.trim(), email: E.email.value.trim(), roles: vals(e.target, 'role'), shops: vals(e.target, 'shop'), temporaryPassword: E.pw.value })
              .then(function () { toast('Staff account created'); closeModal(); route(); }, fail); };
        };
        v.onclick = function (e) {
          var b = e.target.closest('[data-edit]'); if (!b) return;
          var u = r.staff.filter(function (x) { return x.id === b.dataset.edit; })[0];
          openModal('Edit ' + u.username, '<form class="form" id="stf"><label class="full">Full name<input name="displayName" required value="' + esc(u.display_name) + '"></label><div class="full"><b>Roles</b><br>' + roleBoxes(u.roles) + '</div><div class="full"><b>Departments</b><br>' + shopBoxes(u.shops) + '</div>' +
            '<label>Status<select name="status"><option value="active"' + (u.status === 'active' ? ' selected' : '') + '>Active</option><option value="disabled"' + (u.status === 'disabled' ? ' selected' : '') + '>Disabled (cannot sign in)</option></select></label>' +
            '<label>Reset password (optional, 12+)<input name="pw" minlength="12" placeholder="Leave blank to keep"></label><label class="chk full"><input type="checkbox" name="unlock"> Unlock after too many wrong passwords</label>' +
            '<div class="form-foot"><button class="btn primary">Save</button></div></form>');
          $('#stf').onsubmit = function (ev) { ev.preventDefault(); var E = ev.target.elements, body = { displayName: E.displayName.value.trim(), roles: vals(ev.target, 'role'), shops: vals(ev.target, 'shop'), status: E.status.value, unlock: E.unlock.checked };
            if (E.pw.value) body.resetPassword = E.pw.value;
            SCG.api('PUT', '/admin/staff/' + u.id, body).then(function () { toast('Saved'); closeModal(); route(); }, fail); };
        };
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    } };

    // ---------- audit log ----------
    VIEWS.audit = { title: 'Audit Log', sub: 'Every sign-in, change and payment event, newest first', render: function (v) {
      v.innerHTML = '<p class="muted">Loading…</p>';
      var h0 = location.hash;   // draw only if the person is still on this page
      SCG.api('GET', '/admin/audit?limit=200').then(function (rows) { if (location.hash !== h0) return;
        v.innerHTML = '<div class="panel" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>IP</th></tr></thead><tbody>' + rows.map(function (r) {
          return '<tr><td><small>' + when(r.created_at) + '</small></td><td>' + esc(r.actor_label || r.actor_type) + '</td><td>' + esc(r.action) + '</td><td><small>' + esc(r.entity_type || '') + ' ' + esc(r.entity_id || '') + '</small></td><td><small>' + esc(r.ip || '') + '</small></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    } };

    // ---------- backups (read-only) ----------
    VIEWS.backups = { title: 'Backups', sub: 'Automatic database backups (read-only status)', render: function (v) {
      v.innerHTML = '<p class="muted">Loading…</p>';
      var h0 = location.hash;   // draw only if the person is still on this page
      SCG.api('GET', '/admin/backups').then(function (b) { if (location.hash !== h0) return;
        v.innerHTML = '<div class="panel checklist"><div class="ck' + (b.ok ? ' ok' : '') + '"><span class="ck-i">' + (b.ok ? '✓' : '!') + '</span><span>' + (b.ok ? 'Backups look healthy. Last successful backup: ' + when(b.lastSuccessfulBackupAt) : esc(b.problems.join(' '))) + '</span></div></div>' +
          '<div class="panel" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th>Job</th><th>Result</th><th>Started</th><th>Finished</th><th>Details</th></tr></thead><tbody>' + (b.recent.length ? b.recent.map(function (r) {
            return '<tr><td>' + esc(r.kind) + '</td><td>' + (r.status === 'ok' ? '✓ ok' : r.status === 'failed' ? '<b style="color:var(--red)">failed</b>' : esc(r.status)) + '</td><td><small>' + when(r.started_at) + '</small></td><td><small>' + when(r.finished_at) + '</small></td><td><small>' + esc(JSON.stringify(r.detail || {})).slice(0, 160) + '</small></td></tr>';
          }).join('') : '<tr><td colspan="5" class="muted">No backup has reported in yet.</td></tr>') + '</tbody></table></div></div>' +
          '<p class="muted" style="font-size:13px">Restores are done by the system administrator following the restore runbook (never from this page), so a stolen admin password cannot overwrite the shop’s data.</p>';
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    } };

    // ---------- promo codes ----------
    VIEWS.coupons = { title: 'Promo Codes', sub: 'Discount codes customers type at checkout', render: function (v) {
      setActions('<button class="btn primary" id="addCp">+ New code</button>');
      v.innerHTML = '<p class="muted">Loading…</p>';
      var h0 = location.hash;   // draw only if the person is still on this page
      SCG.api('GET', '/admin/coupons').then(function (list) { if (location.hash !== h0) return;
        v.innerHTML = '<div class="panel" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Discount</th><th>Min. order</th><th>Used</th><th>Valid</th><th>Active</th></tr></thead><tbody>' + (list.length ? list.map(function (c) {
          return '<tr><td><b>' + esc(c.code) + '</b></td><td>' + (c.kind === 'percent' ? c.value + '%' : rs(c.value)) + '</td><td>' + rs(c.min_subtotal) + '</td><td>' + c.used + (c.max_redemptions ? ' / ' + c.max_redemptions : '') + '</td><td><small>' + (c.starts_at ? when(c.starts_at) : 'now') + ' → ' + (c.ends_at ? when(c.ends_at) : 'no end') + '</small></td>' +
            '<td><label class="switch"><input type="checkbox" data-cp="' + c.id + '"' + (c.active ? ' checked' : '') + '><i></i></label></td></tr>'; }).join('') : '<tr><td colspan="6" class="muted">No promo codes yet.</td></tr>') + '</tbody></table></div></div>';
        v.onchange = function (e) { var c = e.target.closest('[data-cp]'); if (c) SCG.api('PUT', '/admin/coupons/' + c.dataset.cp, { active: c.checked }).then(function () { toast('Saved'); }, fail); };
        $('#addCp').onclick = function () {
          openModal('New promo code', '<form class="form" id="cpf"><label>Code<input name="code" required pattern="[A-Za-z0-9_-]{3,30}" placeholder="e.g. NEWYEAR10"></label><label>Type<select name="kind"><option value="percent">% off</option><option value="fixed">Fixed amount off</option></select></label>' +
            '<label>Value<input name="value" type="number" min="1" required></label><label>Minimum order (Rs.)<input name="min" type="number" min="0" value="0"></label><label>Max uses (optional)<input name="max" type="number" min="1"></label><label>Ends (optional)<input name="ends" type="datetime-local"></label>' +
            '<div class="form-foot"><button class="btn primary">Create</button></div></form>');
          $('#cpf').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements, body = { code: E.code.value.trim(), kind: E.kind.value, value: +E.value.value, minSubtotal: +E.min.value || 0 };
            if (E.max.value) body.maxRedemptions = +E.max.value; if (E.ends.value) body.endsAt = new Date(E.ends.value).toISOString();
            SCG.api('POST', '/admin/coupons', body).then(function () { toast('Promo code created'); closeModal(); route(); }, fail); };
        };
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    } };

    VIEWS.renewals = { title: 'Renewals', sub: 'Get a warning before a paid service renews or a free trial ends (Sri Lanka dates)', render: function (v) {
      setActions('<button class="btn primary" id="addRn">+ Add reminder</button>');
      v.innerHTML = '<p class="muted">Loading…</p>';
      var h0 = location.hash, items = [];
      var CYC = { monthly: 'Every month', yearly: 'Every year', once: 'One time (trial end)' };
      var ST = { due_soon: '<span class="rn-st soon">Due soon</span>', overdue: '<span class="rn-st late">Overdue</span>', ok: '<span class="rn-st ok">OK</span>', off: '<span class="rn-st off">Off</span>' };
      function form(r) {
        r = r || { name: '', provider: '', dueOn: '', cycle: 'monthly', remindDays: 1, note: '', active: true };
        openModal(r.id ? 'Edit reminder' : 'New reminder', '<form class="form" id="rnf">' +
          '<label>Name<input name="name" required maxlength="60" list="rnNames" value="' + esc(r.name) + '" placeholder="e.g. Supabase Pro"></label>' +
          '<datalist id="rnNames"><option value="Supabase Pro"><option value="Cloudflare"><option value="VPS server"><option value="Domain name"><option value="Email service"></datalist>' +
          '<label>Company / provider (optional)<input name="provider" maxlength="60" value="' + esc(r.provider) + '" placeholder="e.g. Supabase"></label>' +
          '<label>' + (r.id && r.cycle !== 'once' ? 'First renewal date (later dates follow from it)' : 'Renewal / end date') + '<input name="due" type="date" required value="' + esc(r.id ? r.firstDue : r.dueOn) + '"></label>' +
          '<label>Repeats<select name="cycle">' + Object.keys(CYC).map(function (k) { return '<option value="' + k + '"' + (r.cycle === k ? ' selected' : '') + '>' + CYC[k] + '</option>'; }).join('') + '</select></label>' +
          '<label>Warn me this many days before<input name="remind" type="number" min="0" max="30" required value="' + r.remindDays + '"></label>' +
          '<label>Note (optional)<input name="note" maxlength="200" value="' + esc(r.note) + '" placeholder="e.g. paid with the business card"></label>' +
          '<label class="chk"><input type="checkbox" name="active"' + (r.active ? ' checked' : '') + '> Warnings on</label>' +
          '<div class="form-foot">' + (r.id ? '<button type="button" class="btn danger" id="rnDel">Delete</button>' : '') + '<button class="btn primary">Save</button></div></form>');
        $('#rnf').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements;
          var body = { name: E.name.value.trim(), provider: E.provider.value.trim(), dueOn: E.due.value, cycle: E.cycle.value, remindDays: +E.remind.value, note: E.note.value.trim(), active: E.active.checked };
          SCG.api(r.id ? 'PUT' : 'POST', '/admin/renewals' + (r.id ? '/' + r.id : ''), body).then(function () { toast('Saved'); closeModal(); route(); checkRenewals(); }, fail); };
        if (r.id) $('#rnDel').onclick = function () { if (!confirm('Delete the reminder "' + r.name + '"?')) return;
          SCG.api('DELETE', '/admin/renewals/' + r.id).then(function () { toast('Deleted'); closeModal(); route(); checkRenewals(); }, fail); };
      }
      $('#addRn').onclick = function () { form(); };
      SCG.api('GET', '/admin/renewals').then(function (d) { if (location.hash !== h0) return;
        items = d.items;
        v.innerHTML = '<div class="panel" style="padding:0"><div class="table-wrap"><table class="table"><thead><tr><th>Service</th><th>Next date</th><th>When</th><th>Repeats</th><th>Warn</th><th>Status</th><th></th></tr></thead><tbody>' +
          (items.length ? items.map(function (r, i) {
            return '<tr><td><b>' + esc(r.name) + '</b>' + (r.provider ? '<br><small class="muted">' + esc(r.provider) + '</small>' : '') + (r.note ? '<br><small class="muted">' + esc(r.note) + '</small>' : '') + '</td>' +
              '<td>' + rnDate(r.dueOn) + '</td><td>' + rnWhen(r.daysLeft) + '</td><td>' + CYC[r.cycle] + '</td><td>' + (r.remindDays ? r.remindDays + ' day' + (r.remindDays > 1 ? 's' : '') + ' before' : 'on the day') + '</td>' +
              '<td>' + ST[r.status] + '</td><td><button class="btn sm" data-rn="' + i + '">Edit</button></td></tr>';
          }).join('') : '<tr><td colspan="7" class="muted">No reminders yet. Add one for each paid service: Supabase Pro, VPS, domain, …</td></tr>') + '</tbody></table></div></div>' +
          '<p class="muted" style="font-size:13px">Today in Sri Lanka: ' + rnDate(d.today) + '. Monthly and yearly dates move on by themselves after they pass. A one-time date (for example a free trial) stays “Overdue” until you change or delete it. ' +
          'The warning shows at the top of every admin page and on this menu item.</p>';
        v.onclick = function (e) { var b = e.target.closest('[data-rn]'); if (b) form(items[+b.dataset.rn]); };
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });
    } };

    // ---------- sales & profit (owner / finance) ----------
    // All numbers are calculated in the database (admin_sales_report); this page only shows them.
    var LK = function (d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date()); };
    var addDays = function (ymd, n) { var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    var rsx = function (n) {
      if (n === null || n === undefined) return '—';
      return esc(db.settings.currency || 'Rs.') + ' ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
    };
    var profitCell = function (n) { return n === null || n === undefined ? '<span class="muted" title="Some units have no cost price">—</span>' : n < 0 ? '<b style="color:var(--red)">' + rsx(n) + '</b>' : rsx(n); };
    var dayName = function (ymd) { return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
    var rp = { from: '', to: '', preset: '7', past: false, seq: 0 };
    function presetRange(k) {
      var t = LK(), m0 = t.slice(0, 8) + '01';
      if (k === 'today') return [t, t];
      if (k === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
      if (k === '7') return [addDays(t, -6), t];
      if (k === '30') return [addDays(t, -29), t];
      if (k === 'month') return [m0, t];
      if (k === 'lastmonth') { var end = addDays(m0, -1); return [end.slice(0, 8) + '01', end]; }
      return [rp.from, rp.to];
    }
    function csvCell(x) { var s = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    function downloadCsv(name, rows) {
      var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    VIEWS.reports = { title: 'Sales & Profit', sub: 'What sold, what did not, money taken and profit (Sri Lanka time)', render: function (v, arg) {
      var tabs = '<div class="filters" style="margin-bottom:14px"><a class="tag' + (arg !== 'costs' ? ' ok' : '') + '" href="#reports">Report</a><a class="tag' + (arg === 'costs' ? ' ok' : '') + '" href="#reports/costs">Cost prices</a></div>';
      if (arg === 'costs') return costsView(v, tabs);
      if (!rp.from) { var r0 = presetRange(rp.preset); rp.from = r0[0]; rp.to = r0[1]; }
      var presets = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month']];
      setActions('<button class="btn" id="rpCsv" disabled>⬇ Download (Excel / CSV)</button>');
      v.innerHTML = tabs + '<div class="panel"><div class="filters" id="rpPre">' + presets.map(function (p) { return '<button type="button" class="tag' + (rp.preset === p[0] ? ' ok' : '') + '" data-pre="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
        '<form id="rpForm" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px"><label>From<input type="date" name="from" required value="' + rp.from + '"></label><label>To<input type="date" name="to" required value="' + rp.to + '"></label><button class="btn primary">Show</button></form></div>' +
        '<div id="rpOut"><p class="muted">Loading…</p></div>';
      $('#rpPre').onclick = function (e) { var b = e.target.closest('[data-pre]'); if (!b) return; rp.preset = b.dataset.pre; var r = presetRange(rp.preset); rp.from = r[0]; rp.to = r[1]; route(); };
      $('#rpForm').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements; if (E.to.value < E.from.value) { toast('The end date is before the start date'); return; } rp.preset = ''; rp.from = E.from.value; rp.to = E.to.value; route(); };
      var h0 = location.hash, seq = ++rp.seq;   // only the newest request may draw
      SCG.api('GET', '/admin/reports/sales?from=' + rp.from + '&to=' + rp.to).then(function (r) { if (location.hash === h0 && seq === rp.seq) showReport(r); }, function (err) { if (location.hash === h0 && seq === rp.seq && $('#rpOut')) $('#rpOut').innerHTML = '<p class="muted">' + esc(err.message) + '</p>'; });

      function showReport(r) {
        var s = r.summary, out = $('#rpOut'); if (!out) return;
        var warn = [];
        if (s.costMissingUnits) warn.push('<b>Profit is not complete:</b> ' + s.costMissingUnits + ' unit(s) sold in this period have no cost price, so the total profit is not shown. ' +
          'Profit on the items that do have a cost: <b>' + rsx(s.profitOnItemsWithCost) + '</b> (before promo-code discounts). ' + (can('costs.write') ? '<a href="#reports/costs">Enter cost prices →</a>' : 'Ask the owner to enter cost prices.'));
        if (s.unpaidCardOrders) warn.push(s.unpaidCardOrders + ' card checkout(s) were started but not paid — not counted.');
        if (s.closedOrders) warn.push(s.closedOrders + ' cancelled / refunded / expired order(s) worth ' + rsx(s.closedValue) + ' — not counted' + (s.refunds ? ' (refunds paid back: ' + rsx(s.refunds) + ')' : '') + '.');
        var dmax = Math.max.apply(null, r.days.map(function (d) { return d.netSales; }).concat([1]));
        var bestDay = r.days.reduce(function (b, d) { return !b || d.netSales > b.netSales ? d : b; }, null);
        var rowsTop = function (list) { return list.length ? list.map(function (p, i) {
          return '<tr><td>' + (i + 1) + '</td><td><a href="#products/edit:' + esc(p.slug) + '">' + esc(p.name) + '</a></td><td><b>' + p.units + '</b></td><td>' + rsx(p.sales) + '</td><td>' + profitCell(p.profit) + '</td><td>' + (p.marginPercent === null || p.marginPercent === undefined ? '—' : p.marginPercent + '%') + '</td></tr>'; }).join('')
          : '<tr><td colspan="6" class="muted">Nothing sold in this period.</td></tr>'; };
        out.innerHTML = (warn.length ? '<div class="panel checklist">' + warn.map(function (w) { return '<div class="ck"><span class="ck-i">!</span><span>' + w + '</span></div>'; }).join('') + '</div>' : '') +
          '<div class="stats rp-stats">' + stat('Orders', s.orders, '#0b2a6f') + stat('Items sold', s.units, '#0b2a6f') + stat('Sales (after discounts)', rsx(s.netSales), '#f59e0b') +
          stat('Money received', rsx(s.received), '#0f766e') + stat('Still to collect', rsx(s.toCollect), '#f59e0b') +
          stat('Cost of goods', rsx(s.cost), '#64748b') + stat('Profit' + (s.marginPercent !== null && s.marginPercent !== undefined ? ' (' + s.marginPercent + '%)' : ''), s.profit === null || s.profit === undefined ? '—' : (s.profit < 0 ? '<span style="color:var(--red)">' + rsx(s.profit) + '</span>' : rsx(s.profit)), '#0f766e') +
          stat('Average order', rsx(s.averageOrder), '#0b2a6f') + '</div>' +
          '<p class="muted" style="font-size:12.5px;margin-top:-6px">Profit = sales after promo-code discounts − cost of goods. Shipping fees collected (' + rsx(s.shipping) + ') are not counted as profit; PayHere fees, courier and other costs are not included. ' +
          'Orders count on the day they were placed (Sri Lanka time). “Still to collect” = cash on delivery and bank transfers not yet received.</p>' +
          (r.days.length > 1 ? '<div class="panel"><h3>Sales per day' + (bestDay && bestDay.netSales ? ' <small>best day: ' + dayName(bestDay.day) + ' — ' + rsx(bestDay.netSales) + '</small>' : '') + '</h3>' +
            '<div class="chart" style="grid-template-columns:repeat(' + r.days.length + ',minmax(0,1fr));gap:' + (r.days.length > 14 ? 2 : 10) + 'px">' + r.days.map(function (d, i) {
              var step = Math.ceil(r.days.length / 8), label = i % step === 0 || i === r.days.length - 1;   // long ranges: label every few days
              return '<div class="col"><div class="bar" style="height:' + Math.max(1, d.netSales / dmax * 100) + '%" title="' + esc(d.day) + ': ' + rsx(d.netSales) + '"></div>' +
                (r.days.length <= 10 ? '<b>' + (d.netSales ? (d.netSales / 1000).toFixed(1) + 'k' : '0') + '</b>' : '<b></b>') + '<small>' + (label ? d.day.slice(5) : '&nbsp;') + '</small></div>'; }).join('') + '</div></div>' : '') +
          '<div><div class="panel" style="padding:0" id="rpTop"><h3 style="padding:16px 16px 0">Best sellers <small>most items sold</small></h3><div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>#</th><th>Product</th><th>Sold</th><th>Sales</th><th>Profit</th><th>Margin</th></tr></thead><tbody>' + rowsTop(r.topProducts) + '</tbody></table></div></div>' +
          '<div class="panel" style="padding:0" id="rpLeast"><h3 style="padding:16px 16px 0">Sold least <small>products on sale now — the slowest sellers first</small></h3><div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>Product</th><th>Sold</th><th>Sales</th></tr></thead><tbody>' + (r.leastSold.length ? r.leastSold.map(function (p) {
            return '<tr><td><a href="#products/edit:' + esc(p.slug) + '">' + esc(p.name) + '</a></td><td>' + (p.units ? p.units : '<span class="tag warn">0</span>') + '</td><td>' + rsx(p.sales) + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="muted">No products on sale.</td></tr>') + '</tbody></table></div>' +
          '<p class="muted" style="padding:0 16px 12px;font-size:12.5px">' + r.notSoldCount + ' product(s) on sale did not sell at all in this period.</p></div></div>' +
          '<div class="panel" style="padding:0"><h3 style="padding:16px 16px 0">Day by day</h3><div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>Day</th><th>Orders</th><th>Items</th><th>Sales</th><th>Profit</th><th>Best seller that day</th></tr></thead><tbody>' + r.days.slice().reverse().map(function (d) {
            return '<tr><td>' + dayName(d.day) + '</td><td>' + d.orders + '</td><td>' + d.units + '</td><td>' + rsx(d.netSales) + '</td><td>' + (d.orders ? profitCell(d.profit) : '—') + '</td><td>' + (d.best ? '<a href="#products/edit:' + esc(d.best.slug) + '">' + esc(d.best.name) + '</a> <small class="muted">(' + d.best.units + ' sold)</small>' : '<span class="muted">no sales</span>') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
          (r.allProducts.length > r.topProducts.length ? '<details class="panel"><summary><b>All ' + r.allProducts.length + ' products sold in this period</b></summary><div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>#</th><th>Product</th><th>Sold</th><th>Sales</th><th>Profit</th><th>Margin</th></tr></thead><tbody>' + rowsTop(r.allProducts) + '</tbody></table></div></details>' : '');
        var btn = $('#rpCsv'); if (btn) { btn.disabled = false; btn.onclick = function () {
          var rows = [['Source Connect sales report', r.from + ' to ' + r.to + ' (Sri Lanka time)'], [],
            ['Orders', s.orders], ['Items sold', s.units], ['Item sales', s.itemSales], ['Promo-code discounts', s.discounts], ['Sales after discounts', s.netSales], ['Shipping fees collected', s.shipping],
            ['Money received', s.received], ['Still to collect', s.toCollect], ['Cost of goods', s.cost], ['Profit', s.profit], ['Margin %', s.marginPercent], ['Units without a cost price', s.costMissingUnits], [],
            ['Day', 'Orders', 'Items', 'Sales', 'Profit', 'Best seller', 'Best seller units']].concat(r.days.map(function (d) { return [d.day, d.orders, d.units, d.netSales, d.profit, d.best ? d.best.name : '', d.best ? d.best.units : '']; }))
            .concat([[], ['Product', 'Items sold', 'Sales', 'Cost', 'Profit', 'Margin %', 'Units without cost']]).concat(r.allProducts.map(function (p) { return [p.name, p.units, p.sales, p.cost, p.profit, p.marginPercent, p.costMissingUnits]; }));
          downloadCsv('sales-' + r.from + '-to-' + r.to + '.csv', rows);
        }; }
      }
    } };
    function costsView(v, tabs) {
      var edit = can('costs.write');
      setActions('');
      v.innerHTML = tabs + '<p class="muted">Loading…</p>';
      var h0 = location.hash;   // draw only if the person is still on this page
      SCG.api('GET', '/admin/product-costs').then(function (list) { if (location.hash !== h0) return;
        var missing = list.filter(function (p) { return p.status === 'active' && (p.cost === null || p.cost === undefined); }).length;
        v.innerHTML = tabs + '<div class="panel"><p style="margin-top:0">The <b>cost price</b> is what one item costs you (buying + import + packing). It is secret: customers and other staff never see it. ' +
          'Each sale keeps the cost that was set <b>on the day it was sold</b>, so changing a cost later does not change past profit.</p>' +
          (missing ? '<p><span class="tag warn">' + missing + ' product(s) on sale have no cost price yet</span></p>' : '<p><span class="tag ok">Every product on sale has a cost price</span></p>') +
          (edit ? '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px"><input type="checkbox" id="cPast" style="margin-top:3px"' + (rp.past ? ' checked' : '') + '> <span>When I save, also use this cost for <b>earlier sales</b> of that product that have no cost yet. ' +
            '(Only fills in sales without a cost; it never changes a cost that was already recorded.)</span></label>' : '<p class="muted">You can see cost prices but only the owner can change them.</p>') +
          '<input id="cQ" placeholder="Search products…" style="margin-top:10px;max-width:320px"></div>' +
          '<div class="panel" style="padding:0"><div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>Product</th><th>Selling price</th><th>Cost price (Rs.)</th><th>Profit per item</th><th></th></tr></thead><tbody id="cRows">' + list.map(function (p) {
            var margin = p.cost === null || p.cost === undefined ? '—' : profitCell(Math.round((p.price - p.cost) * 100) / 100) + (p.price ? ' <small class="muted">(' + Math.round((p.price - p.cost) / p.price * 1000) / 10 + '%)</small>' : '');
            return '<tr data-name="' + esc(p.name.toLowerCase()) + '"><td>' + esc(p.name) + (p.status !== 'active' ? ' <span class="tag">' + esc(p.status) + '</span>' : '') + '</td><td>' + rsx(p.price) + '</td>' +
              '<td>' + (edit ? '<input type="number" min="0" step="0.01" max="10000000" inputmode="decimal" style="width:130px" data-cost="' + esc(p.slug) + '" value="' + (p.cost === null || p.cost === undefined ? '' : p.cost) + '" placeholder="not set">' : rsx(p.cost)) + '</td>' +
              '<td>' + margin + '</td><td>' + (edit ? '<button class="btn sm" data-save="' + esc(p.slug) + '">Save</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
        if ($('#cPast')) $('#cPast').onchange = function (e) { rp.past = e.target.checked; };
        $('#cQ').oninput = function (e) { var q = e.target.value.trim().toLowerCase(); $$('#cRows tr').forEach(function (tr) { tr.hidden = q && tr.dataset.name.indexOf(q) < 0; }); };
        v.onclick = function (e) {
          var b = e.target.closest('[data-save]'); if (!b) return;
          var inp = $('[data-cost="' + b.dataset.save + '"]', v), raw = inp.value.trim(), past = !!($('#cPast') && $('#cPast').checked);
          if (raw !== '' && !/^\d{1,8}(\.\d{1,2})?$/.test(raw)) { toast('Enter the cost in rupees, e.g. 1250 or 1250.50'); inp.focus(); return; }
          if (raw === '' && past) { toast('Enter a cost before using it for earlier sales'); return; }
          b.disabled = true;
          SCG.api('PUT', '/admin/product-costs/' + encodeURIComponent(b.dataset.save), { cost: raw === '' ? null : raw, applyToPast: past }).then(function (r) {
            toast(raw === '' ? 'Cost price removed' : '✓ Cost saved' + (r.appliedToEarlierSaleLines ? ' and used for ' + r.appliedToEarlierSaleLines + ' earlier sale line(s)' : ''));
            route();
          }, function (err) { b.disabled = false; fail(err); });
        };
      }, function (err) { if (location.hash !== h0) return; v.innerHTML = tabs + '<p class="muted">' + esc(err.message) + '</p>'; });
    }

    // ---------- start: is there a valid server session? ----------
    $('#login').hidden = true;
    SCG.adminBoot().then(function (staff) { if (!afterAuth(staff)) { $('#login').hidden = false; } }, function () { $('#login').hidden = false; });
  })();

  if (!SCG.API && loggedIn()) showApp();
})();
