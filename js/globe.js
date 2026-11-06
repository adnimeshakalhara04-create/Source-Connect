/* =========================================================
   Source Connect Global — cinematic sourcing globe
   Imports from China, USA, Australia, UK, UAE, Japan… to Colombo.
   The camera tours one country at a time and follows its shipments.
   Pure canvas 2D, no libraries. Needs js/globe-data.js.
   ========================================================= */
(function (global) {
  'use strict';
  var RAD = Math.PI / 180;
  var DEST = { name: 'Colombo', lon: 79.86, lat: 6.93 };

  var COUNTRIES = {
    china: { name: 'China', label: [103, 35.5] },
    usa: { name: 'USA', label: [-98, 39.5] },
    australia: { name: 'Australia', label: [134, -25] },
    uk: { name: 'United Kingdom', label: [-2, 56.5] },
    uae: { name: 'UAE', label: [54.5, 21.5] },
    japan: { name: 'Japan', label: [139, 40] },
    india: { name: 'India', label: [78.5, 23] },
    germany: { name: 'Germany', label: [10.4, 53.5] }
  };
  var CITIES = [
    { name: 'Shenzhen', country: 'china', lon: 114.06, lat: 22.54, mode: 'sea' },
    { name: 'Yiwu', country: 'china', lon: 120.08, lat: 29.31, mode: 'air' },
    { name: 'Shanghai', country: 'china', lon: 121.47, lat: 31.23, mode: 'sea' },
    { name: 'Guangzhou', country: 'china', lon: 113.26, lat: 23.13, mode: 'air' },
    { name: 'Beijing', country: 'china', lon: 116.40, lat: 39.90, mode: 'air' },
    { name: 'Los Angeles', country: 'usa', lon: -118.24, lat: 34.05, mode: 'sea' },
    { name: 'New York', country: 'usa', lon: -74.00, lat: 40.71, mode: 'air' },
    { name: 'Sydney', country: 'australia', lon: 151.21, lat: -33.87, mode: 'sea' },
    { name: 'Melbourne', country: 'australia', lon: 144.96, lat: -37.81, mode: 'air' },
    { name: 'Perth', country: 'australia', lon: 115.86, lat: -31.95, mode: 'sea' },
    { name: 'London', country: 'uk', lon: -0.13, lat: 51.51, mode: 'air' },
    { name: 'Dubai', country: 'uae', lon: 55.27, lat: 25.20, mode: 'sea' },
    { name: 'Tokyo', country: 'japan', lon: 139.69, lat: 35.69, mode: 'air' },
    { name: 'Osaka', country: 'japan', lon: 135.50, lat: 34.69, mode: 'sea' },
    { name: 'Chennai', country: 'india', lon: 80.27, lat: 13.08, mode: 'sea' },
    { name: 'Mumbai', country: 'india', lon: 72.88, lat: 19.08, mode: 'air' },
    { name: 'Hamburg', country: 'germany', lon: 9.99, lat: 53.55, mode: 'sea' },
    { name: 'Frankfurt', country: 'germany', lon: 8.68, lat: 50.11, mode: 'air' }
  ];

  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function vec(lon, lat) { var c = Math.cos(lat * RAD); return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)]; }
  function angle(a, b) { return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)); }
  function slerp(a, b, t) {
    var d = angle(a, b);
    if (d < 1e-6) return [Math.atan2(a[1], a[0]) / RAD, Math.asin(a[2]) / RAD];
    var s = Math.sin(d), k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s;
    var v = [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
    return [Math.atan2(v[1], v[0]) / RAD, Math.asin(clamp(v[2], -1, 1)) / RAD];
  }
  function lonDelta(from, to) { return ((to - from + 540) % 360) - 180; }

  function mount(canvas, opts) {
    opts = opts || {};
    var geo = global.SCG_GEO;
    if (!canvas || !geo) return null;
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    var dots = geo.dots, nDots = dots.length / 3;
    var dLon = new Float32Array(nDots), dLat = new Float32Array(nDots), dType = new Uint8Array(nDots);
    for (var i = 0; i < nDots; i++) { dLon[i] = dots[i * 3] / 10; dLat[i] = dots[i * 3 + 1] / 10; dType[i] = dots[i * 3 + 2]; }
    var countryIndex = {}; (geo.countries || []).forEach(function (c, k) { countryIndex[c] = 10 + k; });
    var stars = [];
    for (var s = 0; s < 160; s++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + .2, p: Math.random() * 6.28 });

    // enabled routes, grouped into a tour of countries
    var dB = vec(DEST.lon, DEST.lat);
    var enabled = CITIES.filter(function (c) { return !opts.cities || opts.cities.indexOf(c.name) > -1; });
    var routes = enabled.map(function (o) {
      var a = vec(o.lon, o.lat), d = angle(a, dB), pts = [], n = Math.max(40, Math.round(d * 60));
      for (var j = 0; j <= n; j++) pts.push(slerp(a, dB, j / n));
      return { o: o, pts: pts, dist: d, dur: (o.mode === 'air' ? 1.6 : 2.2) + d * 1.1, lift: .1 + .14 * Math.min(1, d / 2) };
    });
    var order = Object.keys(COUNTRIES);
    var tour = order.filter(function (c) { return routes.some(function (r) { return r.o.country === c; }); }).map(function (c) {
      var rs = routes.filter(function (r) { return r.o.country === c; });
      var first = rs[0], mid = slerp(vec(first.o.lon, first.o.lat), dB, .5);
      var len = 0; rs.forEach(function (r, k) { len = Math.max(len, k * .45 + r.dur); });
      return { id: c, routes: rs, view: { lon: mid[0], lat: clamp(mid[1], -40, 45), zoom: clamp(1.18 - first.dist * .26, .66, 1.02) }, len: len };
    });
    var enabledCountries = {}; tour.forEach(function (t) { enabledCountries[t.id] = true; });

    var cam = { lon: -20, lat: 15, zoom: .62 };
    var seg = { idx: 0, start: 0, from: { lon: -20, lat: 15, zoom: .62 }, travel: 3.0, launch: 2.4 };
    var drag = null, userLon = 0, userLat = 0;
    var t0 = performance.now(), raf = 0, running = true, visible = true;
    var arrivals = 0, lastPhase = -1, lastCountry = null;

    function resize() {
      var b = canvas.getBoundingClientRect();
      W = Math.max(1, b.width); H = Math.max(1, b.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var narrow = W < 640;
      if (opts.fit) { R = Math.min(W, H) * .4; cx = W / 2; cy = H / 2; return; }
      R = Math.min(W * (narrow ? .44 : .34), H * (narrow ? .3 : .42));
      cx = W * (narrow ? .5 : (opts.centerX || .66)); cy = H * (narrow ? .66 : .5);
    }

    var sinP0 = 0, cosP0 = 1, lon0 = 0, scale = 1;
    function setView(lon, lat, zoom) { lon0 = lon; sinP0 = Math.sin(lat * RAD); cosP0 = Math.cos(lat * RAD); scale = R * zoom; }
    function project(lon, lat, lift) {
      var p = lat * RAD, l = (lon - lon0) * RAD, cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l);
      var depth = sinP0 * sp + cosP0 * cp * cl, k = scale * (lift || 1);
      return [cx + k * cp * Math.sin(l), cy - k * (cosP0 * sp - sinP0 * cp * cl), depth];
    }

    function drawStars(t) {
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i], a = .25 + .35 * Math.sin(t * 1.3 + s.p) * Math.sin(t * .7 + s.p * 2);
        ctx.fillStyle = 'rgba(210,222,255,' + Math.max(.05, a) + ')';
        ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
      }
    }
    function drawSphere() {
      var g = ctx.createRadialGradient(cx, cy, scale * .9, cx, cy, scale * 1.32);
      g.addColorStop(0, 'rgba(70,120,255,.35)'); g.addColorStop(.4, 'rgba(40,80,200,.12)'); g.addColorStop(1, 'rgba(10,20,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, scale * 1.32, 0, 6.2832); ctx.fill();
      var o = ctx.createRadialGradient(cx - scale * .35, cy - scale * .4, scale * .1, cx, cy, scale);
      o.addColorStop(0, '#1a3b8f'); o.addColorStop(.55, '#0c2260'); o.addColorStop(1, '#050f33');
      ctx.fillStyle = o; ctx.beginPath(); ctx.arc(cx, cy, scale, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(140,175,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    function drawGraticule() {
      ctx.strokeStyle = 'rgba(140,170,255,.08)'; ctx.lineWidth = .7;
      var lon, lat, p, on;
      for (lon = -180; lon < 180; lon += 20) {
        ctx.beginPath(); on = false;
        for (lat = -80; lat <= 80; lat += 4) { p = project(lon, lat); if (p[2] > 0) { on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } else on = false; }
        ctx.stroke();
      }
      for (lat = -60; lat <= 60; lat += 20) {
        ctx.beginPath(); on = false;
        for (lon = -180; lon <= 180; lon += 4) { p = project(lon, lat); if (p[2] > 0) { on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } else on = false; }
        ctx.stroke();
      }
    }
    function drawDots(t, featured) {
      var size = Math.max(1.1, scale / 210), featType = countryIndex[featured];
      for (var i = 0; i < nDots; i++) {
        var p = project(dLon[i], dLat[i]);
        if (p[2] <= 0.02) continue;
        var ty = dType[i], a = .25 + .75 * p[2];
        if (ty === 1) { ctx.fillStyle = 'rgba(255,214,90,' + a + ')'; ctx.fillRect(p[0] - .8, p[1] - .8, 1.6, 1.6); continue; }
        if (ty >= 10) {
          var cid = geo.countries[ty - 10];
          if (ty === featType) { ctx.fillStyle = 'rgba(255,70,78,' + (a * (.75 + .25 * Math.sin(t * 2 + dLon[i]))) + ')'; ctx.fillRect(p[0] - size * .45, p[1] - size * .45, size * .9, size * .9); continue; }
          if (enabledCountries[cid]) { ctx.fillStyle = 'rgba(255,140,120,' + (a * .55) + ')'; ctx.fillRect(p[0] - size * .4, p[1] - size * .4, size * .8, size * .8); continue; }
        }
        ctx.fillStyle = 'rgba(190,205,240,' + (a * .7) + ')'; ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size);
      }
    }
    function drawOutline(rings, color, width, glow) {
      if (!rings) return;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.shadowColor = color; ctx.shadowBlur = glow;
      rings.forEach(function (r) {
        ctx.beginPath(); var on = false;
        for (var i = 0; i < r.length; i++) { var p = project(r[i][0], r[i][1]); if (p[2] > 0) { on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } else on = false; }
        ctx.stroke();
      });
      ctx.restore();
    }
    function path(rt, upto, dashed) {
      var pts = rt.pts, n = pts.length - 1, on = false;
      ctx.beginPath();
      for (var i = 0; i <= upto; i++) {
        var q = project(pts[i][0], pts[i][1], 1 + rt.lift * Math.sin(Math.PI * i / n));
        if (q[2] > -0.08) { on ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); on = true; } else on = false;
      }
      ctx.stroke();
    }
    function drawFaint(rt) { ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.14)'; path(rt, rt.pts.length - 1); ctx.setLineDash([]); }
    function drawActive(rt, f, fade) {
      var pts = rt.pts, n = pts.length - 1, head = Math.floor(easeInOut(f) * n);
      var col = rt.o.mode === 'air' ? '255,214,90' : '255,80,88';
      ctx.save(); ctx.shadowColor = 'rgba(' + col + ',1)'; ctx.shadowBlur = 12; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(' + col + ',' + (.9 * fade) + ')'; path(rt, head); ctx.restore();
      if (f >= 1) return;
      var hp = pts[head], hq = pts[Math.min(n, head + 1)];
      var P = project(hp[0], hp[1], 1 + rt.lift * Math.sin(Math.PI * head / n)), Q = project(hq[0], hq[1], 1 + rt.lift * Math.sin(Math.PI * Math.min(n, head + 1) / n));
      if (P[2] < -0.08) return;
      ctx.save(); ctx.translate(P[0], P[1]); ctx.rotate(Math.atan2(Q[1] - P[1], Q[0] - P[0]));
      ctx.shadowColor = 'rgba(' + col + ',1)'; ctx.shadowBlur = 18; ctx.fillStyle = '#fff';
      if (rt.o.mode === 'air') { ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); }
      else { ctx.fillRect(-7, -3, 14, 6); ctx.fillStyle = 'rgba(' + col + ',1)'; ctx.fillRect(-4, -2, 3, 4); ctx.fillRect(0, -2, 3, 4); }
      ctx.restore();
    }
    function pin(lon, lat, color, label, sub, t, big) {
      var p = project(lon, lat); if (p[2] <= 0) return;
      var pulse = (((t * .9) % 1) + 1) % 1;
      ctx.strokeStyle = color.replace('A', String(1 - pulse)); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], 4 + pulse * (big ? 26 : 16), 0, 6.2832); ctx.stroke();
      ctx.fillStyle = color.replace('A', '1'); ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(p[0], p[1], big ? 5 : 3.2, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
      if (!label) return;
      ctx.font = '700 ' + (big ? 12 : 10) + 'px Roboto, system-ui, sans-serif';
      var tx = p[0] + (big ? 12 : 8), ty = p[1] + (big ? 4 : 3), w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(5,11,28,.6)'; ctx.fillRect(tx - 4, ty - (big ? 12 : 10), w + 8, big ? 16 : 13);
      ctx.fillStyle = '#fff'; ctx.fillText(label, tx, ty);
      if (sub) { ctx.font = '500 10px Roboto, system-ui, sans-serif'; ctx.fillStyle = 'rgba(220,228,255,.85)'; ctx.fillText(sub, tx, ty + 14); }
    }
    function regionLabel(text, lon, lat, alpha) {
      var p = project(lon, lat); if (p[2] <= .1) return;
      ctx.font = '800 ' + Math.round(clamp(scale / 15, 11, 19)) + 'px "Playfair Display", Georgia, serif';
      ctx.fillStyle = 'rgba(255,200,200,' + (.9 * alpha * p[2]) + ')';
      ctx.fillText(text.toUpperCase(), p[0] - ctx.measureText(text.toUpperCase()).width / 2, p[1]);
    }

    function frame(now) {
      raf = 0;
      var t = (now - t0) / 1000;
      if (!tour.length) {
        setView(-20 + t * 4 - userLon, 10 + userLat, 1); ctx.clearRect(0, 0, W, H);
        drawStars(t); drawSphere(); drawGraticule(); drawDots(t, null); pin(DEST.lon, DEST.lat, 'rgba(255,214,90,A)', 'SRI LANKA', '', t, true);
        if (running && visible && !reduce) raf = requestAnimationFrame(frame); return;
      }
      if (reduce) { seg.idx = 0; seg.start = t - 30; seg.travel = .01; }
      var cur = tour[seg.idx % tour.length], lt = t - seg.start;
      var segEnd = seg.launch + cur.len + 2.4;
      if (lt > segEnd && !reduce) { // next country
        seg.from = { lon: cam.lon, lat: cam.lat, zoom: cam.zoom };
        seg.idx = (seg.idx + 1) % tour.length; seg.start = t; seg.travel = 1.8; seg.launch = 1.4;
        cur = tour[seg.idx]; lt = 0;
        cur.routes.forEach(function (r) { r._done = false; });
      }
      // camera
      var k = easeInOut(clamp(lt / seg.travel, 0, 1)), v = cur.view;
      var drift = Math.sin(t * .2) * 4 * k;
      cam.lon = seg.from.lon + lonDelta(seg.from.lon, v.lon) * k + drift;
      cam.lat = seg.from.lat + (v.lat - seg.from.lat) * k + Math.sin(t * .23) * 1.5 * k;
      cam.zoom = seg.from.zoom + (v.zoom - seg.from.zoom) * k;
      if (!drag) { userLon *= .95; userLat *= .95; }
      setView(cam.lon - userLon, clamp(cam.lat + userLat, -60, 60), cam.zoom);

      ctx.clearRect(0, 0, W, H);
      drawStars(t); drawSphere(); drawGraticule(); drawDots(t, cur.id);
      drawOutline(geo.outlines && geo.outlines[cur.id], 'rgba(255,80,88,.6)', 1, 8);
      drawOutline(geo.srilanka, 'rgba(255,214,90,.95)', 1.4, 12);
      regionLabel(COUNTRIES[cur.id].name, COUNTRIES[cur.id].label[0], COUNTRIES[cur.id].label[1], clamp((lt - seg.travel * .6) / .8, 0, 1));

      routes.forEach(function (rt) { if (rt.o.country !== cur.id) drawFaint(rt); });
      var phase = 0, primary = null;
      cur.routes.forEach(function (rt, j) {
        drawFaint(rt);
        var rl = lt - seg.launch - j * .45; if (rl < 0) return;
        var f = clamp(rl / rt.dur, 0, 1), fade = f < 1 ? 1 : clamp(1 - (rl - rt.dur) / 2.6, .25, 1);
        drawActive(rt, f, fade);
        if (f >= 1 && !rt._done) { rt._done = true; arrivals++; if (opts.onArrive) opts.onArrive(arrivals, { name: rt.o.name, country: rt.o.country, countryName: COUNTRIES[rt.o.country].name }); }
        if (j === 0) primary = { f: f, after: rl - rt.dur };
      });
      routes.forEach(function (rt) { pin(rt.o.lon, rt.o.lat, rt.o.country === cur.id ? 'rgba(255,80,88,A)' : 'rgba(255,150,130,A)', rt.o.country === cur.id && (W > 700 || rt === cur.routes[0]) && lt > seg.travel * .7 ? rt.o.name : '', '', t + rt.o.lon, false); });
      pin(DEST.lon, DEST.lat, 'rgba(255,214,90,A)', lt > .5 || seg.idx ? 'SRI LANKA' : '', 'Colombo warehouse', t, true);

      if (!primary) phase = lt > seg.launch - .9 ? 1 : 0;
      else phase = primary.f < 1 ? 2 : primary.after < 1.4 ? 3 : 4;
      if (opts.onPhase && phase !== lastPhase) { lastPhase = phase; opts.onPhase(phase); }
      if (opts.onCountry && cur.id !== lastCountry) { lastCountry = cur.id; opts.onCountry(cur.id, COUNTRIES[cur.id].name); }
      if (running && visible && !reduce) raf = requestAnimationFrame(frame);
    }

    function kick() { if (!raf && running) raf = requestAnimationFrame(frame); }
    canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, lon: userLon, lat: userLat }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      userLon = drag.lon + (e.clientX - drag.x) * .25; userLat = drag.lat + (e.clientY - drag.y) * .2;
      if (reduce) frame(performance.now());
    });
    function up() { drag = null; canvas.style.cursor = ''; }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

    var ro = 'ResizeObserver' in window ? new ResizeObserver(function () { resize(); if (reduce) frame(performance.now()); }) : null;
    if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) kick(); }) : null;
    if (io) io.observe(canvas);
    function onVis() { visible = !document.hidden; if (visible) kick(); }
    document.addEventListener('visibilitychange', onVis);

    resize();
    if (reduce) frame(performance.now()); else kick();
    return {
      destroy: function () { running = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVis); }
    };
  }

  global.SCGGlobe = {
    mount: mount,
    COUNTRIES: COUNTRIES,
    CITIES_FULL: CITIES,
    CITIES: CITIES.map(function (c) { return c.name; })
  };
})(window);
