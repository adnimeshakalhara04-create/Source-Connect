/* =========================================================
   Source Connect Global — Storefront app
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = SCG.escapeHTML;
  var db = SCG.load();
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ICON = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    left: '<svg width="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg width="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    close: '<svg width="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  /* ---------------- Intro ---------------- */
  function runIntro() {
    var intro = $('#intro');
    var seen = false;
    try { seen = sessionStorage.getItem('scg_intro') === '1'; } catch (e) {}
    var title = $('#introTitle');
    title.innerHTML = title.textContent.split('').map(function (ch, i) {
      return '<span style="animation-delay:' + (0.9 + i * 0.05) + 's">' + (ch === ' ' ? '&nbsp;' : esc(ch)) + '</span>';
    }).join('');
    function finish() {
      if (intro.classList.contains('done')) return;
      intro.classList.add('done');
      document.body.classList.remove('lock');
      try { sessionStorage.setItem('scg_intro', '1'); } catch (e) {}
      setTimeout(function () { intro.remove(); }, 1200);
    }
    $('#introSkip').addEventListener('click', finish);
    if (seen || reduceMotion) { intro.remove(); document.body.classList.remove('lock'); return; }
    setTimeout(finish, 3300);
  }

  /* ---------------- Header / chrome ---------------- */
  function renderChrome() {
    var s = db.settings;
    var ann = esc(s.announcement || '');
    $('#announce').innerHTML = ('<span>' + ann + '</span>').repeat(4);

    $('#megaShop').innerHTML = '<div class="mega-title">SHOP BY CATEGORY</div>' + db.categories.map(function (c) {
      var p = db.products.filter(function (x) { return x.category === c.id; })[0];
      var color = p ? p.color : '#0b2a6f';
      return '<a class="mega-card" href="#category/' + c.id + '"><span class="thumb" style="background:' + SCG.shade(color, 150) + '">' +
        SCG.garmentSVG(c.shape, color) + '</span><span><b>' + esc(c.name) + '</b><small>' + esc(c.tagline || '') + '</small></span></a>';
    }).join('');

    $('#megaColl').innerHTML = '<div class="mega-title">CURATED COLLECTIONS</div>' + db.collections.map(function (c) {
      return '<a class="coll-mini" href="#collection/' + c.id + '" style="--bg:linear-gradient(150deg,' + SCG.shade(c.accent, 40) + ',' + SCG.shade(c.accent, -60) + ')">' +
        '<small>COLLECTION</small><b>' + esc(c.name) + '</b></a>';
    }).join('');

    $('#drawerLinks').innerHTML =
      '<h4>MENU</h4><a href="#home">Home</a><a href="#shop">Shop All</a><a href="#new">New Arrivals</a><a href="#about">About</a><a href="#contact">Contact</a>' +
      '<h4>CATEGORIES</h4>' + db.categories.map(function (c) { return '<a href="#category/' + c.id + '">' + esc(c.name) + '</a>'; }).join('') +
      '<h4>COLLECTIONS</h4>' + db.collections.map(function (c) { return '<a href="#collection/' + c.id + '">' + esc(c.name) + '</a>'; }).join('');
    $$('#drawerLinks a').forEach(function (a, i) { a.style.transitionDelay = (0.15 + i * 0.03) + 's'; });

    $('#footCats').innerHTML = db.categories.map(function (c) { return '<li><a href="#category/' + c.id + '">' + esc(c.name) + '</a></li>'; }).join('');
    $('#footColls').innerHTML = db.collections.map(function (c) { return '<li><a href="#collection/' + c.id + '">' + esc(c.name) + '</a></li>'; }).join('');
    $('#footContact').innerHTML =
      '<li>' + esc(s.address) + '</li><li><a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a></li>' +
      '<li><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></li>' +
      (s.whatsapp ? '<li><a target="_blank" rel="noopener" href="https://wa.me/' + esc(s.whatsapp) + '">WhatsApp us →</a></li>' : '');
    $('#year').textContent = new Date().getFullYear();
  }

  function bindChrome() {
    var header = $('#header'), lastY = 0, prog = $('#progress');
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      header.classList.toggle('scrolled', y > 10);
      header.classList.toggle('hide', y > 400 && y > lastY + 4);
      if (y < lastY - 4) header.classList.remove('hide');
      lastY = y;
      var h = document.documentElement.scrollHeight - innerHeight;
      prog.style.transform = 'scaleX(' + (h > 0 ? y / h : 0) + ')';
      parallax();
    }, { passive: true });

    var drawer = $('#drawer');
    $('#burger').onclick = function () { drawer.classList.add('open'); document.body.classList.add('lock'); };
    function closeDrawer() { drawer.classList.remove('open'); document.body.classList.remove('lock'); }
    $('#drawerClose').onclick = closeDrawer;
    drawer.addEventListener('click', function (e) { if (e.target.closest('a')) closeDrawer(); });

    var search = $('#search');
    $('#searchBtn').onclick = function () { search.classList.add('open'); setTimeout(function () { $('#searchInput').focus(); }, 200); };
    $('#searchClose').onclick = function () { search.classList.remove('open'); };
    $('#searchForm').onsubmit = function (e) {
      e.preventDefault();
      var q = $('#searchInput').value.trim();
      search.classList.remove('open');
      location.hash = q ? 'search/' + encodeURIComponent(q) : 'shop';
    };

    $('#cartBtn').onclick = openCart;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { search.classList.remove('open'); closeModal(); closeCart(); closeDrawer(); }
    });
    $('#newsletter').onsubmit = function (e) { e.preventDefault(); e.target.reset(); toast('Welcome to the Source Connect family!'); };

    // custom cursor
    var cur = $('#cursor');
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      var cx = 0, cy = 0, tx = 0, ty = 0;
      document.addEventListener('mousemove', function (e) { tx = e.clientX; ty = e.clientY; });
      (function loop() { cx += (tx - cx) * 0.2; cy += (ty - cy) * 0.2; cur.style.transform = 'translate(' + (cx - 17) + 'px,' + (cy - 17) + 'px)'; requestAnimationFrame(loop); })();
      cur.style.left = '0'; cur.style.top = '0';
      document.addEventListener('mouseover', function (e) { cur.classList.toggle('big', !!e.target.closest('.card-media, .cat-card, .coll-card')); });
    }
  }

  /* ---------------- Product card ---------------- */
  function card(p, i) {
    var cat = SCG.categoryById(p.category);
    var media = p.image ? '<img src="' + p.image + '" alt="' + esc(p.name) + '" loading="lazy">' : '<div class="art">' + SCG.garmentSVG(cat ? cat.shape : 'tshirt', p.color) + '</div>';
    return '<article class="card reveal" style="--d:' + ((i % 4) * 0.08) + 's;--c:' + p.color + '">' +
      '<div class="card-media" data-open="' + p.id + '">' + (p.badge ? '<span class="badge ' + esc(p.badge.split(' ')[0]) + '">' + esc(p.badge) + '</span>' : '') + media +
      '<button class="quick-add" data-add="' + p.id + '">+ Quick Add</button></div>' +
      '<div class="card-info"><div><h4 data-open="' + p.id + '">' + esc(p.name) + '</h4><small><span class="swatch" style="background:' + p.color + '"></span>' + esc(cat ? cat.name : '') + '</small></div>' +
      '<div class="price">' + SCG.money(p.price) + (p.comparePrice ? '<s>' + SCG.money(p.comparePrice) + '</s>' : '') + '</div></div></article>';
  }

  /* ---------------- Home ---------------- */
  function renderHome() {
    var app = $('#app');
    var slides = db.hero.map(function (h, i) {
      var lines = String(h.title || '').split('\n');
      var visual = h.image ? '<img src="' + h.image + '" alt="">' : SCG.garmentSVG(h.shape || 'jacket', h.color || '#0b2a6f');
      return '<div class="slide' + (i === 0 ? ' active' : '') + '" style="--c:' + (h.color || '#0b2a6f') + '">' +
        '<div class="slide-bg"></div><div class="slide-ghost">' + esc(h.eyebrow || '') + '</div>' +
        '<div class="container slide-inner"><div>' +
        '<div class="slide-eyebrow">' + esc(h.eyebrow || '') + '</div>' +
        '<h1>' + lines.map(function (l) { return '<span class="line"><span>' + esc(l) + '</span></span>'; }).join('') + '</h1>' +
        '<p>' + esc(h.subtitle || '') + '</p>' +
        '<div class="actions"><a class="btn" href="' + esc(h.link || '#shop') + '">' + esc(h.cta || 'Shop Now') + ICON.arrow + '</a>' +
        '<a class="btn ghost" href="#shop">View All</a></div></div>' +
        '<div class="slide-visual"><div class="orbit"></div><div class="orbit o2"></div><div class="slide-garment" data-depth="30">' + visual + '</div></div>' +
        '</div></div>';
    }).join('');

    var catCards = db.categories.map(function (c, i) {
      var items = db.products.filter(function (p) { return p.category === c.id; });
      var color = items[0] ? items[0].color : '#0b2a6f';
      return '<a class="cat-card reveal" href="#category/' + c.id + '" style="--c:' + color + ';--d:' + (i % 4 * 0.08) + 's">' +
        '<div class="bg"></div><div class="art">' + SCG.garmentSVG(c.shape, color) + '</div>' +
        '<span class="count">' + items.length + ' STYLES</span><div><h3>' + esc(c.name) + '</h3><small>' + esc(c.tagline || '') + '</small></div>' +
        '<span class="go">' + ICON.arrow.replace('<svg', '<svg width="18"') + '</span></a>';
    }).join('');

    var collCards = db.collections.map(function (c, i) {
      var items = db.products.filter(function (p) { return (p.collections || []).indexOf(c.id) > -1; })
        .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 3);
      var stack = items.map(function (p) { return '<div>' + SCG.productVisual(p) + '</div>'; }).join('');
      return '<a class="coll-card" href="#collection/' + c.id + '" style="--c:' + c.accent + '">' +
        '<div class="bg">' + (c.image ? '<img src="' + c.image + '" alt="">' : '') + '</div>' + (c.image ? '' : '<div class="stack">' + stack + '</div>') +
        '<span class="num">0' + (i + 1) + ' / COLLECTION</span>' +
        '<h3>' + esc(c.name) + '</h3><p>' + esc(c.description || '') + '</p><span class="link-arrow" style="border-color:#fff">Explore ' + ICON.arrow.replace('<svg', '<svg width="16"') + '</span></a>';
    }).join('');

    var tabs = '<button class="tab active" data-tab="all">All</button>' + db.categories.map(function (c) {
      return '<button class="tab" data-tab="' + c.id + '">' + esc(c.name) + '</button>';
    }).join('');

    var totalProducts = db.products.length;
    var marqueeWords = db.collections.map(function (c) { return '<span>' + esc(c.name) + '</span>'; }).join('');

    app.innerHTML =
      '<section class="hero" id="home">' +
        '<canvas class="net" id="net"></canvas><div class="hero-letterbox t"></div><div class="hero-letterbox b"></div>' + slides +
        '<div class="hero-ui"><div class="container"><div class="slide-count"><b id="slideNum">01</b> / ' + String(db.hero.length).padStart(2, '0') + '</div>' +
        '<div class="dots" id="dots">' + db.hero.map(function (_, i) { return '<button aria-label="Slide ' + (i + 1) + '"' + (i === 0 ? ' class="active"' : '') + '><i></i></button>'; }).join('') + '</div>' +
        '<div class="scroll-cue"><i></i>SCROLL</div></div></div>' +
      '</section>' +
      '<div class="marquee"><div class="track">' + marqueeWords + marqueeWords + marqueeWords + marqueeWords + '</div></div>' +

      '<section class="section"><div class="container">' +
        '<div class="section-head"><div><div class="kicker reveal">Shop by category</div><h2 class="section-title reveal" style="--d:.1s">Dressed for <em>every</em> world</h2></div>' +
        '<a href="#shop" class="link-arrow reveal">Shop all ' + ICON.arrow.replace('<svg', '<svg width="16"') + '</a></div>' +
        '<div class="cat-grid">' + catCards + '</div></div></section>' +

      '<section class="section collections" id="collections"><div class="container">' +
        '<div class="section-head"><div><div class="kicker reveal">Curated</div><h2 class="section-title reveal" style="--d:.1s">The <em>Collections</em></h2></div>' +
        '<div class="coll-nav reveal"><button id="collPrev" aria-label="Previous">' + ICON.left + '</button><button id="collNext" aria-label="Next">' + ICON.right + '</button></div></div>' +
        '<div class="coll-scroller" id="collScroller">' + collCards + '</div></div></section>' +

      '<section class="section" id="new"><div class="container">' +
        '<div class="section-head"><div><div class="kicker reveal">Just landed</div><h2 class="section-title reveal" style="--d:.1s">New <em>Arrivals</em></h2></div>' +
        '<a href="#shop" class="link-arrow reveal">View everything ' + ICON.arrow.replace('<svg', '<svg width="16"') + '</a></div>' +
        '<div class="tabs reveal" id="tabs">' + tabs + '</div><div class="grid" id="homeGrid"></div>' +
        '<div class="load-more"><a class="btn dark" href="#shop">Explore all ' + totalProducts + ' styles ' + ICON.arrow + '</a></div></div></section>' +

      '<section class="cine" id="cine"><div class="layer l1" data-speed=".15"></div><div class="layer l2" data-speed=".35"><img src="assets/logo.jpg" alt=""></div><div class="grain"></div>' +
        '<div class="cine-content"><div class="kicker reveal" style="justify-content:center;color:#ff6b6e">Fashion without borders</div>' +
        '<h2 class="reveal" style="--d:.1s">One World.<br><em>One Style.</em></h2>' +
        '<p class="reveal" style="--d:.2s">From Colombo to the world — we source premium fabrics globally and craft them into pieces that connect cultures.</p>' +
        '<a class="btn reveal" style="--d:.3s" href="#shop">Start Shopping ' + ICON.arrow + '</a>' +
        '<div class="stats"><div class="reveal"><b data-count="' + totalProducts + '">0</b><small>STYLES</small></div>' +
        '<div class="reveal" style="--d:.1s"><b data-count="' + db.categories.length + '">0</b><small>CATEGORIES</small></div>' +
        '<div class="reveal" style="--d:.2s"><b data-count="' + db.collections.length + '">0</b><small>COLLECTIONS</small></div>' +
        '<div class="reveal" style="--d:.3s"><b data-count="25">0</b><small>COUNTRIES SOURCED</small></div></div></div></section>' +

      '<section class="section"><div class="container"><div class="features">' +
        feature('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', 'Islandwide Delivery', 'Fast, tracked delivery to your door.', 0) +
        feature('<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/>', '7-Day Exchange', 'Not the right fit? Swap it easily.', .08) +
        feature('<path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', 'Secure Checkout', 'Cash on delivery & safe payments.', .16) +
        feature('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>', 'Globally Sourced', 'Premium fabrics from 25+ countries.', .24) +
      '</div></div></section>' +

      '<section class="section" id="about" style="padding-top:20px"><div class="container about-grid">' +
        '<div class="about-visual reveal-clip"><div class="ring"></div><img src="assets/logo.jpg" alt="Source Connect Global"></div>' +
        '<div class="about-text"><div class="kicker reveal">Our story</div><h2 class="section-title reveal" style="--d:.1s">Connecting the world <em>through fashion</em></h2>' +
        '<p class="reveal" style="--d:.2s">Source Connect Global was born from a simple idea: great clothing should have no borders. We partner with makers across continents to bring you premium quality at honest prices.</p>' +
        '<p class="reveal" style="--d:.3s">Every collection blends global trends with timeless craftsmanship — so you can look sharp at the office, on the street and after dark.</p>' +
        '<a class="btn dark reveal" style="--d:.4s;margin-top:14px" href="#collections">Discover Collections ' + ICON.arrow + '</a></div>' +
      '</div></section>';

    initHero();
    renderHomeGrid('all');
    $('#tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.tab'); if (!t) return;
      $$('#tabs .tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      renderHomeGrid(t.dataset.tab);
    });
    var sc = $('#collScroller');
    $('#collPrev').onclick = function () { sc.scrollBy({ left: -440, behavior: 'smooth' }); };
    $('#collNext').onclick = function () { sc.scrollBy({ left: 440, behavior: 'smooth' }); };
    dragScroll(sc);
  }

  function feature(path, title, text, d) {
    return '<div class="feature reveal" style="--d:' + d + 's"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg></div><h4>' + title + '</h4><p>' + text + '</p></div>';
  }

  function renderHomeGrid(tab) {
    var list = db.products.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (tab !== 'all') list = list.filter(function (p) { return p.category === tab; });
    list = list.slice(0, 8);
    $('#homeGrid').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">No products yet.</div>';
    observe();
  }

  function dragScroll(el) {
    var down = false, sx = 0, sl = 0;
    el.addEventListener('mousedown', function (e) { down = true; sx = e.pageX; sl = el.scrollLeft; el.style.scrollSnapType = 'none'; });
    window.addEventListener('mouseup', function () { if (down) { down = false; el.style.scrollSnapType = ''; } });
    el.addEventListener('mousemove', function (e) { if (!down) return; e.preventDefault(); el.scrollLeft = sl - (e.pageX - sx) * 1.4; });
    el.addEventListener('click', function (e) { if (Math.abs(el.scrollLeft - sl) > 6 && down === false && sx) { e.preventDefault(); sx = 0; } }, true);
  }

  /* ---------------- Hero slider + particle network ---------------- */
  var heroTimer = null, netRAF = null;
  function initHero() {
    var slides = $$('.slide'), dots = $$('#dots button'), idx = 0, DUR = 7000;
    document.documentElement.style.setProperty('--dur', DUR / 1000 + 's');
    function go(n) {
      slides[idx].classList.remove('active'); dots[idx].classList.remove('active');
      idx = (n + slides.length) % slides.length;
      void slides[idx].offsetWidth;
      slides[idx].classList.add('active'); dots[idx].classList.add('active');
      $('#slideNum').textContent = String(idx + 1).padStart(2, '0');
      restart();
    }
    function restart() { clearInterval(heroTimer); if (slides.length > 1) heroTimer = setInterval(function () { go(idx + 1); }, DUR); }
    dots.forEach(function (d, i) { d.onclick = function () { if (i !== idx) go(i); }; });
    restart();

    // swipe
    var hero = $('.hero'), sx = null;
    hero.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (sx === null) return; var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1)); sx = null;
    });

    // mouse parallax
    hero.addEventListener('mousemove', function (e) {
      var x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      $$('.slide.active .slide-visual').forEach(function (el) { el.style.transform = 'translate(' + (x * -30) + 'px,' + (y * -20) + 'px)'; });
    });

    network($('#net'));
  }

  function network(canvas) {
    if (!canvas || reduceMotion) return;
    cancelAnimationFrame(netRAF);
    var ctx = canvas.getContext('2d'), pts = [], W, H, dpr = Math.min(2, devicePixelRatio || 1), mouse = { x: -999, y: -999 };
    function size() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.min(90, Math.round(W * H / 16000));
      pts = [];
      for (var i = 0; i < n; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: Math.random() * 1.6 + .5, red: Math.random() < .18 });
    }
    size();
    if (window.__scgNetResize) window.removeEventListener('resize', window.__scgNetResize);
    window.__scgNetResize = size; window.addEventListener('resize', size);
    canvas.parentElement.addEventListener('mousemove', function (e) { var b = canvas.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; });
    function frame() {
      if (!document.body.contains(canvas)) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
        var mdx = p.x - mouse.x, mdy = p.y - mouse.y, md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 120) { p.x += mdx / md * 0.8; p.y += mdy / md * 0.8; }
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy;
          if (d < 15000) { ctx.strokeStyle = 'rgba(199,207,221,' + (0.16 * (1 - d / 15000)) + ')'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        }
        ctx.fillStyle = p.red ? 'rgba(255,59,63,.95)' : 'rgba(255,255,255,.8)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      netRAF = requestAnimationFrame(frame);
    }
    frame();
  }

  function parallax() {
    $$('[data-speed]').forEach(function (el) {
      var b = el.parentElement.getBoundingClientRect();
      if (b.bottom < 0 || b.top > innerHeight) return;
      el.style.transform = 'translate3d(0,' + (b.top * -parseFloat(el.dataset.speed)) + 'px,0)';
    });
  }

  /* ---------------- Shop listing ---------------- */
  function renderShop(kind, value) {
    var title = 'Shop All', sub = 'Every style, every category — ' + db.products.length + ' pieces and counting.', accent = '#0b2a6f', crumb = 'Shop';
    var state = { cat: 'all', coll: 'all', q: '', sort: 'new' };
    if (kind === 'category') { var c = SCG.categoryById(value); if (c) { title = c.name; sub = c.tagline; crumb = 'Category'; state.cat = c.id; var fp = db.products.filter(function (p) { return p.category === c.id; })[0]; if (fp) accent = fp.color; } }
    if (kind === 'collection') { var co = SCG.collectionById(value); if (co) { title = co.name; sub = co.description; crumb = 'Collection'; state.coll = co.id; accent = co.accent; } }
    if (kind === 'search') { state.q = value; title = '“' + value + '”'; sub = 'Search results'; crumb = 'Search'; }

    $('#app').innerHTML =
      '<section class="shop-hero" style="--c:' + accent + '"><div class="container">' +
      '<div class="crumbs reveal"><a href="#home">Home</a> / ' + esc(crumb) + '</div>' +
      '<h1 class="reveal" style="--d:.1s">' + esc(title) + '</h1><p class="reveal" style="--d:.2s">' + esc(sub || '') + '</p></div></section>' +
      '<section class="container" style="padding-bottom:100px">' +
      '<div class="toolbar"><div class="filters">' +
        '<select id="fCat" aria-label="Category"><option value="all">All categories</option>' + db.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<select id="fColl" aria-label="Collection"><option value="all">All collections</option>' + db.collections.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<input id="fQ" type="search" placeholder="Search…" aria-label="Search">' +
      '</div><div class="filters"><span class="result-count" id="count"></span>' +
        '<select id="fSort" aria-label="Sort"><option value="new">Newest</option><option value="low">Price: Low → High</option><option value="high">Price: High → Low</option><option value="name">Name A–Z</option></select></div></div>' +
      '<div class="grid" id="shopGrid"></div><div class="load-more" id="more"></div></section>';

    $('#fCat').value = state.cat; $('#fColl').value = state.coll; $('#fQ').value = state.q;
    var limit = 16;
    function draw() {
      var q = state.q.toLowerCase();
      var list = db.products.filter(function (p) {
        if (state.cat !== 'all' && p.category !== state.cat) return false;
        if (state.coll !== 'all' && (p.collections || []).indexOf(state.coll) < 0) return false;
        if (q) { var cat = SCG.categoryById(p.category); if ((p.name + ' ' + (cat ? cat.name : '') + ' ' + (p.description || '')).toLowerCase().indexOf(q) < 0) return false; }
        return true;
      });
      list.sort(function (a, b) {
        if (state.sort === 'low') return a.price - b.price;
        if (state.sort === 'high') return b.price - a.price;
        if (state.sort === 'name') return a.name.localeCompare(b.name);
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      $('#count').textContent = list.length + ' products';
      $('#shopGrid').innerHTML = list.length ? list.slice(0, limit).map(card).join('') : '<div class="empty">No products match your filters.</div>';
      $('#more').innerHTML = list.length > limit ? '<button class="btn dark" id="moreBtn">Load more (' + (list.length - limit) + ')</button>' : '';
      if ($('#moreBtn')) $('#moreBtn').onclick = function () { limit += 16; draw(); };
      observe();
    }
    $('#fCat').onchange = function (e) { state.cat = e.target.value; limit = 16; draw(); };
    $('#fColl').onchange = function (e) { state.coll = e.target.value; limit = 16; draw(); };
    $('#fSort').onchange = function (e) { state.sort = e.target.value; draw(); };
    $('#fQ').oninput = function (e) { state.q = e.target.value.trim(); limit = 16; draw(); };
    draw();
  }

  /* ---------------- Product modal ---------------- */
  var modalState = null;
  function openProduct(id) {
    var p = db.products.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var cat = SCG.categoryById(p.category);
    modalState = { id: id, size: (p.sizes || [])[2] || (p.sizes || [])[0] || 'One Size', qty: 1 };
    var colls = (p.collections || []).map(function (cid) { var c = SCG.collectionById(cid); return c ? '<a href="#collection/' + c.id + '">' + esc(c.name) + '</a>' : ''; }).filter(Boolean).join(', ');
    $('#modalBox').style.setProperty('--c', p.color);
    $('#modalBox').innerHTML =
      '<button class="modal-close" data-close aria-label="Close">' + ICON.close + '</button>' +
      '<div class="modal-media" style="--c:' + p.color + '">' + (p.image ? '<img src="' + p.image + '" alt="' + esc(p.name) + '">' : '<div class="art">' + SCG.garmentSVG(cat ? cat.shape : 'tshirt', p.color) + '</div>') + '</div>' +
      '<div class="modal-body"><div class="kicker">' + esc(cat ? cat.name : '') + '</div><h2>' + esc(p.name) + '</h2>' +
      '<div class="price">' + SCG.money(p.price) + (p.comparePrice ? '<s>' + SCG.money(p.comparePrice) + '</s>' : '') + '</div>' +
      '<p>' + esc(p.description || '') + '</p>' +
      ((p.sizes || []).length ? '<div class="opt-label">Size</div><div class="sizes" id="mSizes">' + p.sizes.map(function (s) { return '<button class="' + (s === modalState.size ? 'active' : '') + '" data-size="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="opt-label">Quantity</div><div class="qty"><button data-q="-1">−</button><span id="mQty">1</span><button data-q="1">+</button></div>' +
      '<div class="modal-actions"><button class="btn" id="mAdd">Add to Bag ' + ICON.arrow + '</button>' +
      '<span style="font-size:12px;color:' + (p.stock > 0 ? '#16a34a' : 'var(--red)') + '">' + (p.stock > 0 ? '● In stock (' + p.stock + ')' : '● Out of stock') + '</span></div>' +
      '<div class="meta-list">SKU: ' + esc(p.id.toUpperCase()) + (colls ? '<br>Collections: ' + colls : '') + '</div></div>';
    $('#modal').classList.add('open'); document.body.classList.add('lock');
    var sz = $('#mSizes');
    if (sz) sz.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; modalState.size = b.dataset.size; $$('button', sz).forEach(function (x) { x.classList.toggle('active', x === b); }); };
    $$('[data-q]', $('#modalBox')).forEach(function (b) { b.onclick = function () { modalState.qty = Math.max(1, Math.min(20, modalState.qty + +b.dataset.q)); $('#mQty').textContent = modalState.qty; }; });
    $('#mAdd').onclick = function () { if (p.stock <= 0) { toast('Sorry, this item is out of stock'); return; } addToCart(p.id, modalState.size, modalState.qty); closeModal(); openCart(); };
  }
  function closeModal() { var m = $('#modal'); if (!m.classList.contains('open')) return; m.classList.remove('open'); if (!$('#cart').classList.contains('open')) document.body.classList.remove('lock'); }
  $('#modal').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeModal(); });

  /* ---------------- Cart ---------------- */
  function addToCart(id, size, qty) {
    var p = db.products.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    size = size || (p.sizes || [])[2] || (p.sizes || [])[0] || 'One Size';
    var cart = SCG.getCart();
    var line = cart.filter(function (l) { return l.id === id && l.size === size; })[0];
    if (line) line.qty += qty || 1; else cart.push({ id: id, size: size, qty: qty || 1 });
    SCG.saveCart(cart); updateCartCount(true); toast(p.name + ' added to bag');
  }
  function updateCartCount(bump) {
    var n = SCG.getCart().reduce(function (s, l) { return s + l.qty; }, 0), el = $('#cartCount');
    el.textContent = n; el.classList.toggle('show', n > 0);
    if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
  function openCart() { renderCart(); $('#cart').classList.add('open'); document.body.classList.add('lock'); }
  function closeCart() { var c = $('#cart'); if (!c.classList.contains('open')) return; c.classList.remove('open'); document.body.classList.remove('lock'); }
  $('#cart').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) return closeCart();
    var rm = e.target.closest('[data-rm]');
    if (rm) { var cart = SCG.getCart(); cart.splice(+rm.dataset.rm, 1); SCG.saveCart(cart); renderCart(); updateCartCount(); }
    var q = e.target.closest('[data-cq]');
    if (q) { var c2 = SCG.getCart(), l = c2[+q.dataset.i]; l.qty = Math.max(1, l.qty + +q.dataset.cq); SCG.saveCart(c2); renderCart(); updateCartCount(); }
  });
  function cartLines() {
    return SCG.getCart().map(function (l) { var p = db.products.filter(function (x) { return x.id === l.id; })[0]; return p ? { l: l, p: p } : null; }).filter(Boolean);
  }
  function renderCart() {
    var lines = cartLines(), total = 0;
    $('#cartItems').innerHTML = lines.length ? lines.map(function (x, i) {
      total += x.p.price * x.l.qty;
      return '<div class="cart-item"><div class="thumb" style="background:' + SCG.shade(x.p.color, 160) + '">' + SCG.productVisual(x.p) + '</div>' +
        '<div><h5>' + esc(x.p.name) + '</h5><small>Size ' + esc(x.l.size) + '</small><div class="qty" style="margin-top:6px;transform:scale(.85);transform-origin:left"><button data-cq="-1" data-i="' + i + '">−</button><span>' + x.l.qty + '</span><button data-cq="1" data-i="' + i + '">+</button></div>' +
        '<button class="rm" data-rm="' + i + '">REMOVE</button></div><b style="font-size:13px">' + SCG.money(x.p.price * x.l.qty) + '</b></div>';
    }).join('') : '<div class="empty" style="padding:60px 0">Your bag is empty.<br><br><a class="btn dark" href="#shop" data-close>Start shopping</a></div>';
    $('#cartFoot').innerHTML = lines.length ?
      '<div class="row"><span>Subtotal</span><span>' + SCG.money(total) + '</span></div>' +
      '<form class="checkout-form" id="checkout"><input name="name" placeholder="Full name" required><input name="phone" placeholder="Phone number" required pattern="[0-9+ ]{9,15}">' +
      '<textarea name="address" rows="2" placeholder="Delivery address" required></textarea>' +
      '<button class="btn full">Place Order (Cash on Delivery)</button></form>' : '';
    var f = $('#checkout');
    if (f) f.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(f), orders = SCG.getOrders();
      var order = {
        id: 'SCG-' + Date.now().toString().slice(-6), date: new Date().toISOString(), status: 'Pending',
        customer: { name: fd.get('name'), phone: fd.get('phone'), address: fd.get('address') },
        items: lines.map(function (x) { return { id: x.p.id, name: x.p.name, size: x.l.size, qty: x.l.qty, price: x.p.price }; }),
        total: total
      };
      orders.unshift(order); SCG.saveOrders(orders);
      // reduce stock
      lines.forEach(function (x) { x.p.stock = Math.max(0, (x.p.stock || 0) - x.l.qty); }); SCG.save();
      SCG.saveCart([]); updateCartCount(); renderCart();
      $('#cartItems').innerHTML = '<div class="empty" style="padding:60px 0"><h3 style="font-family:var(--font-display);font-size:28px;color:var(--ink);margin:0 0 8px">Thank you!</h3>Order <b>' + order.id + '</b> received.<br>We will call you shortly to confirm.</div>';
    };
  }

  /* ---------------- Delegated clicks ---------------- */
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) { e.preventDefault(); e.stopPropagation(); addToCart(add.dataset.add); return; }
    var open = e.target.closest('[data-open]');
    if (open) { openProduct(open.dataset.open); }
  });

  /* card 3D tilt */
  document.addEventListener('mousemove', function (e) {
    var m = e.target.closest && e.target.closest('.card-media');
    $$('.card-media.tilt').forEach(function (x) { if (x !== m) { x.classList.remove('tilt'); x.style.transform = ''; } });
    if (!m || reduceMotion) return;
    var b = m.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
    m.classList.add('tilt'); m.style.transform = 'rotateY(' + (x * 10) + 'deg) rotateX(' + (-y * 10) + 'deg)';
  });

  /* ---------------- Reveal + counters ---------------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in'); io.unobserve(en.target);
      $$('[data-count]', en.target).concat(en.target.matches('[data-count]') ? [en.target] : []).forEach(countUp);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }) : null;
  function observe() {
    $$('.reveal:not(.in), .reveal-clip:not(.in)').forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); });
  }
  function countUp(el) {
    var end = +el.dataset.count, t0 = null;
    (function step(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / 1600); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + (k === 1 && end >= 25 ? '+' : ''); if (k < 1) requestAnimationFrame(step); })(performance.now());
  }

  /* ---------------- Toast ---------------- */
  var toastT;
  function toast(msg) {
    var t = $('#toast'); $('span', t).textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ---------------- Router ---------------- */
  var current = null;
  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var parts = h.split('/'), key = parts[0] || 'home', val = parts.slice(1).join('/');
    closeModal();
    $$('.nav-link').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === key || (key === 'category' && a.dataset.nav === 'shop') || (key === 'collection' && a.dataset.nav === 'collections')); });

    if (key === 'product') { if (!current) { renderHome(); current = 'home'; observe(); } openProduct(val); return; }
    if (key === 'shop' || key === 'category' || key === 'collection' || key === 'search') {
      clearInterval(heroTimer); renderShop(key, val); current = h; window.scrollTo(0, 0); observe(); return;
    }
    // home + anchor sections
    if (current !== 'home') { renderHome(); current = 'home'; observe(); }
    var anchor = { home: null, collections: '#collections', new: '#new', about: '#about', contact: '#contact' }[key];
    if (anchor) { var el = $(anchor); if (el) setTimeout(function () { window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' }); }, 30); }
    else window.scrollTo(0, 0);
  }

  // Refresh when admin panel changes data in another tab
  window.addEventListener('storage', function (e) {
    if (e.key === SCG.keys.DB_KEY) { location.reload(); }
    if (e.key === SCG.keys.CART_KEY) updateCartCount();
  });

  runIntro();
  renderChrome();
  bindChrome();
  window.addEventListener('hashchange', route);
  route();
  updateCartCount();
})();
