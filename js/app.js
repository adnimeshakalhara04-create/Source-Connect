/* =========================================================
   Source Connect Global — Marketplace storefront app
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = SCG.escapeHTML, money = SCG.money;
  var db = SCG.load();
  var app = $('#app');

  var I = {
    plane: '<svg viewBox="0 0 24 24"><path d="M2 16l8-3V6a2 2 0 014 0v7l8 3v2l-8-2v4l2 1.5V22l-4-1-4 1v-1.5l2-1.5v-4l-8 2z"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>',
    cash: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.5 7-12a7 7 0 00-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M4 5h16l-6 7v6l-4 2v-8z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  /* ---------------- helpers ---------------- */
  var tt;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2400); }
  function stars(r) {
    var out = '<span class="stars" aria-label="' + r + ' out of 5">';
    for (var i = 1; i <= 5; i++) out += I.star.replace('<svg', '<svg class="' + (r >= i - .25 ? '' : 'off') + '"');
    return out + '</span>';
  }
  function originTag(p) {
    return p.origin === 'china' ? '<span class="origin">' + I.plane + 'China Direct</span>' : '<span class="origin local">' + I.truck + 'Ships from Colombo</span>';
  }
  function visual(p, color) { return SCG.productVisual(p, color); }
  function catIcon(c) {
    var sample = db.products.filter(function (p) { return p.category === c.id; })[0];
    return SCG.productSVG(c.shape, c.icon || (sample && sample.color) || '#0b2a6f', 'solid', '#f3f4f6');
  }
  function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n); }
  function sortNewest(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }
  function setTitle(t) { document.title = t ? t + ' | Source Connect Global' : 'Source Connect Global'; }

  /* ---------------- product card ---------------- */
  function card(p, opts) {
    opts = opts || {};
    var off = SCG.discount(p), wish = SCG.getWish().indexOf(p.id) > -1;
    var soldPct = Math.min(96, 30 + (p.sold % 60));
    return '<article class="card" style="--c:' + p.color + '">' +
      '<a class="media" href="#p/' + p.id + '" aria-label="' + esc(p.name) + '">' + visual(p) +
      (off ? '<span class="tag-off">-' + off + '%</span>' : (p.badge === 'New' ? '<span class="tag-new">NEW</span>' : '')) + '</a>' +
      '<button class="heart' + (wish ? ' on' : '') + '" data-wish="' + p.id + '" aria-label="Add to wishlist">' + I.heart + '</button>' +
      '<div class="info"><a class="title" href="#p/' + p.id + '">' + esc(p.name) + '</a>' +
      '<div class="price">' + money(p.price) + '</div>' +
      '<div class="was">' + (p.comparePrice ? '<s>' + money(p.comparePrice) + '</s><b>-' + off + '%</b>' : '') + '</div>' +
      (opts.flash
        ? '<div class="soldbar"><i style="width:' + soldPct + '%"></i><span>' + fmtCount(p.sold) + ' sold</span></div>'
        : '<div class="meta">' + stars(p.rating) + '<span>(' + p.reviews + ')</span></div>' + originTag(p)) +
      (opts.add ? '<div class="add-mini"><button data-add="' + p.id + '">Add to Cart</button></div>' : '') +
      '</div></article>';
  }

  /* ---------------- chrome ---------------- */
  function catListHTML() {
    return '<div class="catlist">' + db.categories.map(function (c) {
      return '<a href="#c/' + c.id + '"><span class="ci" style="background:' + SCG.shade(c.icon || '#0b2a6f', 190) + '">' + catIcon(c) + '</span>' + esc(c.name) + '</a>';
    }).join('') + '</div>';
  }
  function renderChrome() {
    var s = db.settings;
    var ann = (s.announcement || '').split('✦').map(function (x) { return '<span>✦ ' + esc(x.trim()) + '</span>'; }).join('');
    $('#announce').innerHTML = ann + ann;
    $('#searchCat').innerHTML = '<option value="">All categories</option>' + db.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    $('#catsMenu').innerHTML = catListHTML();
    $('#drawerLinks').innerHTML = catListHTML() + '<div class="catlist" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px">' +
      '<a href="#flash">⚡ Flash Sale</a>' + db.collections.map(function (c) { return '<a href="#col/' + c.id + '">' + esc(c.name) + '</a>'; }).join('') +
      '<a href="#track">Track My Order</a><a href="#china-direct">How China Direct Works</a></div>';
    $('#footCats').innerHTML = db.categories.slice(0, 6).map(function (c) { return '<li><a href="#c/' + c.id + '">' + esc(c.name) + '</a></li>'; }).join('');
    $('#footContact').innerHTML = '<li>' + esc(s.address) + '</li><li>' + esc(s.phone) + '</li><li>' + esc(s.email) + '</li>' +
      (s.whatsapp ? '<li><a target="_blank" rel="noopener" href="https://wa.me/' + esc(s.whatsapp) + '">WhatsApp us ↗</a></li>' : '');
    $('#year').textContent = new Date().getFullYear();
    $('#navLinks').innerHTML = (s.navLinks || []).map(function (l) { return '<a href="' + esc(l.link || '#') + '"' + (l.hot ? ' class="hot"' : '') + '>' + esc(l.label) + '</a>'; }).join('');
    $('#payList').innerHTML = (s.paymentMethods || []).map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
    // position the fixed dropdown under its button
    var btn = $('#catsBtn'), menu = $('#catsMenu');
    $('.cats-drop').addEventListener('mouseenter', function () { var b = btn.getBoundingClientRect(); menu.style.left = b.left + 'px'; menu.style.top = b.bottom + 'px'; });
    btn.addEventListener('focus', function () { var b = btn.getBoundingClientRect(); menu.style.left = b.left + 'px'; menu.style.top = b.bottom + 'px'; });
    updateCounts();
  }
  function updateCounts(bump) {
    var n = SCG.getCart().reduce(function (s, l) { return s + l.qty; }, 0);
    ['#cartCount', '#cartCount2'].forEach(function (id) { var el = $(id); el.textContent = n || ''; if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } });
    var w = SCG.getWish().length; $('#wishCount').textContent = w || '';
  }

  function bindChrome() {
    var prog = $('#progress'), top = $('#toTop');
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - innerHeight, y = scrollY;
      prog.style.transform = 'scaleX(' + (h > 0 ? y / h : 0) + ')';
      top.classList.toggle('show', y > 800);
    }, { passive: true });
    top.onclick = function () { scrollTo({ top: 0, behavior: 'smooth' }); };

    var drawer = $('#drawer'), scrim = $('#scrim');
    function openDrawer() { drawer.classList.add('open'); scrim.classList.add('open'); document.body.classList.add('lock'); }
    function closeAll() { drawer.classList.remove('open'); scrim.classList.remove('open'); document.body.classList.remove('lock'); var f = $('.filters.open'); if (f) f.classList.remove('open'); }
    window.__closeAll = closeAll; window.__openScrim = function () { scrim.classList.add('open'); document.body.classList.add('lock'); };
    $('#burger').onclick = openDrawer; $('#drawerClose').onclick = closeAll; scrim.onclick = closeAll;
    drawer.addEventListener('click', function (e) { if (e.target.closest('a')) closeAll(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeAll(); hideSuggest(); } });

    // search + live suggestions
    var input = $('#searchInput'), sug = $('#suggest'), sel = -1;
    function hideSuggest() { sug.hidden = true; sel = -1; }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase(); if (q.length < 2) return hideSuggest();
      var cat = $('#searchCat').value;
      var hits = db.products.filter(function (p) { return (!cat || p.category === cat) && (p.name + ' ' + p.brand).toLowerCase().indexOf(q) > -1; }).slice(0, 6);
      if (!hits.length) return hideSuggest();
      sug.innerHTML = hits.map(function (p) { return '<a href="#p/' + p.id + '"><span class="th" style="background:' + SCG.shade(p.color, 170) + '">' + visual(p) + '</span>' + esc(p.name) + '<small>' + money(p.price) + '</small></a>'; }).join('');
      sug.hidden = false; sel = -1;
    });
    input.addEventListener('keydown', function (e) {
      var items = $$('a', sug); if (sug.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach(function (a, i) { a.classList.toggle('on', i === sel); }); }
      if (e.key === 'Enter' && sel > -1) { e.preventDefault(); location.hash = items[sel].getAttribute('href').slice(1); hideSuggest(); }
    });
    sug.addEventListener('click', function () { setTimeout(hideSuggest, 10); input.blur(); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) hideSuggest(); });
    $('#searchForm').onsubmit = function (e) {
      e.preventDefault(); hideSuggest();
      var q = input.value.trim(), cat = $('#searchCat').value;
      location.hash = q ? 'search/' + encodeURIComponent(q) + (cat ? '/' + cat : '') : (cat ? 'c/' + cat : 'shop');
    };
  }

  /* ---------------- flash sale timing (set in admin) ---------------- */
  function flashEnd() {
    var s = db.settings, now = new Date();
    if (s.flashMode === 'off') return null;
    if (s.flashMode === 'until') { var u = new Date(s.flashUntil); return isNaN(u) || u <= now ? null : u; }
    var end = new Date(now); end.setHours(24, 0, 0, 0); return end;
  }
  function flashOn() { return !!flashEnd(); }
  function isFlash(p) { return p.flash && flashOn(); }
  function cdHTML() { return '<span class="countdown" data-cd>Ending in <b data-d hidden>0</b><b data-h>00</b>:<b data-m>00</b>:<b data-s>00</b></span>'; }
  function tickCountdowns() {
    var end = flashEnd(), d = end ? Math.max(0, end - new Date()) : 0;
    var days = Math.floor(d / 864e5), h = Math.floor(d % 864e5 / 36e5), m = Math.floor(d % 36e5 / 6e4), s = Math.floor(d % 6e4 / 1e3);
    $$('[data-cd]').forEach(function (el) {
      var dd = $('[data-d]', el); dd.hidden = !days; dd.textContent = days + 'd';
      $('[data-h]', el).textContent = String(h).padStart(2, '0');
      $('[data-m]', el).textContent = String(m).padStart(2, '0');
      $('[data-s]', el).textContent = String(s).padStart(2, '0');
    });
  }
  setInterval(tickCountdowns, 1000);

  /* ---------------- globe ---------------- */
  var globe = null;
  function stageHTML(id) {
    var s = db.settings, lines = String(s.heroTitle || '').split('\n');
    var stats = (s.globeStats || []).filter(function (x) { return x && x.value; });
    return '<div class="stage" id="' + id + '"><canvas aria-label="Animated globe showing shipments from China to Sri Lanka" role="img"></canvas>' +
      '<div class="stage-copy"><span class="chip"><i></i><span class="flag">China</span>' + '→' + '<span class="flag">Sri Lanka</span></span>' +
      '<h1>' + lines.map(function (l) { return '<span class="ln"><span>' + esc(l) + '</span></span>'; }).join('') + '</h1>' +
      '<p>' + esc(s.heroSubtitle || '') + '</p>' +
      '<div class="cta-row"><a class="btn" href="#col/china-direct">' + I.plane + 'Shop China Direct</a><a class="btn ghost" href="#china-direct">How it works</a></div>' +
      (stats.length ? '<div class="stage-stats">' + stats.map(function (x) { return '<div><b' + (x.live ? ' data-arrivals data-base="' + esc(x.value) + '"' : '') + '>' + esc(x.value) + '</b><small>' + esc(x.label) + '</small></div>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="legend"><span><i style="background:#ff5058"></i>Sea freight</span><span><i style="background:#ffd65a"></i>Air freight</span></div>' +
      '<div class="arrive-toast" data-arrive>' + I.box + '<span></span></div>' +
      '<div class="timeline">' + (s.globeSteps || []).slice(0, 5).map(function (t, i) { return '<div data-step="' + i + '"><b>' + (i + 1) + '. ' + esc(t.title) + '</b>' + esc(t.text) + '</div>'; }).join('') + '</div>' +
      '</div>';
  }
  function mountGlobe(id) {
    if (globe) { globe.destroy(); globe = null; }
    var st = $('#' + id); if (!st || !window.SCGGlobe) return;
    var live = $('[data-arrivals]', st), base = live ? parseInt(String(live.dataset.base).replace(/\D/g, ''), 10) : NaN;
    var steps = $$('[data-step]', st), toastEl = $('[data-arrive]', st), tid;
    globe = SCGGlobe.mount($('canvas', st), {
      cities: db.settings.globeCities,
      onPhase: function (ph) { steps.forEach(function (s, i) { s.classList.toggle('done', i < ph); s.classList.toggle('on', i === ph); }); },
      onArrive: function (n, origin) {
        if (live && !isNaN(base)) live.textContent = (base + n).toLocaleString('en-US');
        $('span', toastEl).innerHTML = '<b>Arrived:</b> parcel from ' + esc(origin.name) + ' reached Colombo';
        toastEl.classList.add('show'); clearTimeout(tid); tid = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
      }
    });
  }
  function svcIcon(name) {
    if (name === 'star') return I.star.replace('<svg', '<svg style="fill:#fff;stroke:none"');
    return I[name] || I.tag;
  }

  /* ---------------- HOME ---------------- */
  var jfy = { list: [], shown: 0, tab: 'all', io: null };
  function renderHome() {
    setTitle('');
    var s = db.settings;
    var flash = flashOn() ? db.products.filter(function (p) { return p.flash; }) : [];
    var promos = db.hero.slice(0, 2), banners = db.hero.slice(2);
    var promoHTML = function (h) {
      return '<a class="promo" href="' + esc(h.link || '#shop') + '" style="--c:' + esc(h.color) + '"><small>' + esc(h.eyebrow) + '</small><b>' + esc(h.title) + '</b><span>' + esc(h.subtitle) + '</span><em>' + esc(h.cta || 'Shop now') + ' →</em>' +
        '<div class="art">' + (h.image ? '<img src="' + h.image + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color)) + '</div></a>';
    };
    var parts = {
      services: function () {
        var list = s.services || []; if (!list.length) return '';
        return '<section class="panel sec services" style="grid-template-columns:repeat(' + Math.min(8, list.length) + ',1fr)">' + list.map(function (v) { return '<a class="svc" href="' + esc(v.link || '#') + '"><span class="ic" style="--c:' + esc(v.color || '#0b2a6f') + '">' + svcIcon(v.icon) + '</span>' + esc(v.label) + '</a>'; }).join('') + '</section>';
      },
      flash: function () {
        if (!flash.length) return '';
        return '<section class="sec"><div class="sec-head"><h2>' + esc(s.flashTitle || 'Flash Sale') + '</h2></div><div class="panel">' +
          '<div class="flash-head"><span class="on-sale">' + I.bolt + 'On Sale Now</span>' + cdHTML() + '<a class="more" href="#flash" style="color:var(--red);font-weight:700;font-size:13px">SHOP ALL PRODUCTS →</a></div>' +
          '<div class="rail">' + flash.slice(0, 12).map(function (p) { return card(p, { flash: true }); }).join('') + '</div></div></section>';
      },
      categories: function () {
        return '<section class="sec"><div class="sec-head"><h2>Categories</h2><a class="more" href="#categories">View all</a></div>' +
          '<div class="panel catgrid" style="overflow:hidden">' + db.categories.map(function (c) { return '<a class="cat" href="#c/' + c.id + '" style="--c:' + (c.icon || '#0b2a6f') + '"><span class="ci">' + catIcon(c) + '</span>' + esc(c.name) + '</a>'; }).join('') + '</div></section>';
      },
      banners: function () {
        if (!banners.length) return '';
        return '<section class="sec banners">' + banners.slice(0, 6).map(function (h) {
          var key = String(h.link || '').split('/')[1] || '';
          var items = db.products.filter(function (p) { return p.category === key || (p.collections || []).indexOf(key) > -1; }).slice(0, 2);
          if (!items.length) items = db.products.filter(function (p) { return p.shape === h.shape; }).slice(0, 2);
          return '<a class="banner" href="' + esc(h.link || '#shop') + '" style="--c:' + esc(h.color) + '"><b>' + esc(h.title) + '</b><span>' + esc(h.subtitle || '') + '</span>' +
            '<div class="stack">' + (h.image ? '<div><img src="' + h.image + '" alt="" style="border-radius:8px;height:100%;object-fit:cover"></div>' : items.map(function (p) { return '<div>' + visual(p) + '</div>'; }).join('')) + '</div></a>';
        }).join('') + '</section>';
      },
      china: function (sec) { return rail(sec.title || 'China Direct', '#col/china-direct', db.products.filter(function (p) { return p.origin === 'china'; }).sort(function (a, b) { return SCG.discount(b) - SCG.discount(a); }).slice(0, 12)); },
      best: function (sec) { return rail(sec.title || 'Best Sellers', '#col/best-sellers', db.products.slice().sort(function (a, b) { return b.sold - a.sold; }).slice(0, 12)); },
      jfy: function (sec) {
        return '<div class="jfy-head"><h2>' + esc(sec.title || 'Just For You') + '</h2><div class="jfy-tabs" id="jfyTabs"><button class="on" data-t="all">All</button>' + db.categories.map(function (c) { return '<button data-t="' + c.id + '">' + esc(c.name) + '</button>'; }).join('') + '</div></div>' +
          '<div class="grid" id="jfy"></div><div class="loader" id="jfyMore"><span class="spinner"></span>Loading more products…</div>';
      }
    };
    var body = (s.sections || []).filter(function (sec) { return sec.on && parts[sec.id]; }).map(function (sec) { return parts[sec.id](sec); }).join('');
    app.innerHTML =
      '<div class="wrap">' +
      '<section class="hero"' + (promos.length ? '' : ' style="grid-template-columns:230px minmax(0,1fr)"') + '>' +
        '<aside class="panel hero-cats"><h3>Categories</h3>' + catListHTML() + '</aside>' +
        stageHTML('stage') +
        (promos.length ? '<div class="promos">' + promos.map(promoHTML).join('') + '</div>' : '') +
      '</section>' + body + '</div>';
    mountGlobe('stage');
    tickCountdowns();
    if ($('#jfyTabs')) {
      $('#jfyTabs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $$('#jfyTabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); startJFY(b.dataset.t); };
      startJFY('all');
    }
  }
  function rail(title, link, list) {
    return '<section class="sec"><div class="sec-head"><h2>' + esc(title) + '</h2><a class="more" href="' + link + '">Shop more</a></div><div class="panel"><div class="rail">' + list.map(function (p) { return card(p); }).join('') + '</div></div></section>';
  }
  function startJFY(tab) {
    jfy.tab = tab; jfy.shown = 0;
    var list = db.products.filter(function (p) { return tab === 'all' || p.category === tab; });
    // interleave categories so the feed feels varied
    if (tab === 'all') {
      var byCat = {}; list.forEach(function (p) { (byCat[p.category] = byCat[p.category] || []).push(p); });
      var keys = Object.keys(byCat), out = [], i = 0, left = true;
      while (left) { left = false; keys.forEach(function (k) { if (byCat[k][i]) { out.push(byCat[k][i]); left = true; } }); i++; }
      list = out;
    }
    jfy.list = list; $('#jfy').innerHTML = '';
    if (jfy.io) jfy.io.disconnect();
    moreJFY();
    var more = $('#jfyMore');
    if ('IntersectionObserver' in window) { jfy.io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) moreJFY(); }, { rootMargin: '400px' }); jfy.io.observe(more); }
    else more.innerHTML = '<button class="btn line" onclick="return false">Load more</button>';
  }
  function moreJFY() {
    var grid = $('#jfy'); if (!grid) return;
    var next = jfy.list.slice(jfy.shown, jfy.shown + 24); jfy.shown += next.length;
    grid.insertAdjacentHTML('beforeend', next.map(function (p) { return card(p, { add: true }); }).join(''));
    if (jfy.shown >= jfy.list.length) { $('#jfyMore').innerHTML = 'You’ve seen all ' + jfy.list.length + ' products. <a href="#shop" style="color:var(--red);margin-left:6px;font-weight:700">Browse with filters →</a>'; if (jfy.io) jfy.io.disconnect(); }
  }

  /* ---------------- LISTING ---------------- */
  function renderListing(kind, val, extra) {
    var title = 'All Products', sub = 'Everything we sell, in one place.', color = '#0b2a6f', art = 'tshirt';
    var st = { cats: [], min: '', max: '', rating: 0, origins: [], sale: false, sort: 'pop', q: '', coll: '', limit: 30 };
    if (kind === 'c') { var c = SCG.categoryById(val); if (c) { title = c.name; sub = c.tagline; color = c.icon || color; art = c.shape; st.cats = [c.id]; } }
    if (kind === 'col') { var co = SCG.collectionById(val); if (co) { title = co.name; sub = co.description; color = co.accent; art = 'bag'; st.coll = co.id; } }
    if (kind === 'flash') { title = db.settings.flashTitle || 'Flash Sale'; sub = flashOn() ? 'Huge discounts for a limited time.' : 'This flash sale has ended. Check back soon for new deals.'; color = '#d7141a'; art = 'sneaker'; st.sale = true; st.flashOnly = true; st.sort = 'off'; }
    if (kind === 'search') { st.q = val; title = 'Results for “' + val + '”'; sub = ''; if (extra) st.cats = [extra]; }
    setTitle(kind === 'search' ? 'Search' : title);

    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>' + esc(title) + '</span></div>' +
      (kind !== 'search' ? '<div class="cat-hero reveal" style="--c:' + color + '"><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p>' + (kind === 'flash' && flashOn() ? '<p style="margin-top:8px">' + cdHTML() + '</p>' : '') + '<div class="art">' + SCG.productSVG(art, '#ffffff', 'solid', color) + '</div></div>' : '') +
      '<div class="listing"><aside class="panel filters" id="filters">' +
        '<div class="grp"><h4>Category</h4>' + db.categories.map(function (c) { return '<label><input type="checkbox" name="fc" value="' + c.id + '"' + (st.cats.indexOf(c.id) > -1 ? ' checked' : '') + '>' + esc(c.name) + '</label>'; }).join('') + '</div>' +
        '<div class="grp"><h4>Price (Rs.)</h4><div class="price-row"><input id="fmin" type="number" min="0" placeholder="Min"><span>–</span><input id="fmax" type="number" min="0" placeholder="Max"></div></div>' +
        '<div class="grp"><h4>Rating</h4>' + [0, 4.5, 4, 3.5].map(function (r) { return '<label><input type="radio" name="fr" value="' + r + '"' + (r === 0 ? ' checked' : '') + '>' + (r ? stars(r) + ' ' + r + ' &amp; up' : 'Any rating') + '</label>'; }).join('') + '</div>' +
        '<div class="grp"><h4>Shipped from</h4><label><input type="checkbox" name="fo" value="china">China Direct (' + esc(db.settings.chinaDays) + ' days)</label><label><input type="checkbox" name="fo" value="local">Colombo stock (' + esc(db.settings.localDays) + ' days)</label></div>' +
        '<div class="grp"><h4>Offers</h4><label><input type="checkbox" id="fsale"' + (st.sale ? ' checked' : '') + '>On discount only</label></div>' +
        '<button class="btn full filter-btn" id="fDone">Show results</button>' +
      '</aside><div>' +
        '<div class="panel list-top"><button class="btn line filter-btn" id="fOpen" style="padding:8px 12px">' + I.filter + 'Filter</button><span class="n" id="count"></span>' +
        '<select id="fsort" aria-label="Sort by"><option value="pop">Best match</option><option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="off">Biggest discount</option><option value="rating">Top rated</option></select></div>' +
        '<div class="grid" id="lgrid"></div><div class="loader" id="lmore"></div>' +
      '</div></div></div>';
    $('#fsort').value = st.sort;

    function draw() {
      var q = st.q.toLowerCase();
      var list = db.products.filter(function (p) {
        if (st.cats.length && st.cats.indexOf(p.category) < 0) return false;
        if (st.coll && (p.collections || []).indexOf(st.coll) < 0) return false;
        if (st.flashOnly && !isFlash(p)) return false;
        if (st.min !== '' && p.price < +st.min) return false;
        if (st.max !== '' && p.price > +st.max) return false;
        if (st.rating && p.rating < st.rating) return false;
        if (st.origins.length && st.origins.indexOf(p.origin) < 0) return false;
        if (st.sale && !p.comparePrice) return false;
        if (q) { var c = SCG.categoryById(p.category); if ((p.name + ' ' + p.brand + ' ' + (c ? c.name : '')).toLowerCase().indexOf(q) < 0) return false; }
        return true;
      });
      var srt = { pop: function (a, b) { return b.sold - a.sold; }, new: sortNewest, low: function (a, b) { return a.price - b.price; }, high: function (a, b) { return b.price - a.price; }, off: function (a, b) { return SCG.discount(b) - SCG.discount(a); }, rating: function (a, b) { return b.rating - a.rating; } }[st.sort];
      list.sort(srt);
      $('#count').textContent = list.length + ' items found';
      $('#lgrid').innerHTML = list.length ? list.slice(0, st.limit).map(function (p) { return card(p, { flash: kind === 'flash', add: true }); }).join('') : '<div class="empty"><h3>No products match</h3>Try removing a filter or searching for something else.</div>';
      $('#lmore').innerHTML = list.length > st.limit ? '<button class="btn line" id="lmoreBtn">Load more (' + (list.length - st.limit) + ' left)</button>' : '';
      if ($('#lmoreBtn')) $('#lmoreBtn').onclick = function () { st.limit += 30; draw(); };
    }
    var f = $('#filters');
    f.addEventListener('change', function () {
      st.cats = $$('input[name=fc]:checked', f).map(function (x) { return x.value; });
      st.origins = $$('input[name=fo]:checked', f).map(function (x) { return x.value; });
      st.rating = +($('input[name=fr]:checked', f) || { value: 0 }).value;
      st.sale = $('#fsale').checked; st.limit = 30; draw();
    });
    var pt; f.addEventListener('input', function (e) { if (e.target.id !== 'fmin' && e.target.id !== 'fmax') return; clearTimeout(pt); pt = setTimeout(function () { st.min = $('#fmin').value; st.max = $('#fmax').value; st.limit = 30; draw(); }, 300); });
    $('#fsort').onchange = function (e) { st.sort = e.target.value; draw(); };
    $('#fOpen').onclick = function () { f.classList.add('open'); window.__openScrim(); };
    $('#fDone').onclick = function () { window.__closeAll(); };
    draw(); tickCountdowns();
  }

  /* ---------------- PRODUCT DETAIL ---------------- */
  function variants(p) {
    if (p.image) return [p.color];
    var pal = ['#0b2a6f', '#1f2937', '#d7141a', '#e5e7eb', '#0f766e', '#c2a878', '#be185d', '#7c2d12'];
    var out = [p.color]; for (var i = 0; out.length < 4 && i < pal.length; i++) { var c = pal[(i + p.name.length) % pal.length]; if (out.indexOf(c) < 0) out.push(c); }
    return out;
  }
  function renderPDP(id) {
    var p = SCG.productById(id);
    if (!p) { app.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:16px"><h3>Product not found</h3><a class="btn" href="#">Back to home</a></div></div>'; return; }
    setTitle(p.name);
    var cat = SCG.categoryById(p.category), off = SCG.discount(p), vars = variants(p);
    var st = { color: vars[0], size: (p.sizes || [])[Math.min(1, (p.sizes || []).length - 1)] || '', qty: 1 };
    var related = db.products.filter(function (x) { return x.category === p.category && x.id !== p.id; }).slice(0, 12);
    var dist = [.62, .22, .09, .04, .03].map(function (k, i) { return Math.round(p.reviews * (p.rating >= 4.5 ? k : [.4, .3, .17, .08, .05][i])); });
    var s = db.settings;

    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<a href="#c/' + p.category + '">' + esc(cat ? cat.name : '') + '</a>›<span>' + esc(p.name) + '</span></div>' +
      '<div class="pdp"><div><div class="panel pdp-main">' +
        '<div class="gallery"><div class="big" id="big" style="--c:' + p.color + '">' + visual(p) + '</div>' +
          '<div class="thumbs" id="thumbs">' + vars.map(function (c, i) { return '<button class="' + (i ? '' : 'on') + '" data-c="' + c + '" aria-label="Colour ' + (i + 1) + '">' + visual(p, c) + '</button>'; }).join('') + '</div></div>' +
        '<div><h1>' + esc(p.name) + '</h1>' +
          '<div class="sub">' + stars(p.rating) + '<span>' + p.rating + ' · ' + p.reviews + ' ratings</span><span>' + fmtCount(p.sold) + ' sold</span><span>Brand: <a href="#search/' + encodeURIComponent(p.brand) + '">' + esc(p.brand) + '</a></span></div>' +
          (isFlash(p) ? '<div class="flash-strip"><span>⚡ ' + esc(db.settings.flashTitle || 'Flash Sale') + '</span>' + cdHTML() + '</div>' : '') +
          '<div class="price-box"><div class="now">' + money(p.price) + '</div>' + (p.comparePrice ? '<div class="old"><s>' + money(p.comparePrice) + '</s><b>-' + off + '%</b></div>' : '') + '</div>' +
          (vars.length > 1 ? '<div class="opt"><span>Colour</span><div class="swatches" id="sw">' + vars.map(function (c, i) { return '<button class="' + (i ? '' : 'on') + '" data-c="' + c + '" aria-label="Colour ' + (i + 1) + '">' + visual(p, c) + '</button>'; }).join('') + '</div></div>' : '') +
          ((p.sizes || []).length ? '<div class="opt"><span>Size</span><div class="sizes" id="sz">' + p.sizes.map(function (z) { return '<button class="' + (z === st.size ? 'on' : '') + '" data-s="' + esc(z) + '">' + esc(z) + '</button>'; }).join('') + '</div></div>' : '') +
          '<div class="opt"><span>Quantity</span><div><div class="qty"><button data-q="-1" aria-label="Less">−</button><span id="qv">1</span><button data-q="1" aria-label="More">+</button></div> <small style="color:' + (p.stock > 0 ? 'var(--muted)' : 'var(--red)') + ';margin-left:8px">' + (p.stock > 0 ? p.stock + ' available' : 'Out of stock') + '</small></div></div>' +
          '<div class="buy-row"><button class="btn navy" id="buyNow">Buy Now</button><button class="btn" id="addCart">Add to Cart</button><button class="btn line heart-btn" data-wish="' + p.id + '" aria-label="Wishlist" style="flex:0 0 auto;padding:14px">' + I.heart + '</button></div>' +
        '</div></div>' +
        '<div class="panel tabs-box"><nav id="ptabs"><button class="on" data-t="d">Description</button><button data-t="s">Specifications</button><button data-t="r">Ratings</button></nav><div class="body" id="pbody"></div></div>' +
      '</div>' +
      '<aside><div class="panel side-box"><h4>Delivery</h4>' +
        '<div class="side-row">' + I.pin + '<div><b>' + esc(s.address || 'Sri Lanka') + '</b><small>Islandwide delivery</small></div></div>' +
        (p.origin === 'china'
          ? '<div class="side-row">' + I.plane + '<div><b>China Direct · ' + esc(s.chinaDays) + ' days</b><small>Shipped from our partner factories in China</small></div></div>'
          : '<div class="side-row">' + I.truck + '<div><b>Standard · ' + esc(s.localDays) + ' days</b><small>In stock at our Colombo warehouse</small></div></div>') +
        '<div class="side-row">' + I.cash + '<div><b>' + (s.payCOD ? 'Cash on Delivery available' : 'Secure payment') + '</b><small>' + (s.freeShipping ? 'Free delivery over ' + money(s.freeShipping) : '') + '</small></div></div>' +
        '<h4 style="margin-top:14px">Service</h4>' +
        '<div class="side-row">' + I.swap + '<div><b>' + esc(s.returnDays) + '-day easy returns</b><small>Change of mind is not applicable</small></div></div>' +
        '<div class="side-row">' + I.shield + '<div><b>Quality checked</b><small>Inspected before it leaves China</small></div></div>' +
        (p.origin === 'china' ? '<div class="route-mini"><b>Shipping route</b><div class="line">🇨🇳 ' + 'China<i></i>Colombo 🇱🇰</div></div>' : '') +
      '</div><div class="panel side-box" style="margin-top:12px"><h4>Sold by</h4><div class="seller"><img src="assets/logo.jpg" alt=""><div><b>Source Connect Global</b><small style="display:block;color:var(--muted)">Official store</small></div></div>' +
        '<div class="seller-stats">' + (s.sellerStats || []).map(function (x) { return '<div><b>' + esc(x.value) + '</b><small>' + esc(x.label) + '</small></div>'; }).join('') + '</div></div></aside></div>' +
      (related.length ? rail('More from ' + (cat ? cat.name : 'this category'), '#c/' + p.category, related) : '') +
      '</div>';

    function tab(t) {
      $$('#ptabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
      $('#pbody').innerHTML = t === 'd' ? '<p style="margin-top:0">' + esc(p.description) + '</p><ul style="color:var(--muted)"><li>Brand: ' + esc(p.brand) + '</li><li>' + (p.origin === 'china' ? 'Ships directly from China (' + esc(s.chinaDays) + ' days)' : 'Ships from Colombo (' + esc(s.localDays) + ' days)') + '</li>' + (s.payCOD ? '<li>Cash on Delivery available islandwide</li>' : '') + '</ul>'
        : t === 's' ? '<table class="spec"><tr><td>Brand</td><td>' + esc(p.brand) + '</td></tr><tr><td>Category</td><td>' + esc(cat ? cat.name : '') + '</td></tr><tr><td>SKU</td><td>' + esc(p.id.toUpperCase()) + '</td></tr>' + ((p.sizes || []).length ? '<tr><td>Sizes</td><td>' + esc(p.sizes.join(', ')) + '</td></tr>' : '') + '<tr><td>Origin</td><td>' + (p.origin === 'china' ? 'China' : 'Sri Lanka stock') + '</td></tr><tr><td>In stock</td><td>' + p.stock + '</td></tr></table>'
          : '<div class="rating-sum"><div><div class="big">' + p.rating + '<small style="font-size:18px;color:var(--muted)">/5</small></div>' + stars(p.rating) + '<div style="color:var(--muted);font-size:12px">' + p.reviews + ' ratings</div></div><div class="rbars">' + dist.map(function (n, i) { return '<div><span>' + (5 - i) + '★</span><i><em style="width:' + (p.reviews ? n / p.reviews * 100 : 0) + '%"></em></i><span>' + n + '</span></div>'; }).join('') + '</div></div>';
    }
    tab('d');
    $('#ptabs').onclick = function (e) { var b = e.target.closest('button'); if (b) tab(b.dataset.t); };
    function pick(c) { st.color = c; $('#big').innerHTML = visual(p, c); ['#thumbs', '#sw'].forEach(function (s) { if ($(s)) $$('button', $(s)).forEach(function (b) { b.classList.toggle('on', b.dataset.c === c); }); }); }
    ['#thumbs', '#sw'].forEach(function (s) { if ($(s)) $(s).onclick = function (e) { var b = e.target.closest('button'); if (b) pick(b.dataset.c); }; });
    if ($('#sz')) $('#sz').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; st.size = b.dataset.s; $$('#sz button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
    $$('[data-q]').forEach(function (b) { b.onclick = function () { st.qty = Math.max(1, Math.min(Math.max(1, p.stock), st.qty + +b.dataset.q)); $('#qv').textContent = st.qty; }; });
    var big = $('#big');
    big.addEventListener('mousemove', function (e) { var r = big.getBoundingClientRect(), el = big.firstElementChild; el.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; el.style.transform = 'scale(1.8)'; });
    big.addEventListener('mouseleave', function () { big.firstElementChild.style.transform = ''; });
    function add() { if (p.stock <= 0) { toast('Sorry, this item is out of stock'); return false; } addToCart(p.id, st.size, st.qty, st.color); return true; }
    $('#addCart').onclick = add;
    $('#buyNow').onclick = function () { if (add()) location.hash = 'cart'; };
    tickCountdowns();
    scrollTo(0, 0);
  }

  /* ---------------- CART ---------------- */
  function addToCart(id, size, qty, color) {
    var p = SCG.productById(id); if (!p) return;
    if (size === undefined || size === null) size = (p.sizes || [])[Math.min(1, (p.sizes || []).length - 1)] || '';
    color = color || p.color;
    var cart = SCG.getCart(), line = cart.filter(function (l) { return l.id === id && l.size === size && l.color === color; })[0];
    if (line) line.qty += qty || 1; else cart.push({ id: id, size: size, color: color, qty: qty || 1, sel: true });
    SCG.saveCart(cart); updateCounts(true); toast('✓ Added to cart: ' + p.name);
  }
  function cartLines() { return SCG.getCart().map(function (l, i) { var p = SCG.productById(l.id); return p ? { l: l, p: p, i: i } : null; }).filter(Boolean); }
  function totals(lines) {
    var sub = lines.reduce(function (s, x) { return s + (x.l.sel === false ? 0 : x.p.price * x.l.qty); }, 0);
    var items = lines.reduce(function (s, x) { return s + (x.l.sel === false ? 0 : x.l.qty); }, 0);
    var fs = +db.settings.freeShipping || 0, ship = !items ? 0 : (fs && sub >= fs ? 0 : (+db.settings.shippingFee || 0));
    return { sub: sub, ship: ship, total: sub + ship, items: items, need: fs ? Math.max(0, fs - sub) : 0 };
  }
  function renderCart() {
    setTitle('Cart');
    var lines = cartLines();
    if (!lines.length) { app.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:16px"><h3>Your cart is empty</h3><p>Browse flash deals and China Direct prices to get started.</p><a class="btn" href="#flash">Shop Flash Sale</a></div></div>'; return; }
    var t = totals(lines);
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Cart</span></div><div class="cart-wrap"><div class="panel">' +
      '<div class="cart-row" style="grid-template-columns:24px 1fr auto;padding:12px 14px"><input type="checkbox" id="selAll"' + (lines.every(function (x) { return x.l.sel !== false; }) ? ' checked' : '') + ' aria-label="Select all"><b>Select all (' + lines.length + ')</b><button class="rm" id="delSel">' + I.trash + '</button></div>' +
      lines.map(function (x) {
        return '<div class="cart-row"><input type="checkbox" data-sel="' + x.i + '"' + (x.l.sel !== false ? ' checked' : '') + ' aria-label="Select"><a class="th" href="#p/' + x.p.id + '" style="background:' + SCG.shade(x.l.color || x.p.color, 175) + '">' + visual(x.p, x.l.color) + '</a>' +
          '<div><h4><a href="#p/' + x.p.id + '">' + esc(x.p.name) + '</a></h4><small>' + (x.l.size ? 'Size: ' + esc(x.l.size) + ' · ' : '') + esc(x.p.brand) + '</small><div style="margin-top:6px">' + originTag(x.p) + '</div>' +
          '<div class="qty" style="margin-top:8px"><button data-cq="-1" data-i="' + x.i + '">−</button><span>' + x.l.qty + '</span><button data-cq="1" data-i="' + x.i + '">+</button></div></div>' +
          '<div class="p">' + money(x.p.price * x.l.qty) + (x.p.comparePrice ? '<div style="font-size:12px;color:var(--muted);font-weight:400"><s>' + money(x.p.comparePrice * x.l.qty) + '</s></div>' : '') + '</div>' +
          '<button class="rm" data-rm="' + x.i + '" aria-label="Remove">' + I.trash + '</button></div>';
      }).join('') + '</div>' +
      '<aside class="panel summary"><h3>Order Summary</h3>' +
      '<div class="sum-row"><span>Subtotal (' + t.items + ' items)</span><span>' + money(t.sub) + '</span></div>' +
      '<div class="sum-row"><span>Delivery fee</span><span>' + (t.ship ? money(t.ship) : 'FREE') + '</span></div>' +
      (t.need && t.items ? '<div class="free-note need">Add ' + money(t.need) + ' more for FREE delivery</div>' : t.items ? '<div class="free-note">🎉 You get FREE delivery</div>' : '') +
      '<div class="sum-row total"><span>Total</span><span>' + money(t.total) + '</span></div>' +
      '<a class="btn full lg" href="#checkout" style="margin-top:12px"' + (t.items ? '' : ' aria-disabled="true" onclick="return false"') + '>Proceed to Checkout (' + t.items + ')</a></aside></div></div>';
    app.onchange = function (e) {
      var cart = SCG.getCart();
      if (e.target.id === 'selAll') cart.forEach(function (l) { l.sel = e.target.checked; });
      else if (e.target.dataset.sel !== undefined) cart[+e.target.dataset.sel].sel = e.target.checked;
      else return;
      SCG.saveCart(cart); renderCart();
    };
    app.onclick = function (e) {
      var cart = SCG.getCart(), b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cq) { var l = cart[+b.dataset.i]; l.qty = Math.max(1, l.qty + +b.dataset.cq); }
      else if (b.dataset.rm) cart.splice(+b.dataset.rm, 1);
      else if (b.id === 'delSel') cart = cart.filter(function (l) { return l.sel === false; });
      else return;
      SCG.saveCart(cart); updateCounts(); renderCart();
    };
  }

  function renderCheckout() {
    setTitle('Checkout');
    var lines = cartLines().filter(function (x) { return x.l.sel !== false; });
    if (!lines.length) { location.hash = 'cart'; return; }
    var t = totals(lines), china = lines.some(function (x) { return x.p.origin === 'china'; }), s = db.settings;
    var districts = ['Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya', 'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla', 'Moneragala', 'Ratnapura', 'Kegalle'];
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<a href="#cart">Cart</a>›<span>Checkout</span></div><div class="cart-wrap">' +
      '<form class="panel form" id="co"><h3>Delivery information</h3>' +
      '<label>Full name<input name="name" required autocomplete="name" placeholder="e.g. Nimal Perera"></label>' +
      '<label>Phone number<input name="phone" required pattern="[0-9+ ]{9,15}" autocomplete="tel" placeholder="07X XXX XXXX"></label>' +
      '<label class="full">Address<input name="address" required autocomplete="street-address" placeholder="House no, street, area"></label>' +
      '<label>City<input name="city" required placeholder="e.g. Nugegoda"></label>' +
      '<label>District<select name="district">' + districts.map(function (d) { return '<option>' + d + '</option>'; }).join('') + '</select></label>' +
      '<label class="full">Note for delivery (optional)<textarea name="note" rows="2"></textarea></label>' +
      '<h3 style="margin-top:6px">Payment method</h3><div class="pay-opts full">' +
      (s.payCOD !== false ? '<label class="pay-opt"><input type="radio" name="pay" value="Cash on Delivery" required>' + I.cash + '<span><b>Cash on Delivery</b><br><small>Pay when your order arrives</small></span></label>' : '') +
      (s.payBank ? '<label class="pay-opt"><input type="radio" name="pay" value="Bank Transfer" required>' + I.shield + '<span><b>Bank Transfer</b><br><small>Bank details are shown after you place the order</small></span></label>' : '') + '</div>' +
      (china ? '<p class="full" style="margin:0;font-size:12.5px;color:var(--muted)">' + I.plane.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"') + ' Some items ship from China and arrive in ' + esc(s.chinaDays) + ' days.</p>' : '') +
      '<button class="btn lg full" style="grid-column:1/-1">Place Order · ' + money(t.total) + '</button></form>' +
      '<aside class="panel summary"><h3>Your order</h3>' + lines.map(function (x) { return '<div class="sum-row" style="gap:10px"><span style="color:var(--text)">' + esc(x.p.name) + ' <small style="color:var(--muted)">×' + x.l.qty + (x.l.size ? ' · ' + esc(x.l.size) : '') + '</small></span><span>' + money(x.p.price * x.l.qty) + '</span></div>'; }).join('') +
      '<div class="sum-row" style="border-top:1px solid var(--line);margin-top:6px;padding-top:10px"><span>Subtotal</span><span>' + money(t.sub) + '</span></div><div class="sum-row"><span>Delivery</span><span>' + (t.ship ? money(t.ship) : 'FREE') + '</span></div>' +
      '<div class="sum-row total"><span>Total</span><span>' + money(t.total) + '</span></div></aside></div></div>';
    var firstPay = $('#co input[name=pay]'); if (firstPay) firstPay.checked = true;
    $('#co').onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(e.target), orders = SCG.getOrders();
      var order = {
        id: 'SCG' + Date.now().toString().slice(-7), date: new Date().toISOString(), status: 'Pending', payment: fd.get('pay') || 'Cash on Delivery',
        customer: { name: fd.get('name'), phone: fd.get('phone'), address: fd.get('address') + ', ' + fd.get('city') + ', ' + fd.get('district'), note: fd.get('note') },
        items: lines.map(function (x) { return { id: x.p.id, name: x.p.name, size: x.l.size, color: x.l.color, qty: x.l.qty, price: x.p.price, origin: x.p.origin }; }),
        subtotal: t.sub, shipping: t.ship, total: t.total
      };
      orders.unshift(order); SCG.saveOrders(orders);
      lines.forEach(function (x) { x.p.stock = Math.max(0, (x.p.stock || 0) - x.l.qty); x.p.sold = (x.p.sold || 0) + x.l.qty; }); SCG.save();
      SCG.saveCart(SCG.getCart().filter(function (l) { return l.sel === false; })); updateCounts();
      app.innerHTML = '<div class="wrap"><div class="panel success" style="margin-top:16px"><div class="tick">' + I.check + '</div><h2 style="margin:0 0 6px">Thank you! Your order is placed.</h2>' +
        '<p>Order number <b>' + order.id + '</b> · Total <b>' + money(order.total) + '</b></p><p style="color:var(--muted)">We will call ' + esc(order.customer.phone) + ' to confirm. Keep your order number to track it.</p>' +
        (order.payment === 'Bank Transfer' && s.bankDetails ? '<p class="free-note need" style="max-width:520px;margin:12px auto"><b>Bank transfer details:</b><br>' + esc(s.bankDetails) + '<br>Use <b>' + order.id + '</b> as the reference.</p>' : '') +
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap"><a class="btn navy" href="#track/' + order.id + '">Track order</a><a class="btn line" href="#">Continue shopping</a></div></div></div>';
      scrollTo(0, 0);
    };
  }

  /* ---------------- other pages ---------------- */
  function renderWishlist() {
    setTitle('Wishlist');
    var list = SCG.getWish().map(SCG.productById).filter(Boolean);
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Wishlist</span></div>' +
      (list.length ? '<div class="sec-head"><h2>My Wishlist (' + list.length + ')</h2></div><div class="grid">' + list.map(function (p) { return card(p, { add: true }); }).join('') + '</div>'
        : '<div class="panel empty"><h3>Your wishlist is empty</h3><p>Tap the ♡ on any product to save it here.</p><a class="btn" href="#">Discover products</a></div>') + '</div>';
  }
  var STEPS = ['Order placed', 'Confirmed', 'Shipped', 'Arrived in Sri Lanka', 'Delivered'];
  function renderTrack(pre) {
    setTitle('Track order');
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Track my order</span></div>' +
      '<form class="panel form" id="tf" style="max-width:640px;margin:0 auto"><h3>Track your order</h3><label>Order number<input name="id" required value="' + esc(pre || '') + '" placeholder="e.g. SCG1234567"></label><label>Phone number<input name="phone" placeholder="Phone used for the order"></label><button class="btn full" style="grid-column:1/-1">Track</button><div id="tr" class="full"></div></form></div>';
    function show() {
      var f = $('#tf'), id = f.id.value.trim().toUpperCase(), ph = f.phone.value.replace(/\D/g, '');
      var o = SCG.getOrders().filter(function (x) { return x.id.toUpperCase() === id && (!ph || x.customer.phone.replace(/\D/g, '').slice(-9) === ph.slice(-9)); })[0];
      if (!o) { $('#tr').innerHTML = '<p style="color:var(--red)">We could not find that order. Check the number, or call us on ' + esc(db.settings.phone) + '.</p>'; return; }
      var idx = { Pending: 0, Confirmed: 1, Shipped: 2, 'Arrived in Sri Lanka': 3, Delivered: 4 }[o.status];
      $('#tr').innerHTML = o.status === 'Cancelled' ? '<p style="color:var(--red)"><b>This order was cancelled.</b></p>' :
        '<div class="track-steps">' + STEPS.map(function (s, i) { return '<div class="' + (i <= idx ? 'done' : '') + '">' + s + '</div>'; }).join('') + '</div>' +
        '<p style="font-size:13px;color:var(--muted)">' + o.items.length + ' item(s) · ' + money(o.total) + ' · placed ' + new Date(o.date).toLocaleDateString() + '</p>';
    }
    $('#tf').onsubmit = function (e) { e.preventDefault(); show(); };
    if (pre) show();
  }
  function renderCategories() {
    setTitle('Categories');
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Categories</span></div><div class="panel catgrid" style="overflow:hidden">' +
      db.categories.map(function (c) { var n = db.products.filter(function (p) { return p.category === c.id; }).length; return '<a class="cat" href="#c/' + c.id + '" style="--c:' + (c.icon || '#0b2a6f') + '"><span class="ci">' + catIcon(c) + '</span>' + esc(c.name) + '<small style="color:var(--muted)">' + n + ' items</small></a>'; }).join('') + '</div></div>';
  }
  function renderChinaDirect() {
    setTitle('How China Direct works');
    var steps = (db.settings.chinaSteps || []).map(function (x) { return [esc(x.title), esc(x.text)]; });
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>How China Direct works</span></div>' +
      '<div class="cd-hero">' + stageHTML('stage2') + '</div>' +
      '<section class="sec"><div class="sec-head"><h2>From the factory to your door in 5 steps</h2></div><div class="steps">' + steps.map(function (s, i) { return '<div class="panel step reveal" style="animation-delay:' + i * .08 + 's"><div class="n">' + (i + 1) + '</div><h4>' + s[0] + '</h4><p>' + s[1] + '</p></div>'; }).join('') + '</div></section>' +
      faq() + rail('Shop China Direct', '#col/china-direct', db.products.filter(function (p) { return p.origin === 'china'; }).slice(0, 12)) + '</div>';
    $('.cd-hero .stage').style.minHeight = '480px';
    mountGlobe('stage2');
  }
  function faq() {
    var q = (db.settings.faq || []).map(function (x) { return [esc(x.q), esc(x.a)]; }); if (!q.length) return '';
    return '<section class="sec"><div class="sec-head"><h2>Questions &amp; answers</h2></div><div class="panel faq">' + q.map(function (x) { return '<details><summary>' + x[0] + '</summary><p>' + x[1] + '</p></details>'; }).join('') + '</div></section>';
  }
  function renderHelp() {
    setTitle('Help');
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Help &amp; Support</span></div>' + faq() +
      '<div class="panel side-box" style="margin-top:12px"><h4>Contact</h4><div class="side-row">' + I.pin + '<div><b>' + esc(db.settings.address) + '</b></div></div><div class="side-row">' + I.cash + '<div><b>' + esc(db.settings.phone) + '</b><small>' + esc(db.settings.email) + '</small></div></div></div></div>';
  }

  /* ---------------- global clicks ---------------- */
  document.addEventListener('click', function (e) {
    var w = e.target.closest('[data-wish]');
    if (w) {
      e.preventDefault();
      var list = SCG.getWish(), id = w.dataset.wish, i = list.indexOf(id);
      if (i > -1) list.splice(i, 1); else list.push(id);
      SCG.saveWish(list); updateCounts();
      $$('[data-wish="' + id + '"]').forEach(function (b) { b.classList.toggle('on', i < 0); });
      toast(i < 0 ? '♥ Saved to wishlist' : 'Removed from wishlist');
      return;
    }
    var a = e.target.closest('[data-add]');
    if (a) { e.preventDefault(); addToCart(a.dataset.add); }
  });

  /* ---------------- router ---------------- */
  function route() {
    if (globe) { globe.destroy(); globe = null; }
    app.onclick = null; app.onchange = null;
    if (window.__closeAll) window.__closeAll();
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var parts = h.split('/'), k = parts[0], v = parts[1] || '', x = parts[2] || '';
    var alias = { category: 'c', collection: 'col', product: 'p' }; k = alias[k] || k;
    $$('.navbar a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + h); });
    $$('.bottom-nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.bn === (k || 'home')); });
    if (k === 'p') renderPDP(v);
    else if (k === 'c' || k === 'col' || k === 'flash' || k === 'search' || k === 'shop') renderListing(k, v, x);
    else if (k === 'cart') renderCart();
    else if (k === 'checkout') renderCheckout();
    else if (k === 'wishlist') renderWishlist();
    else if (k === 'track') renderTrack(v);
    else if (k === 'categories') renderCategories();
    else if (k === 'china-direct') renderChinaDirect();
    else if (k === 'help') renderHelp();
    else renderHome();
    if (k !== 'p') scrollTo(0, 0);
  }

  window.addEventListener('storage', function (e) {
    if (e.key === SCG.keys.DB_KEY) location.reload();
    if (e.key === SCG.keys.CART_KEY || e.key === SCG.keys.WISH_KEY) updateCounts();
  });

  renderChrome();
  bindChrome();
  window.addEventListener('hashchange', route);
  route();
})();
