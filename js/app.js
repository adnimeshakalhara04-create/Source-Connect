/* =========================================================
   Source Connect Global — Marketplace storefront app
   ========================================================= */
SCG.whenReady(function () {   // waits for the server's catalogue in API mode (immediately in demo mode)
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
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/></svg>'
  };

  /* ---------------- helpers ---------------- */
  var tt;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2400); }
  function stars(r) {
    var out = '<span class="stars" aria-label="' + r + ' out of 5">';
    for (var i = 1; i <= 5; i++) out += I.star.replace('<svg', '<svg class="' + (r >= i - .25 ? '' : 'off') + '"');
    return out + '</span>';
  }
  function ratingLine(p) { return p.reviews ? stars(p.rating) + '<span>(' + p.reviews + ')</span>' : '<span>No ratings yet</span>'; }
  function originTag(p) {
    var o = SCG.originInfo(p);
    return o.local ? '<span class="origin local">' + I.truck + 'Ships from Colombo</span>' : '<span class="origin">' + I.plane + esc(o.label) + '</span>';
  }
  function codeBadge(code) { return '<span class="cc">' + esc(code || '') + '</span>'; }
  function activeOrigins() { return SCG.origins().filter(function (o) { return o.on; }); }
  function visual(p, color) { return SCG.productVisual(p, color); }
  function catIcon(c) {
    if (c.image) return '<img src="' + SCG.imgSrc(c.image) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
    var sample = db.products.filter(function (p) { return p.category === c.id; })[0];
    return SCG.productSVG(c.shape, c.icon || (sample && sample.color) || '#0b2a6f', 'solid', '#f3f4f6');
  }
  function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n); }
  function sortNewest(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }
  function setTitle(t) { document.title = t ? t + ' | Source Connect Global' : 'Source Connect Global'; }

  /* ---------------- product card ---------------- */
  function card(p, opts) {
    opts = opts || {};
    var off = SCG.discount(p), wish = SCG.getWish().indexOf(p.id) > -1, imgs = SCG.productImages(p);
    var soldPct = Math.min(96, 30 + (p.sold % 60));
    return '<article class="card" data-ed="product" data-id="' + p.id + '" style="--c:' + p.color + '">' +
      '<a class="media' + (imgs[1] ? ' has-alt' : '') + '" href="#p/' + p.id + '" aria-label="' + esc(p.name) + '">' + visual(p) + (imgs[1] ? '<img class="alt" src="' + SCG.imgSrc(imgs[1]) + '" alt="" loading="lazy">' : '') +
      (off ? '<span class="tag-off">-' + off + '%</span>' : (p.badge === 'New' ? '<span class="tag-new">NEW</span>' : '')) + '</a>' +
      '<button class="heart' + (wish ? ' on' : '') + '" data-wish="' + p.id + '" aria-label="Add to wishlist">' + I.heart + '</button>' +
      '<div class="info"><a class="title" href="#p/' + p.id + '">' + esc(p.name) + '</a>' +
      '<div class="price">' + money(p.price) + '</div>' +
      '<div class="was">' + (p.comparePrice ? '<s>' + money(p.comparePrice) + '</s><b>-' + off + '%</b>' : '') + '</div>' +
      (opts.flash
        ? '<div class="soldbar"><i style="width:' + soldPct + '%"></i><span>' + fmtCount(p.sold) + ' sold</span></div>'
        : '<div class="meta">' + ratingLine(p) + '</div>' + originTag(p)) +
      (opts.add ? '<div class="add-mini">' + (p.stock > 0 ? '<button data-add="' + p.id + '">Add to Cart</button>' : '<button disabled>Out of stock</button>') + '</div>' : '') +
      '</div></article>';
  }

  /* ---------------- chrome ---------------- */
  function catListHTML() {
    return '<div class="catlist">' + db.categories.map(function (c) {
      return '<a href="#c/' + c.id + '" data-ed="category" data-id="' + c.id + '"><span class="ci" style="background:' + SCG.shade(c.icon || '#0b2a6f', 190) + '">' + catIcon(c) + '</span>' + esc(c.name) + '</a>';
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
      '<a href="#track">Track My Order</a><a href="#china-direct">How Importing Works</a></div>';
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
    return '<div class="stage" id="' + id + '" data-ed="hero"><canvas aria-label="Animated globe showing shipments from abroad to Sri Lanka" role="img"></canvas>' +
      '<div class="stage-copy"><span class="chip"><i></i><span class="flag" data-from>World</span>' + '→' + '<span class="flag">Sri Lanka</span></span>' +
      '<h1>' + lines.map(function (l) { return '<span class="ln"><span>' + esc(l) + '</span></span>'; }).join('') + '</h1>' +
      '<p>' + esc(s.heroSubtitle || '') + '</p>' +
      '<div class="cta-row"><a class="btn" href="#col/global-imports">' + I.plane + 'Shop Imports</a><a class="btn ghost" href="#china-direct">How it works</a></div>' +
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
      onCountry: function (id, name) { var f = $('[data-from]', st); if (f) { f.style.opacity = 0; setTimeout(function () { f.textContent = name; f.style.opacity = 1; }, 250); } },
      onArrive: function (n, origin) {
        if (live && !isNaN(base)) live.textContent = (base + n).toLocaleString('en-US');
        $('span', toastEl).innerHTML = '<b>Route:</b> ' + esc(origin.name) + ', ' + esc(origin.countryName) + ' → Colombo';
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
    var promoHTML = function (h, i) {
      return '<a class="promo" data-ed="banner" data-i="' + i + '" href="' + esc(h.link || '#shop') + '" style="--c:' + esc(h.color) + '"><small>' + esc(h.eyebrow) + '</small><b>' + esc(h.title) + '</b><span>' + esc(h.subtitle) + '</span><em>' + esc(h.cta || 'Shop now') + ' →</em>' +
        '<div class="art">' + (h.image ? '<img src="' + SCG.imgSrc(h.image) + '" alt="">' : SCG.productSVG(h.shape, '#ffffff', 'solid', h.color)) + '</div></a>';
    };
    var parts = {
      services: function () {
        var list = s.services || []; if (!list.length) return '';
        return '<section class="panel sec services" data-ed="services" style="--n:' + Math.min(8, list.length) + '">' + list.map(function (v) { return '<a class="svc" href="' + esc(v.link || '#') + '"><span class="ic" style="--c:' + esc(v.color || '#0b2a6f') + '">' + svcIcon(v.icon) + '</span>' + esc(v.label) + '</a>'; }).join('') + '</section>';
      },
      flash: function () {
        if (!flash.length) return '';
        return '<section class="sec" data-ed="flash"><div class="sec-head"><h2>' + esc(s.flashTitle || 'Flash Sale') + '</h2></div><div class="panel">' +
          '<div class="flash-head"><span class="on-sale">' + I.bolt + 'On Sale Now</span>' + cdHTML() + '<a class="more" href="#flash" style="color:var(--red);font-weight:700;font-size:13px">SHOP ALL PRODUCTS →</a></div>' +
          '<div class="rail">' + flash.slice(0, 12).map(function (p) { return card(p, { flash: true }); }).join('') + '</div></div></section>';
      },
      categories: function () {
        return '<section class="sec"><div class="sec-head"><h2>Categories</h2><a class="more" href="#categories">View all</a></div>' +
          '<div class="panel catgrid" style="overflow:hidden">' + db.categories.map(function (c) { return '<a class="cat" data-ed="category" data-id="' + c.id + '" href="#c/' + c.id + '" style="--c:' + (c.icon || '#0b2a6f') + '"><span class="ci">' + catIcon(c) + '</span>' + esc(c.name) + '</a>'; }).join('') + '</div></section>';
      },
      banners: function () {
        if (!banners.length) return '';
        return '<section class="sec banners" style="--n:' + Math.min(3, banners.length) + '">' + banners.slice(0, 6).map(function (h, j) {
          var key = String(h.link || '').split('/')[1] || '';
          var items = db.products.filter(function (p) { return p.category === key || (p.collections || []).indexOf(key) > -1; }).slice(0, 2);
          if (!items.length) items = db.products.filter(function (p) { return p.shape === h.shape; }).slice(0, 2);
          return '<a class="banner" data-ed="banner" data-i="' + (j + 2) + '" href="' + esc(h.link || '#shop') + '" style="--c:' + esc(h.color) + '"><b>' + esc(h.title) + '</b><span>' + esc(h.subtitle || '') + '</span>' +
            '<div class="stack">' + (h.image ? '<div><img src="' + SCG.imgSrc(h.image) + '" alt="" style="border-radius:8px;height:100%;object-fit:cover"></div>' : items.map(function (p) { return '<div>' + visual(p) + '</div>'; }).join('')) + '</div></a>';
        }).join('') + '</section>';
      },
      countries: function (sec) {
        var list = activeOrigins(); if (!list.length) return '';
        return '<section class="sec" data-ed="origins"><div class="sec-head"><h2>' + esc(sec.title || 'Shop by Country') + '</h2><a class="more" href="#china-direct">How importing works</a></div><div class="countries">' +
          list.map(function (o) {
            var n = db.products.filter(function (p) { return p.origin === o.id; }).length;
            return '<a class="country" href="#from/' + o.id + '">' + codeBadge(o.code) + '<b>' + esc(o.name) + '</b><small>' + n + ' products · ' + esc(o.days) + ' days</small></a>';
          }).join('') +
          '<a class="country local" href="#from/local">' + codeBadge('LK') + '<b>Colombo stock</b><small>' + db.products.filter(function (p) { return !p.origin || p.origin === 'local'; }).length + ' products · ' + esc(s.localDays) + ' days</small></a></div></section>';
      },
      electronics: function (sec) { return rail(sec.title || 'Electronics', '#col/electronics', db.products.filter(function (p) { return (p.collections || []).indexOf('electronics') > -1; }).sort(function (a, b) { return b.sold - a.sold; }).slice(0, 12), 'data-ed="collection" data-id="electronics"'); },
      collections: function () {
        return db.collections.filter(function (c) { return c.homeRow; }).map(function (c) {
          var list = SCG.collectionProducts(c).slice(0, 12);
          return list.length ? rail(c.name, '#col/' + c.id, list, 'data-ed="collection" data-id="' + c.id + '"') : '';
        }).join('');
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
  function rail(title, link, list, ed) {
    return '<section class="sec"' + (ed ? ' ' + ed : '') + '><div class="sec-head"><h2>' + esc(title) + '</h2><a class="more" href="' + link + '">Shop more</a></div><div class="panel"><div class="rail">' + list.map(function (p) { return card(p); }).join('') + '</div></div></section>';
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
    var title = 'All Products', sub = 'Everything we sell, in one place.', color = '#0b2a6f', art = 'tshirt', artImg = '', cover = '';
    var st = { cats: [], min: '', max: '', rating: 0, origins: [], sale: false, sort: 'pop', q: '', coll: '', limit: 30 };
    if (kind === 'c') { var c = SCG.categoryById(val); if (c) { title = c.name; sub = c.tagline; color = c.icon || color; art = c.shape; artImg = c.image || ''; st.cats = [c.id]; } }
    if (kind === 'col') { var co = SCG.collectionById(val); if (co) { title = co.name; sub = co.description; color = co.accent; art = 'bag'; cover = co.image || ''; st.coll = co.id; st.sort = 'rec'; } }
    if (kind === 'flash') { title = db.settings.flashTitle || 'Flash Sale'; sub = flashOn() ? 'Huge discounts for a limited time.' : 'This flash sale has ended. Check back soon for new deals.'; color = '#d7141a'; art = 'sneaker'; st.sale = true; st.flashOnly = true; st.sort = 'off'; }
    if (kind === 'from') { var oi = val === 'local' ? { name: 'Colombo stock', days: db.settings.localDays, local: true } : SCG.originById(val); if (oi) { title = oi.local ? 'Ships from Colombo' : 'Imported from ' + oi.name; sub = 'Delivered to your door in ' + oi.days + ' days.'; color = '#0f766e'; art = 'bag'; st.origins = [val]; } }
    if (kind === 'search') { st.q = val; title = 'Results for “' + val + '”'; sub = ''; if (extra) st.cats = [extra]; }
    setTitle(kind === 'search' ? 'Search' : title);

    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>' + esc(title) + '</span></div>' +
      (kind !== 'search' ? '<div class="cat-hero reveal" ' + ({ c: 'data-ed="category" data-id="' + esc(val) + '"', col: 'data-ed="collection" data-id="' + esc(val) + '"', flash: 'data-ed="flash"', from: 'data-ed="origins"', shop: '' }[kind] || '') + ' style="--c:' + color + (cover ? ';--cover:url(' + SCG.imgSrc(String(cover).replace(/[()'"\\\s]/g, encodeURIComponent)) + ')' : '') + '"' + (cover ? ' data-cover' : '') + '><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p>' + (kind === 'flash' && flashOn() ? '<p style="margin-top:8px">' + cdHTML() + '</p>' : '') + (cover ? '' : '<div class="art' + (artImg ? ' photo' : '') + '">' + (artImg ? '<img src="' + SCG.imgSrc(artImg) + '" alt="">' : SCG.productSVG(art, '#ffffff', 'solid', color)) + '</div>') + '</div>' : '') +
      '<div class="listing"><aside class="panel filters" id="filters">' +
        '<div class="grp"><h4>Category</h4>' + db.categories.map(function (c) { return '<label><input type="checkbox" name="fc" value="' + c.id + '"' + (st.cats.indexOf(c.id) > -1 ? ' checked' : '') + '>' + esc(c.name) + '</label>'; }).join('') + '</div>' +
        '<div class="grp"><h4>Price (Rs.)</h4><div class="price-row"><input id="fmin" type="number" min="0" placeholder="Min" aria-label="Minimum price"><span aria-hidden="true">–</span><input id="fmax" type="number" min="0" placeholder="Max" aria-label="Maximum price"></div></div>' +
        '<div class="grp"><h4>Rating</h4>' + [0, 4.5, 4, 3.5].map(function (r) { return '<label><input type="radio" name="fr" value="' + r + '"' + (r === 0 ? ' checked' : '') + '>' + (r ? stars(r) + ' ' + r + ' &amp; up' : 'Any rating') + '</label>'; }).join('') + '</div>' +
        '<div class="grp"><h4>Shipped from</h4>' + activeOrigins().map(function (o) { return '<label><input type="checkbox" name="fo" value="' + o.id + '"' + (st.origins.indexOf(o.id) > -1 ? ' checked' : '') + '>' + esc(o.name) + ' (' + esc(o.days) + ' days)</label>'; }).join('') + '<label><input type="checkbox" name="fo" value="local"' + (st.origins.indexOf('local') > -1 ? ' checked' : '') + '>Colombo stock (' + esc(db.settings.localDays) + ' days)</label></div>' +
        '<div class="grp"><h4>Offers</h4><label><input type="checkbox" id="fsale"' + (st.sale ? ' checked' : '') + '>On discount only</label></div>' +
        '<button class="btn full filter-btn" id="fDone">Show results</button>' +
      '</aside><div>' +
        '<div class="panel list-top"><button class="btn line filter-btn" id="fOpen" style="padding:8px 12px">' + I.filter + 'Filter</button><span class="n" id="count"></span>' +
        '<select id="fsort" aria-label="Sort by">' + (st.coll ? '<option value="rec">Recommended</option>' : '') + '<option value="pop">Best match</option><option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="off">Biggest discount</option><option value="rating">Top rated</option></select></div>' +
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
        if (st.origins.length && st.origins.indexOf(p.origin || 'local') < 0) return false;
        if (st.sale && !p.comparePrice) return false;
        if (q) { var c = SCG.categoryById(p.category); if ((p.name + ' ' + p.brand + ' ' + (c ? c.name : '')).toLowerCase().indexOf(q) < 0) return false; }
        return true;
      });
      var recOrder = st.coll ? SCG.collectionProducts(st.coll).map(function (x) { return x.id; }) : [];
      var srt = { rec: function (a, b) { return recOrder.indexOf(a.id) - recOrder.indexOf(b.id); }, pop: function (a, b) { return b.sold - a.sold; }, new: sortNewest, low: function (a, b) { return a.price - b.price; }, high: function (a, b) { return b.price - a.price; }, off: function (a, b) { return SCG.discount(b) - SCG.discount(a); }, rating: function (a, b) { return b.rating - a.rating; } }[st.sort];
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
    var cat = SCG.categoryById(p.category), off = SCG.discount(p), vars = variants(p), imgs = SCG.productImages(p), oi = SCG.originInfo(p);
    var st = { color: vars[0], size: (p.sizes || [])[Math.min(1, (p.sizes || []).length - 1)] || '', qty: 1 };
    var related = db.products.filter(function (x) { return x.category === p.category && x.id !== p.id; }).slice(0, 12);
    var dist = [.62, .22, .09, .04, .03].map(function (k, i) { return Math.round(p.reviews * (p.rating >= 4.5 ? k : [.4, .3, .17, .08, .05][i])); });
    var s = db.settings;

    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<a href="#c/' + p.category + '">' + esc(cat ? cat.name : '') + '</a>›<span>' + esc(p.name) + '</span></div>' +
      '<div class="pdp"><div><div class="panel pdp-main" data-ed="product" data-id="' + p.id + '">' +
        '<div class="gallery"><div class="big" id="big" style="--c:' + p.color + '">' + visual(p) + '</div>' +
          '<div class="thumbs" id="thumbs">' + (imgs.length > 1 ? imgs.map(function (src, i) { return '<button class="' + (i ? '' : 'on') + '" data-img="' + i + '" aria-label="Photo ' + (i + 1) + '"><img src="' + SCG.imgSrc(src) + '" alt=""></button>'; }).join('') : imgs.length ? '' : vars.map(function (c, i) { return '<button class="' + (i ? '' : 'on') + '" data-c="' + c + '" aria-label="Colour ' + (i + 1) + '">' + visual(p, c) + '</button>'; }).join('')) + '</div></div>' +
        '<div><h1>' + esc(p.name) + '</h1>' +
          '<div class="sub">' + (p.reviews ? stars(p.rating) + '<span>' + p.rating + ' · ' + p.reviews + ' ratings</span>' : '<span>No ratings yet</span>') + (p.sold ? '<span>' + fmtCount(p.sold) + ' sold</span>' : '') + (p.brand ? '<span>Brand: <a href="#search/' + encodeURIComponent(p.brand) + '">' + esc(p.brand) + '</a></span>' : '') + '</div>' +
          (isFlash(p) ? '<div class="flash-strip"><span>⚡ ' + esc(db.settings.flashTitle || 'Flash Sale') + '</span>' + cdHTML() + '</div>' : '') +
          '<div class="price-box"><div class="now">' + money(p.price) + '</div>' + (p.comparePrice ? '<div class="old"><s>' + money(p.comparePrice) + '</s><b>-' + off + '%</b></div>' : '') + '</div>' +
          (vars.length > 1 ? '<div class="opt"><span>Colour</span><div class="swatches" id="sw">' + vars.map(function (c, i) { return '<button class="' + (i ? '' : 'on') + '" data-c="' + c + '" aria-label="Colour ' + (i + 1) + '">' + visual(p, c) + '</button>'; }).join('') + '</div></div>' : '') +
          ((p.sizes || []).length ? '<div class="opt"><span>Size</span><div class="sizes" id="sz">' + p.sizes.map(function (z) { return '<button class="' + (z === st.size ? 'on' : '') + '" data-s="' + esc(z) + '">' + esc(z) + '</button>'; }).join('') + '</div></div>' : '') +
          '<div class="opt"><span>Quantity</span><div><div class="qty"><button data-q="-1" aria-label="Less">−</button><span id="qv">1</span><button data-q="1" aria-label="More">+</button></div> <small style="color:' + (p.stock > 0 ? 'var(--muted)' : 'var(--red)') + ';margin-left:8px">' + (p.stock > 0 ? p.stock + ' available' : 'Out of stock') + '</small></div></div>' +
          '<div class="buy-row"><button class="btn navy" id="buyNow"' + (p.stock > 0 ? '' : ' disabled') + '>' + (p.stock > 0 ? 'Buy Now' : 'Out of stock') + '</button><button class="btn" id="addCart"' + (p.stock > 0 ? '' : ' disabled') + '>Add to Cart</button><button class="btn line heart-btn" data-wish="' + p.id + '" aria-label="Wishlist" style="flex:0 0 auto;padding:14px">' + I.heart + '</button></div>' +
        '</div></div>' +
        '<div class="panel tabs-box"><nav id="ptabs"><button class="on" data-t="d">Description</button><button data-t="s">Specifications</button><button data-t="r">Ratings</button></nav><div class="body" id="pbody"></div></div>' +
      '</div>' +
      '<aside><div class="panel side-box"><h4>Delivery</h4>' +
        '<div class="side-row">' + I.pin + '<div><b>' + esc(s.address || 'Sri Lanka') + '</b><small>Islandwide delivery</small></div></div>' +
        (!oi.local
          ? '<div class="side-row">' + I.plane + '<div><b>' + esc(oi.label) + ' · ' + esc(oi.days) + ' days</b><small>Shipped from our partners in ' + esc(oi.name) + '</small></div></div>'
          : '<div class="side-row">' + I.truck + '<div><b>Standard · ' + esc(s.localDays) + ' days</b><small>In stock at our Colombo warehouse</small></div></div>') +
        '<div class="side-row">' + I.cash + '<div><b>' + (s.payCOD ? 'Cash on Delivery available' : 'Secure payment') + '</b><small>' + (s.freeShipping ? 'Free delivery over ' + money(s.freeShipping) : '') + '</small></div></div>' +
        '<h4 style="margin-top:14px">Service</h4>' +
        '<div class="side-row">' + I.swap + '<div><b>' + esc(s.returnDays) + '-day easy returns</b><small>Change of mind is not applicable</small></div></div>' +
        '<div class="side-row">' + I.shield + '<div><b>Quality checked</b><small>' + (oi.local ? 'Checked at our Colombo warehouse' : 'Inspected before it leaves ' + esc(oi.name)) + '</small></div></div>' +
        (!oi.local ? '<div class="route-mini"><b>Shipping route</b><div class="line">' + codeBadge(oi.code) + ' ' + esc(oi.name) + '<i></i>Colombo ' + codeBadge('LK') + '</div></div>' : '') +
      '</div><div class="panel side-box" style="margin-top:12px"><h4>Sold by</h4><div class="seller"><img src="assets/logo-sm.jpg?v=1829ee97" alt=""><div><b>Source Connect Global</b><small style="display:block;color:var(--muted)">Official store</small></div></div>' +
        '<div class="seller-stats">' + (s.sellerStats || []).map(function (x) { return '<div><b>' + esc(x.value) + '</b><small>' + esc(x.label) + '</small></div>'; }).join('') + '</div></div></aside></div>' +
      (related.length ? rail('More from ' + (cat ? cat.name : 'this category'), '#c/' + p.category, related) : '') +
      '</div>';

    function tab(t) {
      $$('#ptabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
      $('#pbody').innerHTML = t === 'd' ? '<p style="margin-top:0">' + esc(p.description) + '</p><ul style="color:var(--muted)"><li>Brand: ' + esc(p.brand) + '</li><li>' + (oi.local ? 'Ships from Colombo (' + esc(oi.days) + ' days)' : 'Imported from ' + esc(oi.name) + ' (' + esc(oi.days) + ' days)') + '</li>' + (s.payCOD ? '<li>Cash on Delivery available islandwide</li>' : '') + '</ul>'
        : t === 's' ? '<table class="spec"><tr><td>Brand</td><td>' + esc(p.brand) + '</td></tr><tr><td>Category</td><td>' + esc(cat ? cat.name : '') + '</td></tr><tr><td>SKU</td><td>' + esc(p.id.toUpperCase()) + '</td></tr>' + ((p.sizes || []).length ? '<tr><td>Sizes</td><td>' + esc(p.sizes.join(', ')) + '</td></tr>' : '') + '<tr><td>Ships from</td><td>' + (oi.local ? 'Colombo stock' : esc(oi.name)) + '</td></tr><tr><td>In stock</td><td>' + p.stock + '</td></tr></table>'
          : !p.reviews ? '<p style="margin:0;color:var(--muted)">No ratings yet. Ratings appear here after customers review this product.</p>' : '<div class="rating-sum"><div><div class="big">' + p.rating + '<small style="font-size:18px;color:var(--muted)">/5</small></div>' + stars(p.rating) + '<div style="color:var(--muted);font-size:12px">' + p.reviews + ' ratings</div></div><div class="rbars">' + dist.map(function (n, i) { return '<div><span>' + (5 - i) + '★</span><i><em style="width:' + (p.reviews ? n / p.reviews * 100 : 0) + '%"></em></i><span>' + n + '</span></div>'; }).join('') + '</div></div>';
    }
    tab('d');
    $('#ptabs').onclick = function (e) { var b = e.target.closest('button'); if (b) tab(b.dataset.t); };
    $('#thumbs').addEventListener('click', function (e) { var b = e.target.closest('[data-img]'); if (!b) return; $('#big').innerHTML = '<img src="' + SCG.imgSrc(imgs[+b.dataset.img]) + '" alt="' + esc(p.name) + '">'; $$('#thumbs button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    function pick(c) { st.color = c; $('#big').innerHTML = visual(p, c); ['#thumbs', '#sw'].forEach(function (s) { if ($(s)) $$('button', $(s)).forEach(function (b) { b.classList.toggle('on', b.dataset.c === c); }); }); }
    // colour buttons only (photo thumbnails have their own handler above)
    ['#thumbs', '#sw'].forEach(function (s) { if ($(s)) $(s).onclick = function (e) { var b = e.target.closest('button[data-c]'); if (b) pick(b.dataset.c); }; });
    if ($('#sz')) $('#sz').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; st.size = b.dataset.s; $$('#sz button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
    $$('[data-q]').forEach(function (b) { b.onclick = function () { st.qty = Math.max(1, Math.min(Math.max(1, p.stock), st.qty + +b.dataset.q)); $('#qv').textContent = st.qty; }; });
    var big = $('#big');
    big.addEventListener('mousemove', function (e) { var r = big.getBoundingClientRect(), el = big.firstElementChild; el.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; el.style.transform = 'scale(1.8)'; });
    big.addEventListener('mouseleave', function () { big.firstElementChild.style.transform = ''; });
    function add() { return addToCart(p.id, st.size, st.qty, st.color) > 0 || inCart(p.id) > 0; }
    $('#addCart').onclick = add;
    $('#buyNow').onclick = function () { if (add()) location.hash = 'cart'; };
    tickCountdowns();
    scrollTo(0, 0);
  }

  /* ---------------- CART ---------------- */
  function inCart(id, cart) { return (cart || SCG.getCart()).reduce(function (s, l) { return s + (l.id === id ? l.qty : 0); }, 0); }
  /** Adds to the cart without ever going over the stock. Returns how many were added. */
  function addToCart(id, size, qty, color) {
    var p = SCG.productById(id); if (!p) return 0;
    var vars = p.variants || [];   // per-size stock from the server (API mode)
    if (size === undefined || size === null) {
      var inStock = vars.filter(function (v) { return v.stock > 0 && v.size; });
      size = inStock.length ? inStock[Math.min(1, inStock.length - 1)].size : ((p.sizes || [])[Math.min(1, (p.sizes || []).length - 1)] || '');
    }
    color = color || p.color; qty = Math.max(1, qty || 1);
    var vs = vars.filter(function (v) { return v.size === (size || ''); })[0];
    var cap = vs ? vs.stock : (p.stock || 0);
    var cart = SCG.getCart(), have = cart.reduce(function (n, l) { return n + (l.id === id && (!vs || (l.size || '') === (size || '')) ? l.qty : 0); }, 0);
    var left = Math.max(0, cap - have);
    if (!left) { toast(cap > 0 ? 'You already have all ' + cap + ' in stock in your cart' : 'Sorry, ' + p.name + (vs && size ? ' (size ' + size + ')' : '') + ' is out of stock'); return 0; }
    var add = Math.min(qty, left);
    var line = cart.filter(function (l) { return l.id === id && l.size === size && l.color === color; })[0];
    if (line) line.qty += add; else cart.push({ id: id, size: size, color: color, qty: add, sel: true });
    if (!SCG.saveCart(cart)) { toast('Could not save your cart. Browser storage is full.'); return 0; }
    updateCounts(true);
    toast(add < qty ? 'Only ' + add + ' more available. Added ' + add + ' to cart.' : '✓ Added to cart: ' + p.name);
    return add;
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
    if (!lines.length) { app.innerHTML = '<div class="wrap"><div class="panel empty" style="margin-top:16px"><h3>Your cart is empty</h3><p>Browse flash deals and imports from around the world to get started.</p><a class="btn" href="#flash">Shop Flash Sale</a></div></div>'; return; }
    var t = totals(lines);
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Cart</span></div><div class="cart-wrap"><div class="panel">' +
      '<div class="cart-row" style="grid-template-columns:24px 1fr auto;padding:12px 14px"><input type="checkbox" id="selAll"' + (lines.every(function (x) { return x.l.sel !== false; }) ? ' checked' : '') + ' aria-label="Select all"><b>Select all (' + lines.length + ')</b><button class="rm" id="delSel" aria-label="Delete selected items">' + I.trash + '</button></div>' +
      lines.map(function (x) {
        return '<div class="cart-row"><input type="checkbox" data-sel="' + x.i + '"' + (x.l.sel !== false ? ' checked' : '') + ' aria-label="Select"><a class="th" href="#p/' + x.p.id + '" style="background:' + SCG.shade(x.l.color || x.p.color, 175) + '">' + visual(x.p, x.l.color) + '</a>' +
          '<div><h4><a href="#p/' + x.p.id + '">' + esc(x.p.name) + '</a></h4><small>' + (x.l.size ? 'Size: ' + esc(x.l.size) + ' · ' : '') + esc(x.p.brand) + '</small><div style="margin-top:6px">' + originTag(x.p) + '</div>' +
          '<div class="qty" style="margin-top:8px"><button data-cq="-1" data-i="' + x.i + '" aria-label="Decrease quantity">−</button><span>' + x.l.qty + '</span><button data-cq="1" data-i="' + x.i + '" aria-label="Increase quantity">+</button></div>' + (inCart(x.p.id) > x.p.stock ? '<div class="stock-warn">' + (x.p.stock > 0 ? 'Only ' + x.p.stock + ' left. Lower the quantity to check out.' : 'Out of stock. Please remove it.') + '</div>' : '') + '</div>' +
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
      if (b.dataset.cq) {
        var l = cart[+b.dataset.i], pr = SCG.productById(l.id), room = pr ? pr.stock - inCart(l.id, cart) : 0;
        if (+b.dataset.cq > 0 && room <= 0) { toast('Only ' + (pr ? pr.stock : 0) + ' in stock'); return; }
        l.qty = Math.max(1, l.qty + +b.dataset.cq);
      }
      else if (b.dataset.rm) cart.splice(+b.dataset.rm, 1);
      else if (b.id === 'delSel') cart = cart.filter(function (l) { return l.sel === false; });
      else return;
      SCG.saveCart(cart); updateCounts(); renderCart();
    };
  }

  function renderCheckout() {
    if (SCG.API) return renderCheckoutApi();
    setTitle('Checkout');
    var lines = cartLines().filter(function (x) { return x.l.sel !== false; });
    if (!lines.length) { location.hash = 'cart'; return; }
    var t = totals(lines), s = db.settings, imported = {};
    lines.forEach(function (x) { var o = SCG.originInfo(x.p); if (!o.local) imported[o.name] = o.days; });
    var impNames = Object.keys(imported);
    var districts = ['Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya', 'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla', 'Moneragala', 'Ratnapura', 'Kegalle'];
    var prof = SCG.getProfile();
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<a href="#cart">Cart</a>›<span>Checkout</span></div><div class="cart-wrap">' +
      '<form class="panel form" id="co">' +
      (prof ? '<div class="acct-note full">' + avatar(prof) + '<span>Ordering as <b>' + esc(prof.name) + '</b> · ' + esc(prof.phone) + '<br><small>Your saved details are filled in. Change anything below and we will update your profile.</small></span><a href="#account" class="link-sm">My account</a></div>'
        : '<div class="acct-note full new">' + I.user + '<span><b>First order?</b> We create your Source Connect account from these details, so next time checkout is one click and you can see all your orders.</span></div>') +
      '<h3>Delivery information</h3>' +
      '<label>Full name<input name="name" required autocomplete="name" placeholder="e.g. Nimal Perera"></label>' +
      '<label>Phone number<input name="phone" required pattern="[+]?[0-9][0-9 ]{8,14}" title="Phone number, e.g. 077 123 4567" autocomplete="tel" placeholder="07X XXX XXXX"></label>' +
      '<label class="full">Email (optional, for order updates)<input name="email" type="email" autocomplete="email" placeholder="you@example.com"></label>' +
      '<label class="full">Address<input name="address" required autocomplete="street-address" placeholder="House no, street, area"></label>' +
      '<label>City<input name="city" required placeholder="e.g. Nugegoda"></label>' +
      '<label>District<select name="district">' + districts.map(function (d) { return '<option>' + d + '</option>'; }).join('') + '</select></label>' +
      '<label class="full">Note for delivery (optional)<textarea name="note" rows="2"></textarea></label>' +
      '<h3 style="margin-top:6px">Payment method</h3><div class="pay-opts full">' +
      (s.payCOD !== false ? '<label class="pay-opt"><input type="radio" name="pay" value="Cash on Delivery" required>' + I.cash + '<span><b>Cash on Delivery</b><br><small>Pay when your order arrives</small></span></label>' : '') +
      (s.payBank ? '<label class="pay-opt"><input type="radio" name="pay" value="Bank Transfer" required>' + I.shield + '<span><b>Bank Transfer</b><br><small>Bank details are shown after you place the order</small></span></label>' : '') + '</div>' +
      (impNames.length ? '<p class="full" style="margin:0;font-size:12.5px;color:var(--muted)">' + I.plane.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"') + ' Imported items: ' + impNames.map(function (n) { return esc(n) + ' ' + esc(imported[n]) + ' days'; }).join(', ') + '.</p>' : '') +
      '<button class="btn lg full" style="grid-column:1/-1">Place Order · ' + money(t.total) + '</button></form>' +
      '<aside class="panel summary"><h3>Your order</h3>' + lines.map(function (x) { return '<div class="sum-row" style="gap:10px"><span style="color:var(--text)">' + esc(x.p.name) + ' <small style="color:var(--muted)">×' + x.l.qty + (x.l.size ? ' · ' + esc(x.l.size) : '') + '</small></span><span>' + money(x.p.price * x.l.qty) + '</span></div>'; }).join('') +
      '<div class="sum-row" style="border-top:1px solid var(--line);margin-top:6px;padding-top:10px"><span>Subtotal</span><span>' + money(t.sub) + '</span></div><div class="sum-row"><span>Delivery</span><span>' + (t.ship ? money(t.ship) : 'FREE') + '</span></div>' +
      '<div class="sum-row total"><span>Total</span><span>' + money(t.total) + '</span></div></aside></div></div>';
    var firstPay = $('#co input[name=pay]'); if (firstPay) firstPay.checked = true;
    function coError(msg) { var el = $('#coErr'); if (!el) { el = document.createElement('div'); el.id = 'coErr'; el.className = 'co-err full'; el.setAttribute('role', 'alert'); $('#co').insertBefore(el, $('#co').firstChild); } el.textContent = msg; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (prof) { var E = $('#co').elements; ['name', 'phone', 'email', 'address', 'city', 'district'].forEach(function (k) { if (prof[k]) E[k].value = prof[k]; }); }
    $('#co').onsubmit = function (e) {
      e.preventDefault();
      db = SCG.load();
      var short = lines.filter(function (x) { var pr = SCG.productById(x.p.id); return !pr || inCart(x.p.id, lines.map(function (y) { return y.l; })) > pr.stock; });
      if (short.length) { coError('Not enough stock for: ' + short.map(function (x) { return x.p.name; }).join(', ') + '. Please update your cart.'); return; }
      var fd = new FormData(e.target), orders = SCG.getOrders();
      var blank = ['name', 'phone', 'address', 'city'].filter(function (k) { var el = e.target.elements[k]; return el && el.required && !String(fd.get(k) || '').trim(); })[0];
      if (blank) { coError('Please fill in your ' + blank + '.'); e.target.elements[blank].value = ''; e.target.elements[blank].focus(); return; }
      ['name', 'phone', 'email', 'address', 'city', 'note'].forEach(function (k) { if (fd.has(k)) fd.set(k, String(fd.get(k) || '').trim()); });
      var order = {
        id: 'SCG' + Date.now().toString().slice(-7), date: new Date().toISOString(), status: 'Pending', payment: fd.get('pay') || 'Cash on Delivery',
        customer: { name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email') || '', address: fd.get('address') + ', ' + fd.get('city') + ', ' + fd.get('district'), note: fd.get('note') },
        items: lines.map(function (x) { return { id: x.p.id, name: x.p.name, size: x.l.size, color: x.l.color, qty: x.l.qty, price: x.p.price, origin: x.p.origin }; }),
        subtotal: t.sub, shipping: t.ship, total: t.total
      };
      // create the customer's profile on the first order, or refresh it with the latest details (saved after the order succeeds)
      var p0 = SCG.getProfile(), isNewProfile = !p0 || SCG.phoneKey(p0.phone) !== SCG.phoneKey(fd.get('phone'));
      var profile = isNewProfile ? { id: SCG.uid('cust'), createdAt: new Date().toISOString(), source: 'first order' } : p0;
      ['name', 'phone', 'email', 'address', 'city', 'district'].forEach(function (k) { var v = String(fd.get(k) || '').trim(); if (v || k !== 'email') profile[k] = v; });
      profile.lastOrderAt = order.date;
      order.customer.profileId = profile.id;
      orders.unshift(order);
      if (!SCG.saveOrders(orders)) { coError('Sorry, your order could not be saved because this browser’s storage is full. Nothing was charged. Please call us on ' + s.phone + ' to order.'); return; }
      SCG.saveProfile(profile); updateAccount();
      lines.forEach(function (x) { x.p.stock = Math.max(0, (x.p.stock || 0) - x.l.qty); x.p.sold = (x.p.sold || 0) + x.l.qty; }); SCG.save();
      SCG.saveCart(SCG.getCart().filter(function (l) { return l.sel === false; })); updateCounts();
      app.innerHTML = '<div class="wrap"><div class="panel success" style="margin-top:16px"><div class="tick">' + I.check + '</div><h2 style="margin:0 0 6px">Thank you! Your order is placed.</h2>' +
        '<p>Order number <b>' + order.id + '</b> · Total <b>' + money(order.total) + '</b></p><p style="color:var(--muted)">We will call ' + esc(order.customer.phone) + ' to confirm. Keep your order number to track it.</p>' +
        (order.payment === 'Bank Transfer' && s.bankDetails ? '<p class="free-note need" style="max-width:520px;margin:12px auto"><b>Bank transfer details:</b><br>' + esc(s.bankDetails) + '<br>Use <b>' + order.id + '</b> as the reference.</p>' : '') +
        (isNewProfile ? '<div class="acct-created">' + avatar(profile) + '<div><b>Your Source Connect account is ready, ' + esc(profile.name.split(' ')[0]) + '!</b><br><small>We saved your details from this order. Next time checkout is filled in for you, and all your orders are in My Account.</small></div></div>' : '') +
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap"><a class="btn navy" href="#track/' + order.id + '">Track order</a><a class="btn" href="#account">My account</a><a class="btn line" href="#">Continue shopping</a></div></div></div>';
      scrollTo(0, 0);
    };
  }

  /* =========================================================
     Server (API) mode pages: real accounts, orders and payments
     Same look as the demo pages; the server decides prices, stock and payment state.
     ========================================================= */
  var DISTRICTS = ['Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya', 'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla', 'Moneragala', 'Ratnapura', 'Kegalle'];
  var ST_LABEL = { pending_payment: 'Waiting for payment', awaiting_bank_transfer: 'Waiting for your bank transfer', confirmed: 'Confirmed', processing: 'Packing', shipped: 'Shipped', arrived_lk: 'Arrived in Sri Lanka', delivered: 'Delivered', cancelled: 'Cancelled', expired: 'Payment time ran out', refunded: 'Refunded' };
  var PAY_LABEL = { pending: 'Payment pending', paid: 'Paid', cod_pending: 'Pay on delivery', cod_collected: 'Paid (cash on delivery)', failed: 'Payment failed', cancelled: 'Payment cancelled', chargeback: 'Payment disputed', refunded: 'Refunded', partially_refunded: 'Partly refunded', unpaid: 'Not paid' };
  var ST_IDX = { pending_payment: 0, awaiting_bank_transfer: 0, confirmed: 1, processing: 1, shipped: 2, arrived_lk: 3, delivered: 4 };
  var PAY_VALUE = { 'Cash on Delivery': 'cod', 'Bank Transfer': 'bank_transfer', 'Card': 'payhere' };
  function apiItems(lines) { return lines.map(function (x) { return { id: x.p.id, size: x.l.size || '', qty: x.l.qty }; }); }
  function newKey() { var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return 'co-' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  function orderStatusHTML(o) {
    var closed = { cancelled: 1, expired: 1, refunded: 1 }[o.status];
    var idx = ST_IDX[o.status] === undefined ? -1 : ST_IDX[o.status];
    return (closed ? '<p style="color:var(--red)"><b>' + esc(ST_LABEL[o.status] || o.status) + '.</b></p>' :
        '<div class="track-steps">' + STEPS.map(function (s, i) { return '<div class="' + (i <= idx ? 'done' : '') + '">' + s + '</div>'; }).join('') + '</div>') +
      '<p style="font-size:13px;color:var(--muted)"><b>' + esc(ST_LABEL[o.status] || o.status) + '</b> · ' + esc(PAY_LABEL[o.paymentStatus] || o.paymentStatus) + ' · ' +
        o.items.reduce(function (n, it) { return n + it.qty; }, 0) + ' item(s) · ' + money(o.total) + ' · placed ' + new Date(o.placedAt).toLocaleDateString() + '</p>' +
      (o.bankInstructions ? '<p class="free-note need"><b>Bank transfer details:</b><br>' + esc(o.bankInstructions) + '<br>Use <b>' + esc(o.number) + '</b> as the reference. We confirm the order when the money reaches our account.</p>' : '') +
      (o.shipments && o.shipments.length ? '<p style="font-size:13px">' + o.shipments.map(function (s) { return esc(s.carrier) + (s.trackingNumber ? ' · tracking <b>' + esc(s.trackingNumber) + '</b>' : ''); }).join('<br>') + '</p>' : '');
  }

  function renderCheckoutApi() {
    setTitle('Checkout');
    var lines = cartLines().filter(function (x) { return x.l.sel !== false; });
    if (!lines.length) { location.hash = 'cart'; return; }
    var s = db.settings, me = SCG.customer, saved = SCG.getProfile(), key = newKey(), coupon = '', quote = null;
    var pre = me ? { name: me.name, phone: me.phone, email: me.email, address: me.address && me.address.line1, city: me.address && me.address.city, district: me.address && me.address.district } : saved;
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<a href="#cart">Cart</a>›<span>Checkout</span></div><div class="cart-wrap">' +
      '<form class="panel form" id="co">' +
      (me ? '<div class="acct-note full">' + avatar(me) + '<span>Signed in as <b>' + esc(me.name) + '</b><br><small>This order will appear in My Account.</small></span><a href="#account" class="link-sm">My account</a></div>'
        : '<div class="acct-note full new">' + I.user + '<span><b>Checking out as a guest.</b> You get a private tracking link after ordering. <a href="#account">Sign in or create an account</a> to keep all your orders in one place.</span></div>') +
      '<h3>Delivery information</h3>' +
      '<label>Full name<input name="name" required autocomplete="name" maxlength="80" placeholder="e.g. Nimal Perera"></label>' +
      '<label>Phone number<input name="phone" required pattern="[+]?[0-9][0-9 ]{8,14}" title="Phone number, e.g. 077 123 4567" autocomplete="tel" placeholder="07X XXX XXXX"></label>' +
      '<label class="full">Email <span id="emailHint">(optional, for order updates)</span><input name="email" type="email" autocomplete="email" maxlength="200" placeholder="you@example.com"></label>' +
      '<label class="full">Address<input name="address" required autocomplete="street-address" maxlength="200" placeholder="House no, street, area"></label>' +
      '<label>City<input name="city" required maxlength="60" placeholder="e.g. Nugegoda"></label>' +
      '<label>District<select name="district">' + DISTRICTS.map(function (d) { return '<option>' + d + '</option>'; }).join('') + '</select></label>' +
      '<label class="full">Note for delivery (optional)<textarea name="note" rows="2" maxlength="500"></textarea></label>' +
      '<h3 style="margin-top:6px">Payment method</h3><div class="pay-opts full">' +
      (s.payOnline ? '<label class="pay-opt"><input type="radio" name="pay" value="Card" required>' + I.shield + '<span><b>Card / online payment</b><br><small>Visa, Mastercard and more through PayHere</small></span></label>' : '') +
      (s.payCOD ? '<label class="pay-opt"><input type="radio" name="pay" value="Cash on Delivery" required>' + I.cash + '<span><b>Cash on Delivery</b><br><small>Pay when your order arrives</small></span></label>' : '') +
      (s.payBank ? '<label class="pay-opt"><input type="radio" name="pay" value="Bank Transfer" required>' + I.shield + '<span><b>Bank Transfer</b><br><small>Bank details are shown after you place the order</small></span></label>' : '') + '</div>' +
      '<button class="btn lg full" id="placeBtn" style="grid-column:1/-1" disabled>Checking prices…</button></form>' +
      '<aside class="panel summary"><h3>Your order</h3><div id="sumLines"></div>' +
      '<div class="sum-row" style="border-top:1px solid var(--line);margin-top:6px;padding-top:10px"><span>Subtotal</span><span id="sumSub">…</span></div>' +
      '<div class="sum-row" id="sumDiscRow" hidden><span>Promo code</span><span id="sumDisc"></span></div>' +
      '<div class="sum-row"><span>Delivery</span><span id="sumShip">…</span></div>' +
      '<div class="sum-row total"><span>Total</span><span id="sumTotal">…</span></div>' +
      '<form id="cpf" style="display:flex;gap:6px;margin-top:10px"><input name="code" placeholder="Promo code" aria-label="Promo code" maxlength="30" style="flex:1;min-width:0"><button class="btn line" style="padding:8px 12px">Apply</button></form><p id="cpMsg" class="muted" style="font-size:12.5px;margin:6px 0 0"></p>' +
      '</aside></div></div>';
    var F = $('#co'), E = F.elements;
    if (pre) ['name', 'phone', 'email', 'address', 'city', 'district'].forEach(function (k) { if (pre[k] && E[k]) E[k].value = pre[k]; });
    var firstPay = $('#co input[name=pay]'); if (firstPay) firstPay.checked = true;
    function coError(msg) { var el = $('#coErr'); if (!el) { el = document.createElement('div'); el.id = 'coErr'; el.className = 'co-err full'; el.setAttribute('role', 'alert'); F.insertBefore(el, F.firstChild); } el.textContent = msg; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    function payChoice() { var r = $('#co input[name=pay]:checked'); return r ? PAY_VALUE[r.value] : null; }
    function syncEmail() { var card = payChoice() === 'payhere'; E.email.required = card; $('#emailHint').textContent = card ? '(needed for the card receipt)' : '(optional, for order updates)'; }
    F.addEventListener('change', function (e) { if (e.target.name === 'pay') syncEmail(); }); syncEmail();
    function showQuote(q) {
      quote = q;
      $('#sumLines').innerHTML = q.lines.map(function (l) { return '<div class="sum-row" style="gap:10px"><span style="color:var(--text)">' + esc(l.name) + ' <small style="color:var(--muted)">×' + l.qty + (l.size ? ' · ' + esc(l.size) : '') + '</small></span><span>' + money(l.lineTotal) + '</span></div>'; }).join('');
      $('#sumSub').innerHTML = money(q.subtotal); $('#sumShip').innerHTML = q.shipping ? money(q.shipping) : 'FREE'; $('#sumTotal').innerHTML = money(q.total);
      $('#sumDiscRow').hidden = !q.discount; $('#sumDisc').innerHTML = q.discount ? '−' + money(q.discount) : '';
      $('#cpMsg').textContent = q.couponError || (q.coupon ? 'Code ' + q.coupon + ' applied.' : '');
      var b = $('#placeBtn'); b.disabled = !q.lines.length; b.innerHTML = 'Place Order · ' + money(q.total);
      if (q.issues && q.issues.length) coError('Some items changed: ' + q.issues.map(function (i) { var p = SCG.productById(i.id); return (p ? p.name : i.id) + (i.size ? ' (' + i.size + ')' : '') + (i.problem === 'reduced' ? ' — only ' + i.available + ' left' : ' — sold out'); }).join('; ') + '. The total below is for what is available. Go back to your cart to change it.');
    }
    function requote() { return SCG.quote(apiItems(lines), coupon).then(showQuote, function (err) { coError(err.message); }); }
    requote();
    $('#cpf').onsubmit = function (e) { e.preventDefault(); coupon = e.target.elements.code.value.trim(); requote(); };
    F.onsubmit = function (e) {
      e.preventDefault();
      if (!quote) return;
      if (quote.issues && quote.issues.length) { coError('Please update your cart first: some items are no longer available in the quantity you chose.'); return; }
      var blank = ['name', 'phone', 'address', 'city'].filter(function (k) { return !String(E[k].value || '').trim(); })[0];
      if (blank) { coError('Please fill in your ' + blank + '.'); E[blank].value = ''; E[blank].focus(); return; }
      var pay = payChoice(); if (!pay) { coError('Please choose how you want to pay.'); return; }
      var body = { items: apiItems(lines), payment: pay, coupon: coupon || null, expectedTotal: quote.total,
        customer: { name: E.name.value.trim(), phone: E.phone.value.trim(), email: E.email.value.trim(), address: E.address.value.trim(), city: E.city.value.trim(), district: E.district.value, note: E.note.value.trim() } };
      var btn = $('#placeBtn'); btn.disabled = true; btn.textContent = 'Placing your order…';
      SCG.api('POST', '/orders', body, { idempotencyKey: key }).then(function (o) {
        SCG.rememberOrder(o.orderNumber, o.trackingToken);
        SCG.saveProfile({ name: body.customer.name, phone: body.customer.phone, email: body.customer.email, address: body.customer.address, city: body.customer.city, district: body.customer.district, createdAt: new Date().toISOString(), source: 'checkout on this device' });
        updateAccount();
        SCG.saveCart(SCG.getCart().filter(function (l) { return l.sel === false; })); updateCounts();
        SCG.refresh().then(function () { db = SCG.load(); });   // stock numbers on product pages
        if (o.payhere) return goToPayHere(o);
        app.innerHTML = '<div class="wrap"><div class="panel success" style="margin-top:16px"><div class="tick">' + I.check + '</div><h2 style="margin:0 0 6px">Thank you! Your order is placed.</h2>' +
          '<p>Order number <b>' + esc(o.orderNumber) + '</b> · Total <b>' + money(o.total) + '</b></p>' +
          (pay === 'cod' ? '<p style="color:var(--muted)">We will call ' + esc(body.customer.phone) + ' to confirm. Please keep ' + money(o.total) + ' ready when it arrives.</p>' : '') +
          (o.bankInstructions ? '<p class="free-note need" style="max-width:520px;margin:12px auto"><b>Bank transfer details:</b><br>' + esc(o.bankInstructions) + '<br>Use <b>' + esc(o.orderNumber) + '</b> as the reference. We hold your items for 48 hours and confirm when the money arrives.</p>' : '') +
          '<p class="muted" style="font-size:13px">This browser remembers your private tracking link. ' + (body.customer.email ? '' : 'Save your order number to track it from another device.') + '</p>' +
          '<div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap"><a class="btn navy" href="#order/' + esc(o.orderNumber) + '">Track order</a><a class="btn line" href="#">Continue shopping</a></div></div></div>';
        scrollTo(0, 0);
      }, function (err) {
        btn.disabled = false; btn.innerHTML = 'Place Order · ' + money(quote.total);
        if (err.code === 'duplicate_order' && err.data && err.data.details) { location.hash = 'order/' + err.data.details.orderNumber; return; }
        if (err.code === 'stock_changed' || err.code === 'price_changed') { SCG.refresh().then(function () { db = SCG.load(); requote(); }); }
        key = newKey();
        coError(err.message);
      });
    };
  }
  function goToPayHere(o) {
    app.innerHTML = '<div class="wrap"><div class="panel success" style="margin-top:16px"><h2>Taking you to PayHere to pay securely…</h2><p class="muted">Order <b>' + esc(o.orderNumber) + '</b> · ' + money(o.total) + '. Your items are held for you while you pay.</p></div></div>';
    var f = document.createElement('form'); f.method = 'POST'; f.action = o.payhere.action;
    Object.keys(o.payhere.fields).forEach(function (k) { var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = o.payhere.fields[k]; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  }

  // #order/<number>: the PayHere return page and the "Track order" link. Shows what the SERVER says — never trusts the redirect.
  function renderOrderApi(number) {
    setTitle('Your order');
    var mine = SCG.myOrders().filter(function (x) { return x.number === number; })[0];
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Order ' + esc(number) + '</span></div><div class="panel" style="max-width:720px;margin:0 auto;padding:22px" id="ordBox"><p class="muted">Loading your order…</p></div></div>';
    var tries = 0;
    function load() {
      var p = SCG.customer ? SCG.api('GET', '/account/orders/' + encodeURIComponent(number)).catch(function () { return mine ? SCG.trackOrder(number, mine.token) : Promise.reject(new Error('not found')); })
        : mine ? SCG.trackOrder(number, mine.token) : Promise.reject(new Error('not found'));
      p.then(function (o) {
        var waiting = o.paymentMethod === 'payhere' && o.paymentStatus === 'pending' && o.status === 'pending_payment';
        $('#ordBox').innerHTML = '<h2 style="margin-top:0">Order ' + esc(o.number) + '</h2>' +
          (waiting ? '<p class="free-note need"><b>Waiting for PayHere to confirm your payment.</b> This page updates by itself. If you closed the payment page without paying, your items are released after 30 minutes.</p>' : '') +
          (o.paymentStatus === 'paid' && o.paymentMethod === 'payhere' ? '<p class="free-note"><b>Payment received.</b> Thank you!</p>' : '') +
          orderStatusHTML(o) +
          '<div style="margin-top:12px">' + o.items.map(function (it) { return '<div class="sum-row"><span><a href="#p/' + esc(it.id) + '">' + esc(it.name) + '</a> <small class="muted">×' + it.qty + (it.variant ? ' · ' + esc(it.variant) : '') + '</small></span><span>' + money(it.lineTotal) + '</span></div>'; }).join('') +
          '<div class="sum-row"><span>Delivery</span><span>' + (o.shipping ? money(o.shipping) : 'FREE') + '</span></div>' + (o.discount ? '<div class="sum-row"><span>Promo code</span><span>−' + money(o.discount) + '</span></div>' : '') +
          '<div class="sum-row total"><span>Total</span><span>' + money(o.total) + '</span></div></div>' +
          (o.customer && o.customer.address ? '<p class="muted" style="font-size:13px">Delivering to ' + esc(o.customer.name) + ', ' + esc(o.customer.address) + ', ' + esc(o.customer.city) + ', ' + esc(o.customer.district) + '</p>' : '');
        if (waiting && tries++ < 40) setTimeout(function () { if (location.hash === '#order/' + number) load(); }, 4000);
      }, function () {
        $('#ordBox').innerHTML = '<h2 style="margin-top:0">Order ' + esc(number) + '</h2><p>This order is not saved on this device. Track it with your phone number instead:</p><p><a class="btn navy" href="#track/' + esc(number) + '">Track with phone number</a></p>';
      });
    }
    load();
  }

  function renderTrackApi(pre) {
    setTitle('Track order');
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>Track my order</span></div>' +
      '<form class="panel form" id="tf" style="max-width:640px;margin:0 auto"><h3>Track your order</h3><label>Order number<input name="id" required value="' + esc(pre || '') + '" placeholder="e.g. SC-261108-ABC123" maxlength="20"></label>' +
      '<label>Phone number used for the order<input name="phone" required placeholder="07X XXX XXXX" maxlength="20"></label><button class="btn navy full" style="grid-column:1/-1">Track</button><div class="full" id="tr"></div></form>' +
      (SCG.myOrders().length ? '<div class="panel" style="max-width:640px;margin:14px auto;padding:16px"><h3 style="margin-top:0">Orders placed on this device</h3>' + SCG.myOrders().map(function (o) { return '<div class="sum-row"><a href="#order/' + esc(o.number) + '">' + esc(o.number) + '</a><span class="muted">' + new Date(o.at).toLocaleDateString() + '</span></div>'; }).join('') + '</div>' : '') + '</div>';
    $('#tf').onsubmit = function (e) {
      e.preventDefault(); var f = e.target, n = f.id.value.trim().toUpperCase();
      $('#tr').innerHTML = '<p class="muted">Checking…</p>';
      SCG.trackOrder(n, null, f.phone.value).then(function (o) { $('#tr').innerHTML = orderStatusHTML(o); }, function (err) {
        $('#tr').innerHTML = '<p style="color:var(--red)">' + esc(err.status === 404 ? 'We could not find an order with that number and phone. Check both, or call us on ' + db.settings.phone + '.' : err.message) + '</p>';
      });
    };
  }

  function renderAccountApi() {
    setTitle('My account');
    var me = SCG.customer;
    if (!me) {
      app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>My account</span></div><div class="acct-grid">' +
        '<form class="panel form" id="loginF"><h3>Sign in</h3><label class="full">Email<input name="email" type="email" required autocomplete="email"></label>' +
          '<label class="full">Password<input name="password" type="password" required autocomplete="current-password"></label>' +
          '<button class="btn navy full" style="grid-column:1/-1">Sign in</button><p class="full" style="margin:0"><button type="button" class="link-sm" id="forgot">Forgot password?</button></p><p class="full co-msg" id="loginMsg" style="margin:0;color:var(--red)"></p>' +
          '<button class="btn google full" type="button" disabled title="Coming soon" style="grid-column:1/-1">' + googleG() + 'Sign in with Google <small>coming soon</small></button></form>' +
        '<form class="panel form" id="regF"><h3>Create an account</h3><p class="full" style="margin:0;color:var(--muted);font-size:13px">Optional: you can always check out as a guest. An account keeps all your orders together.</p>' +
          '<label class="full">Full name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label>' +
          '<label>Phone (optional)<input name="phone" maxlength="20" autocomplete="tel"></label><label class="full">Password (12+ characters)<input name="password" type="password" required minlength="12" autocomplete="new-password"></label>' +
          '<button class="btn full" style="grid-column:1/-1">Create account</button><p class="full" id="regMsg" style="margin:0;color:var(--red)"></p></form></div>' +
        (SCG.myOrders().length ? '<div class="panel" style="padding:16px;margin-top:14px"><h3 style="margin-top:0">Orders placed on this device</h3>' + SCG.myOrders().map(function (o) { return '<div class="sum-row"><a href="#order/' + esc(o.number) + '">' + esc(o.number) + '</a><span class="muted">' + new Date(o.at).toLocaleDateString() + '</span></div>'; }).join('') + '</div>' : '') + '</div>';
      var done = function (c) {
        if (c && c.pendingConfirmation) { toast('We sent a confirmation link to ' + c.email + '. Open it to finish creating your account.'); renderAccountApi(); return; }
        updateAccount(); toast('Welcome, ' + c.name.split(' ')[0] + '!'); renderAccountApi();
      };
      $('#loginF').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements; SCG.customerAuth('login', { email: E.email.value.trim(), password: E.password.value }).then(done, function (err) { $('#loginMsg').textContent = err.message; }); };
      $('#regF').onsubmit = function (e) { e.preventDefault(); var E = e.target.elements; SCG.customerAuth('register', { name: E.name.value.trim(), email: E.email.value.trim(), phone: E.phone.value.trim(), password: E.password.value }).then(done, function (err) { $('#regMsg').textContent = err.message; }); };
      $('#forgot').onclick = function () { var em = $('#loginF').elements.email.value.trim(); if (!em) { $('#loginMsg').textContent = 'Type your email above first.'; return; } SCG.api('POST', '/customers/password-reset/request', { email: em }).then(function () { $('#loginMsg').style.color = 'var(--green, #0a7d3c)'; $('#loginMsg').textContent = 'If that email has an account, we sent a reset link.'; }, function (err) { $('#loginMsg').textContent = err.message; }); };
      return;
    }
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>My account</span></div><div class="panel acct-head">' + avatar(me) + '<div><h2>Hello, ' + esc(me.name.split(' ')[0]) + '</h2><small>' + esc(me.email || '') + (me.verified ? ' · email confirmed' : ' · please confirm your email (check your inbox)') + '</small></div></div>' +
      '<div class="acct-grid"><div class="panel" id="myOrders"><p class="muted" style="padding:16px">Loading your orders…</p></div><div>' +
      '<form class="panel form" id="profForm"><h3>My details</h3><label class="full">Full name<input name="name" required maxlength="80" value="' + esc(me.name) + '"></label>' +
        '<label>Phone<input name="phone" maxlength="20" value="' + esc(me.phone || '') + '"></label>' +
        '<label class="full">Address<input name="line1" maxlength="200" value="' + esc(me.address ? me.address.line1 : '') + '"></label><label>City<input name="city" maxlength="60" value="' + esc(me.address ? me.address.city : '') + '"></label>' +
        '<label>District<select name="district">' + DISTRICTS.map(function (d) { return '<option' + (me.address && d === me.address.district ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></label>' +
        '<button class="btn navy full" style="grid-column:1/-1">Save details</button></form>' +
      '<div class="panel acct-side"><a class="btn line full" href="#wishlist">My wishlist</a><button class="btn line full" id="signOut">Sign out</button></div></div></div></div>';
    SCG.api('GET', '/account/orders').then(function (list) {
      $('#myOrders').innerHTML = '<div class="sec-head" style="padding:14px 16px 0"><h2 style="font-size:17px">My orders</h2></div>' + (list.length ? list.map(function (o) {
        var idx = ST_IDX[o.status] === undefined ? -1 : ST_IDX[o.status], bad = { cancelled: 1, expired: 1, refunded: 1 }[o.status];
        return '<div class="acct-order"><div class="ao-top"><b>' + esc(o.number) + '</b><span class="ao-status ' + (bad ? 'x' : o.status === 'delivered' ? 'ok' : '') + '">' + esc(ST_LABEL[o.status] || o.status) + '</span><span class="muted">' + new Date(o.placedAt).toLocaleDateString() + ' · ' + money(o.total) + '</span></div>' +
          (!bad ? '<div class="ao-bar">' + [0, 1, 2, 3, 4].map(function (i) { return '<i class="' + (i <= idx ? 'on' : '') + '"></i>'; }).join('') + '</div>' : '') +
          '<div class="ao-actions"><a class="link-sm" href="#order/' + esc(o.number) + '">Details</a></div></div>';
      }).join('') : '<p class="empty">No orders yet.</p>');
    }, function (err) { $('#myOrders').innerHTML = '<p class="empty">' + esc(err.message) + '</p>'; });
    $('#profForm').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      var body = { name: E.name.value.trim(), phone: E.phone.value.trim() };
      if (E.line1.value.trim()) body.address = { line1: E.line1.value.trim(), city: E.city.value.trim(), district: E.district.value };
      SCG.api('PUT', '/customers/me', body).then(function () { return SCG.loadCustomer(); }).then(function () { updateAccount(); toast('Your details are saved'); }, function (err) { toast(err.message); });
    };
    $('#signOut').onclick = function () { SCG.customerLogout().then(function () { updateAccount(); toast('Signed out'); renderAccountApi(); }); };
  }
  function renderTokenPage(kind, token) {
    setTitle(kind === 'verify' ? 'Confirm email' : 'New password');
    if (kind === 'verify') {
      app.innerHTML = '<div class="wrap"><div class="panel" style="max-width:520px;margin:30px auto;padding:22px" id="tokBox"><p class="muted">Confirming…</p></div></div>';
      SCG.api('POST', '/customers/verify-email', { token: token }).then(function () { $('#tokBox').innerHTML = '<h2>Email confirmed ✓</h2><p><a class="btn navy" href="#account">Go to my account</a></p>'; SCG.loadCustomer(); },
        function (err) { $('#tokBox').innerHTML = '<h2>Link not valid</h2><p>' + esc(err.message) + '</p>'; });
      return;
    }
    app.innerHTML = '<div class="wrap"><form class="panel form" id="rpF" style="max-width:520px;margin:30px auto"><h3>Choose a new password</h3><label class="full">New password (12+ characters)<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><button class="btn navy full" style="grid-column:1/-1">Save password</button><p class="full" id="rpMsg" style="margin:0"></p></form></div>';
    $('#rpF').onsubmit = function (e) { e.preventDefault(); SCG.api('POST', '/customers/password-reset/confirm', { token: token, password: e.target.elements.password.value }).then(function () { $('#rpMsg').innerHTML = 'Password saved. <a href="#account">Sign in</a>'; }, function (err) { $('#rpMsg').textContent = err.message; }); };
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
    if (SCG.API) return renderTrackApi(pre);
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
    setTitle('How importing works');
    var steps = (db.settings.chinaSteps || []).map(function (x) { return [esc(x.title), esc(x.text)]; });
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>How importing works</span></div>' +
      '<div class="cd-hero">' + stageHTML('stage2') + '</div>' +
      '<section class="sec" data-ed="pages"><div class="sec-head"><h2>From the factory to your door in 5 steps</h2></div><div class="steps">' + steps.map(function (s, i) { return '<div class="panel step reveal" style="animation-delay:' + i * .08 + 's"><div class="n">' + (i + 1) + '</div><h4>' + s[0] + '</h4><p>' + s[1] + '</p></div>'; }).join('') + '</div></section>' +
      '<section class="sec"><div class="sec-head"><h2>Where we import from</h2></div><div class="countries">' + activeOrigins().map(function (o) { return '<a class="country" href="#from/' + o.id + '">' + codeBadge(o.code) + '<b>' + esc(o.name) + '</b><small>' + esc(o.days) + ' days to Sri Lanka</small></a>'; }).join('') + '</div></section>' +
      faq() + rail('Shop Global Imports', '#col/global-imports', db.products.filter(function (p) { return p.origin && p.origin !== 'local'; }).slice(0, 12)) + '</div>';
    $('.cd-hero .stage').style.minHeight = '480px';
    mountGlobe('stage2');
  }
  function faq() {
    var q = (db.settings.faq || []).map(function (x) { return [esc(x.q), esc(x.a)]; }); if (!q.length) return '';
    return '<section class="sec" data-ed="pages"><div class="sec-head"><h2>Questions &amp; answers</h2></div><div class="panel faq">' + q.map(function (x) { return '<details><summary>' + x[0] + '</summary><p>' + x[1] + '</p></details>'; }).join('') + '</div></section>';
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

  /* ---------------- customer account ---------------- */
  function avatar(p) { var n = String(p.name || '?').trim().split(/\s+/); return '<span class="avatar">' + esc((n[0][0] || '?') + (n[1] ? n[1][0] : '')).toUpperCase() + '</span>'; }
  function updateAccount() {
    var p = SCG.API ? SCG.customer : SCG.getProfile(), el = $('#accName');
    if (el) el.textContent = p ? p.name.split(' ')[0] : 'Account';
    var b = $('#accBtn'); if (b) b.classList.toggle('signed', !!p);
  }
  var TRACK_IDX = { Pending: 0, Confirmed: 1, Shipped: 2, 'Arrived in Sri Lanka': 3, Delivered: 4 };
  function renderAccount() {
    if (SCG.API) return renderAccountApi();
    setTitle('My account');
    var p = SCG.getProfile();
    if (!p) {
      app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>My account</span></div><div class="acct-grid">' +
        '<div class="panel acct-empty">' + I.user + '<h2>Your account is created with your first order</h2><p>No sign-up form. When you check out, we save your name, phone and address as your Source Connect profile on this device.</p><a class="btn" href="#">Start shopping</a>' +
          '<button class="btn google" disabled title="Coming soon">' + googleG() + 'Sign in with Google <small>coming soon</small></button></div>' +
        '<form class="panel form" id="findAcc"><h3>Already ordered on this device?</h3><p class="full" style="margin:0;color:var(--muted);font-size:13px">Enter the phone number you used and one of your order numbers.</p>' +
          '<label>Phone number<input name="phone" required placeholder="07X XXX XXXX"></label><label>Order number<input name="order" required placeholder="SCG1234567"></label>' +
          '<button class="btn navy full" style="grid-column:1/-1">Find my account</button><p class="full" id="findMsg" style="margin:0;color:var(--red)"></p></form></div></div>';
      $('#findAcc').onsubmit = function (e) {
        e.preventDefault(); var E = e.target.elements, key = SCG.phoneKey(E.phone.value), id = E.order.value.trim().toUpperCase();
        var o = SCG.getOrders().filter(function (x) { return x.id.toUpperCase() === id && SCG.phoneKey(x.customer.phone) === key; })[0];
        if (!o) { $('#findMsg').textContent = 'No order with that number and phone on this device. Orders are kept on the device they were placed on.'; return; }
        var parts = String(o.customer.address || '').split(', ');
        SCG.saveProfile({ id: o.customer.profileId || SCG.uid('cust'), createdAt: o.date, source: 'found from order', name: o.customer.name, phone: o.customer.phone, email: o.customer.email || '',
          district: parts.length > 2 ? parts.pop() : '', city: parts.length > 1 ? parts.pop() : '', address: parts.join(', '), lastOrderAt: o.date });
        updateAccount(); toast('Welcome back, ' + o.customer.name.split(' ')[0] + '!'); renderAccount();
      };
      return;
    }
    var orders = SCG.profileOrders(p), spent = orders.filter(function (o) { return o.status !== 'Cancelled'; }).reduce(function (s, o) { return s + o.total; }, 0);
    var districts = ['Colombo', 'Gampaha', 'Kalutara', 'Kandy', 'Matale', 'Nuwara Eliya', 'Galle', 'Matara', 'Hambantota', 'Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu', 'Batticaloa', 'Ampara', 'Trincomalee', 'Kurunegala', 'Puttalam', 'Anuradhapura', 'Polonnaruwa', 'Badulla', 'Moneragala', 'Ratnapura', 'Kegalle'];
    app.innerHTML = '<div class="wrap"><div class="crumbs"><a href="#">Home</a>›<span>My account</span></div>' +
      '<div class="panel acct-head">' + avatar(p) + '<div><h2>Hello, ' + esc(p.name.split(' ')[0]) + '</h2><small>Member since ' + new Date(p.createdAt).toLocaleDateString() + ' · created from your ' + esc(p.source || 'first order') + '</small></div>' +
        '<div class="acct-stats"><div><b>' + orders.length + '</b><small>Orders</small></div><div><b>' + money(spent) + '</b><small>Total spent</small></div><div><b>' + SCG.getWish().length + '</b><small>Wishlist</small></div></div></div>' +
      '<div class="acct-grid"><div class="panel"><div class="sec-head" style="padding:14px 16px 0"><h2 style="font-size:17px">My orders</h2></div>' +
        (orders.length ? orders.map(function (o) {
          var idx = TRACK_IDX[o.status];
          return '<div class="acct-order"><div class="ao-top"><b>' + esc(o.id) + '</b><span class="ao-status ' + (o.status === 'Cancelled' ? 'x' : o.status === 'Delivered' ? 'ok' : '') + '">' + esc(o.status) + '</span><span class="muted">' + new Date(o.date).toLocaleDateString() + '</span><b class="ao-total">' + money(o.total) + '</b></div>' +
            '<div class="ao-items">' + o.items.slice(0, 4).map(function (it) { var pr = SCG.productById(it.id); return '<a href="#p/' + esc(it.id) + '" class="ao-th" title="' + esc(it.name) + '" style="background:' + SCG.shade((pr && pr.color) || it.color || '#0b2a6f', 175) + '">' + (pr ? visual(pr, it.color) : '') + '</a>'; }).join('') +
            '<span class="muted" style="font-size:12.5px">' + o.items.reduce(function (s, it) { return s + it.qty; }, 0) + ' item(s)</span></div>' +
            (o.status !== 'Cancelled' ? '<div class="ao-bar">' + [0, 1, 2, 3, 4].map(function (i) { return '<i class="' + (i <= idx ? 'on' : '') + '"></i>'; }).join('') + '</div>' : '') +
            '<div class="ao-actions"><a class="link-sm" href="#track/' + o.id + '">Track</a><button class="link-sm" data-reorder="' + o.id + '">Buy again</button></div></div>';
        }).join('') : '<p class="empty">No orders yet.</p>') + '</div>' +
      '<div><form class="panel form" id="profForm"><h3>My details</h3>' +
        '<label class="full">Full name<input name="name" required value="' + esc(p.name) + '"></label>' +
        '<label>Phone<input name="phone" required pattern="[+]?[0-9][0-9 ]{8,14}" title="Phone number, e.g. 077 123 4567" value="' + esc(p.phone) + '"></label>' +
        '<label>Email<input name="email" type="email" value="' + esc(p.email || '') + '"></label>' +
        '<label class="full">Address<input name="address" value="' + esc(p.address || '') + '"></label>' +
        '<label>City<input name="city" value="' + esc(p.city || '') + '"></label>' +
        '<label>District<select name="district">' + districts.map(function (d) { return '<option' + (d === p.district ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></label>' +
        '<button class="btn navy full" style="grid-column:1/-1">Save details</button></form>' +
      '<div class="panel acct-side"><button class="btn google" disabled title="Coming soon">' + googleG() + 'Link Google account <small>coming soon</small></button>' +
        '<a class="btn line full" href="#wishlist">My wishlist</a><button class="btn line full" id="signOut">Sign out on this device</button>' +
        '<p class="muted" style="font-size:12px;margin:0">Your profile is saved on this device only. Signing out removes it from this device; your orders stay with us.</p></div></div></div></div>';
    $('#profForm').onsubmit = function (e) {
      e.preventDefault(); var E = e.target.elements;
      ['name', 'phone', 'email', 'address', 'city', 'district'].forEach(function (k) { p[k] = E[k].value.trim(); });
      SCG.saveProfile(p); updateAccount(); toast('Your details are saved');
    };
    $('#signOut').onclick = function () { SCG.clearProfile(); updateAccount(); toast('Signed out on this device'); renderAccount(); };
    app.onclick = function (e) {
      var b = e.target.closest('[data-reorder]'); if (!b) return;
      var o = orders.filter(function (x) { return x.id === b.dataset.reorder; })[0], added = 0;
      o.items.forEach(function (it) { if (SCG.productById(it.id)) { addToCart(it.id, it.size, it.qty, it.color); added++; } });
      if (added) location.hash = 'cart'; else toast('These products are no longer available');
    };
  }
  function googleG() { return '<svg viewBox="0 0 48 48" style="width:18px;height:18px;stroke:none"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.9 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'; }

  /* ---------------- admin visual editor (only inside the admin preview) ---------------- */
  var PREVIEW = /[?&]preview=1/.test(location.search) && window.parent !== window;
  // API mode: the admin tells the preview to fetch the saved data again after each save.
  if (PREVIEW && SCG.API) window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'scg-refresh') return;
    var y = scrollY;
    SCG.refresh().then(function () { db = SCG.load(); renderChrome(); route(); scrollTo(0, y); if (window.__edRefresh) __edRefresh(); });
  });
  if (PREVIEW) (function () {
    document.documentElement.classList.add('is-preview');
    var NAMES = { product: 'Product', banner: 'Banner', category: 'Category', collection: 'Collection', hero: 'Globe headline', services: 'Service icons', flash: 'Flash sale', origins: 'Import countries', header: 'Header & menu', settings: 'Footer & contact', pages: 'Importing page', sections: 'Homepage sections' };
    var PHOTO = { product: 1, banner: 1, category: 1, collection: 1 };
    var box = document.createElement('div'); box.className = 'ed-box'; box.hidden = true;
    var bar = document.createElement('div'); bar.className = 'ed-bar'; bar.hidden = true;
    var file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    document.body.appendChild(box); document.body.appendChild(bar); document.body.appendChild(file);
    var cur = null;
    function info(el) { return { ed: el.dataset.ed, id: el.dataset.id || '', i: el.dataset.i === undefined ? -1 : +el.dataset.i }; }
    function label(el) {
      var d = info(el), n = NAMES[d.ed] || d.ed;
      if (d.ed === 'product') { var p = SCG.productById(d.id); if (p) n += ': ' + p.name; }
      if (d.ed === 'category') { var c = SCG.categoryById(d.id); if (c) n += ': ' + c.name; }
      if (d.ed === 'collection') { var co = SCG.collectionById(d.id); if (co) n += ': ' + co.name; }
      if (d.ed === 'banner' && db.hero[d.i]) n += ': ' + db.hero[d.i].title;
      return n;
    }
    function place() {
      if (!cur || !document.body.contains(cur)) { box.hidden = bar.hidden = true; return; }
      var r = cur.getBoundingClientRect();
      box.hidden = bar.hidden = false;
      box.style.cssText = 'top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
      bar.style.top = Math.max(4, r.top + 4) + 'px'; bar.style.left = Math.max(4, Math.min(r.left + 4, innerWidth - bar.offsetWidth - 4)) + 'px';
    }
    function select(el) {
      cur = el;
      bar.innerHTML = '<span>' + esc(label(el)) + '</span><button type="button" data-a="edit">✎ Edit</button>' + (PHOTO[el.dataset.ed] ? '<button type="button" data-a="photo">🖼 Change photo</button>' : '');
      place();
    }
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest('.ed-bar')) return;
      var t = e.target.closest('[data-ed]'); if (t && t !== cur) select(t);
    });
    document.addEventListener('mouseleave', function () { box.hidden = bar.hidden = true; cur = null; });
    window.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    window.__edRefresh = function () { cur = null; box.hidden = bar.hidden = true; };
    function send(msg) { parent.postMessage(msg, location.origin); }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !cur) return;
      e.preventDefault(); e.stopPropagation();
      var d = info(cur);
      if (b.dataset.a === 'edit') send({ type: 'scg-edit', ed: d.ed, id: d.id, i: d.i, page: location.hash });
      if (b.dataset.a === 'photo') { file.dataset.ed = d.ed; file.dataset.id = d.id; file.dataset.i = d.i; file.value = ''; file.click(); }
    });
    file.addEventListener('change', function () {
      var f = file.files[0]; if (!f) return;
      toast('Processing photo…');
      SCG.imageToDataURL(f, 800).then(function (url) { send({ type: 'scg-photo', ed: file.dataset.ed, id: file.dataset.id, i: +file.dataset.i, url: url }); })
        .catch(function () { toast('That file could not be read as an image'); });
    });
    // tell the admin which page the preview is showing
    window.addEventListener('hashchange', function () { send({ type: 'scg-page', page: location.hash }); });
  })();

  /* ---------------- admin edit bar ---------------- */
  // The bar is only shown in edit mode: switched on from the admin panel ("Edit on Website"),
  // on a browser where the admin is signed in. Customers never see it.
  function adminOn() {
    try { var t = +localStorage.getItem('scg_admin_on'); return t && Date.now() - t < 12 * 3600e3 && localStorage.getItem('scg_edit_mode') === '1'; } catch (e) { return false; }
  }
  function adminBar(k, v) {
    var bar = $('#adminBar');
    if (PREVIEW) { if (bar) bar.remove(); return; }
    if (!adminOn()) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'adminBar'; bar.className = 'admin-bar'; document.body.appendChild(bar); }
    var links = [];
    if (k === 'col' && SCG.collectionById(v)) links.push(['admin/#collections/' + v, 'Edit this collection']);
    if (k === 'c' && SCG.categoryById(v)) links.push(['admin/#products/cat:' + v, 'Edit products in this category']);
    if (k === 'p' && SCG.productById(v)) links.push(['admin/#products/edit:' + v, 'Edit this product']);
    if (k === 'flash') links.push(['admin/#flash', 'Edit flash sale']);
    if (k === 'from') links.push(['admin/#origins', 'Edit import countries']);
    if (!k || k === 'home') links.push(['admin/#homepage', 'Edit homepage']);
    bar.innerHTML = '<span class="ab-tag">ADMIN</span>' + links.map(function (l) { return '<a href="' + l[0] + '">✎ ' + esc(l[1]) + '</a>'; }).join('') + '<a href="admin/#dashboard">Seller Center</a><button type="button" id="abExit">✕ Exit edit mode</button>';
    $('#abExit').onclick = function () { try { localStorage.removeItem('scg_edit_mode'); } catch (e) {} bar.remove(); toast('Edit mode off. You now see the site like a customer.'); };
  }

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
    else if (k === 'c' || k === 'col' || k === 'flash' || k === 'search' || k === 'shop' || k === 'from') renderListing(k, v, x);
    else if (k === 'cart') renderCart();
    else if (k === 'checkout') renderCheckout();
    else if (k === 'wishlist') renderWishlist();
    else if (k === 'account') renderAccount();
    else if (k === 'track') renderTrack(v);
    else if (k === 'order' && SCG.API) renderOrderApi(String(v || '').toUpperCase());
    else if ((k === 'verify' || k === 'reset') && SCG.API) renderTokenPage(k, v);
    else if (k === 'categories') renderCategories();
    else if (k === 'china-direct') renderChinaDirect();
    else if (k === 'help') renderHelp();
    else renderHome();
    if (k !== 'p') scrollTo(0, 0);
    adminBar(k, v);
  }

  window.addEventListener('storage', function (e) {
    if (e.key === SCG.keys.DB_KEY) {
      if (!PREVIEW) return location.reload();
      var y = scrollY; db = SCG.reload(); renderChrome(); route(); scrollTo(0, y); if (window.__edRefresh) __edRefresh();
    }
    if (e.key === SCG.keys.CART_KEY || e.key === SCG.keys.WISH_KEY) updateCounts();
  });

  renderChrome();
  bindChrome();
  updateAccount();
  window.addEventListener('hashchange', route);
  route();
  // cinematic welcome; when it ends, replay the homepage's own entrance animation
  if (window.SCGIntro) {
    SCGIntro.show({
      welcome: db.settings.welcome, origins: SCG.origins(), cities: db.settings.globeCities,
      onDone: function (played) { if (played && !location.hash.replace('#', '')) route(); }
    });
  }
});
