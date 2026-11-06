/* =========================================================
   Source Connect Global — cinematic sourcing globe
   China ➜ Sri Lanka shipping routes on a dotted 3D globe.
   Pure canvas 2D, no libraries. Needs js/globe-data.js.
   ========================================================= */
(function (global) {
  'use strict';
  var RAD = Math.PI / 180;
  var DEST = { name: 'Colombo', lon: 79.86, lat: 6.93 };
  var ORIGINS = [
    { name: 'Shenzhen', lon: 114.06, lat: 22.54, mode: 'sea' },
    { name: 'Yiwu', lon: 120.08, lat: 29.31, mode: 'air' },
    { name: 'Shanghai', lon: 121.47, lat: 31.23, mode: 'sea' },
    { name: 'Guangzhou', lon: 113.26, lat: 23.13, mode: 'air' },
    { name: 'Beijing', lon: 116.40, lat: 39.90, mode: 'air' }
  ];

  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* unit vector helpers for great-circle interpolation */
  function vec(lon, lat) { var c = Math.cos(lat * RAD); return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)]; }
  function slerp(a, b, t) {
    var d = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
    if (d < 1e-6) return a;
    var s = Math.sin(d), k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s;
    var v = [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
    return [Math.atan2(v[1], v[0]) / RAD, Math.asin(clamp(v[2], -1, 1)) / RAD];
  }

  function mount(canvas, opts) {
    opts = opts || {};
    var geo = global.SCG_GEO;
    if (!canvas || !geo) return null;
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    var dots = geo.dots, nDots = dots.length / 3;
    // pre-split dot coordinates
    var dLon = new Float32Array(nDots), dLat = new Float32Array(nDots), dType = new Uint8Array(nDots);
    for (var i = 0; i < nDots; i++) { dLon[i] = dots[i * 3] / 10; dLat[i] = dots[i * 3 + 1] / 10; dType[i] = dots[i * 3 + 2]; }
    var stars = [];
    for (var s = 0; s < 160; s++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + .2, p: Math.random() * 6.28 });

    var routes = ORIGINS.map(function (o, k) {
      var a = vec(o.lon, o.lat), b = vec(DEST.lon, DEST.lat), pts = [];
      for (var j = 0; j <= 80; j++) pts.push(slerp(a, b, j / 80));
      return { o: o, pts: pts, delay: k * 1.15, dur: o.mode === 'air' ? 3.0 : 4.2, primary: k === 0 };
    });

    // camera: rotation center (lon0, lat0) and zoom
    var cam = { lon: -20, lat: 15, zoom: .62 };
    var target = { lon: 97, lat: 17, zoom: 1 };
    var drag = null, userLon = 0, userLat = 0;
    var t0 = performance.now(), last = t0, raf = 0, running = true, visible = true;
    var arrivals = 0, lastPhase = -1;

    function resize() {
      var b = canvas.getBoundingClientRect();
      W = Math.max(1, b.width); H = Math.max(1, b.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var narrow = W < 640;
      R = Math.min(W * (narrow ? .44 : .34), H * (narrow ? .3 : .42));
      cx = W * (narrow ? .5 : (opts.centerX || .66)); cy = H * (narrow ? .66 : .5);
    }

    // orthographic projection, returns [x, y, depth] (depth>0 visible)
    var sinP0 = 0, cosP0 = 1, lon0 = 0, scale = 1;
    function setView(lon, lat, zoom) { lon0 = lon; sinP0 = Math.sin(lat * RAD); cosP0 = Math.cos(lat * RAD); scale = R * zoom; }
    function project(lon, lat, lift) {
      var p = lat * RAD, l = (lon - lon0) * RAD, cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l);
      var depth = sinP0 * sp + cosP0 * cp * cl;
      var k = scale * (lift || 1);
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
      // outer atmosphere glow
      var g = ctx.createRadialGradient(cx, cy, scale * .9, cx, cy, scale * 1.32);
      g.addColorStop(0, 'rgba(70,120,255,.35)'); g.addColorStop(.4, 'rgba(40,80,200,.12)'); g.addColorStop(1, 'rgba(10,20,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, scale * 1.32, 0, 6.2832); ctx.fill();
      // ocean body
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

    function drawDots(t) {
      var size = Math.max(1.1, scale / 210);
      for (var i = 0; i < nDots; i++) {
        var p = project(dLon[i], dLat[i]);
        if (p[2] <= 0.02) continue;
        var ty = dType[i], a = .25 + .75 * p[2];
        if (ty === 0) { ctx.fillStyle = 'rgba(190,205,240,' + (a * .7) + ')'; ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size); }
        else if (ty === 1) { ctx.fillStyle = 'rgba(255,70,78,' + (a * (.75 + .25 * Math.sin(t * 2 + dLon[i]))) + ')'; ctx.fillRect(p[0] - size * .45, p[1] - size * .45, size * .9, size * .9); }
        else { ctx.fillStyle = 'rgba(255,214,90,' + a + ')'; ctx.fillRect(p[0] - .8, p[1] - .8, 1.6, 1.6); }
      }
    }

    function drawOutline(rings, color, width, glow) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.shadowColor = color; ctx.shadowBlur = glow;
      rings.forEach(function (r) {
        ctx.beginPath(); var on = false;
        for (var i = 0; i < r.length; i++) { var p = project(r[i][0], r[i][1]); if (p[2] > 0) { on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; } else on = false; }
        ctx.closePath(); ctx.stroke();
      });
      ctx.restore();
    }

    function liftAt(f) { return 1 + .2 * Math.sin(Math.PI * f); }

    function drawRoute(rt, t) {
      var local = t - 3.2 - rt.delay; // routes start after the camera intro
      if (local < 0) return null;
      var cycle = rt.dur + 2.6, ct = local % cycle, f = clamp(ct / rt.dur, 0, 1), fe = easeInOut(f);
      var fade = ct > rt.dur ? 1 - (ct - rt.dur) / 2.6 : 1;
      var pts = rt.pts, n = pts.length - 1, head = Math.floor(fe * n);
      // full faint path
      ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,' + (.18 * fade) + ')';
      ctx.beginPath();
      for (var i = 0; i <= n; i++) { var q = project(pts[i][0], pts[i][1], liftAt(i / n)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.stroke(); ctx.setLineDash([]);
      // glowing travelled path
      var col = rt.o.mode === 'air' ? '255,214,90' : '255,80,88';
      ctx.save(); ctx.shadowColor = 'rgba(' + col + ',1)'; ctx.shadowBlur = 12;
      ctx.lineWidth = rt.primary ? 2.6 : 1.8; ctx.lineCap = 'round';
      var grad = null;
      ctx.beginPath();
      for (var j = 0; j <= head; j++) { var p = project(pts[j][0], pts[j][1], liftAt(j / n)); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      ctx.strokeStyle = 'rgba(' + col + ',' + (.9 * fade) + ')'; ctx.stroke(); ctx.restore();
      // moving vehicle
      var hp = pts[Math.min(n, head)], hq = pts[Math.min(n, head + 1)];
      var P = project(hp[0], hp[1], liftAt(head / n)), Q = project(hq[0], hq[1], liftAt(Math.min(1, (head + 1) / n)));
      if (f < 1) {
        ctx.save(); ctx.translate(P[0], P[1]); ctx.rotate(Math.atan2(Q[1] - P[1], Q[0] - P[0]));
        ctx.shadowColor = 'rgba(' + col + ',1)'; ctx.shadowBlur = 18; ctx.fillStyle = '#fff';
        if (rt.o.mode === 'air') { // plane
          ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
        } else { // container ship
          ctx.fillRect(-7, -3, 14, 6); ctx.fillStyle = 'rgba(' + col + ',1)'; ctx.fillRect(-4, -2, 3, 4); ctx.fillRect(0, -2, 3, 4);
        }
        ctx.restore();
      }
      return { f: f, ct: ct, fade: fade, arrivedNow: false, cycleIndex: Math.floor(local / cycle) };
    }

    function pin(lon, lat, color, label, sub, t, big) {
      var p = project(lon, lat); if (p[2] <= 0) return;
      var pulse = (t * .9) % 1;
      ctx.strokeStyle = color.replace('A', String(1 - pulse)); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], 4 + pulse * (big ? 26 : 16), 0, 6.2832); ctx.stroke();
      ctx.fillStyle = color.replace('A', '1'); ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(p[0], p[1], big ? 5 : 3.2, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
      if (label) {
        ctx.font = '700 ' + (big ? 12 : 10) + 'px Roboto, system-ui, sans-serif';
        var tx = p[0] + (big ? 12 : 8), ty = p[1] + (big ? 4 : 3);
        ctx.fillStyle = 'rgba(5,11,28,.6)'; var w = ctx.measureText(label).width;
        ctx.fillRect(tx - 4, ty - (big ? 12 : 10), w + 8, big ? 16 : 13);
        ctx.fillStyle = '#fff'; ctx.fillText(label, tx, ty);
        if (sub) { ctx.font = '500 10px Roboto, system-ui, sans-serif'; ctx.fillStyle = 'rgba(220,228,255,.85)'; ctx.fillText(sub, tx, ty + 14); }
      }
    }

    function regionLabel(text, lon, lat, color) {
      var p = project(lon, lat); if (p[2] <= .1) return;
      ctx.font = '800 ' + Math.round(clamp(scale / 14, 11, 20)) + 'px "Playfair Display", Georgia, serif';
      ctx.fillStyle = color; ctx.globalAlpha = p[2];
      ctx.save(); ctx.letterSpacing = '4px'; ctx.fillText(text, p[0] - ctx.measureText(text).width / 2, p[1]); ctx.restore();
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = 0;
      var dt = Math.min(.05, (now - last) / 1000); last = now;
      var t = reduce ? 9 : (now - t0) / 1000;
      // camera: cinematic swing from Africa to the China–Sri Lanka corridor, then slow drift
      var k = easeInOut(clamp(t / 3.2, 0, 1));
      var drift = t > 3.2 ? Math.sin((t - 3.2) * .18) * 7 : 0;
      cam.lon = -20 + (target.lon + 20) * k + drift * k;
      cam.lat = 15 + (target.lat - 15) * k + Math.sin(t * .23) * 2 * k;
      cam.zoom = .62 + (target.zoom - .62) * k;
      if (!drag) { userLon *= .96; userLat *= .96; }
      setView(cam.lon - userLon, clamp(cam.lat + userLat, -60, 60), cam.zoom);

      ctx.clearRect(0, 0, W, H);
      drawStars(t);
      drawSphere();
      drawGraticule();
      drawDots(t);
      drawOutline(geo.china, 'rgba(255,80,88,.55)', 1, 8);
      drawOutline(geo.srilanka, 'rgba(255,214,90,.95)', 1.4, 12);
      if (t > 2.4) {
        ctx.globalAlpha = clamp((t - 2.4) / 1, 0, 1);
        regionLabel('CHINA', 103, 35.5, 'rgba(255,190,190,.9)');
        ctx.globalAlpha = 1;
      }
      var primary = null;
      routes.forEach(function (rt) {
        var st = drawRoute(rt, t);
        if (rt.primary) primary = st;
        if (st && rt._cycle !== st.cycleIndex && st.f >= 1) { rt._cycle = st.cycleIndex; arrivals++; if (opts.onArrive) opts.onArrive(arrivals, rt.o); }
      });
      routes.forEach(function (rt) { if (t > 3) pin(rt.o.lon, rt.o.lat, 'rgba(255,80,88,A)', rt.primary || W > 900 ? rt.o.name : '', '', t + rt.delay, false); });
      pin(DEST.lon, DEST.lat, 'rgba(255,214,90,A)', t > 3 ? 'SRI LANKA' : '', t > 3 ? 'Colombo warehouse' : '', t, true);

      // phases for the HTML timeline
      if (opts.onPhase) {
        var ph = 0;
        if (primary) { var f = primary.f; ph = f < .15 ? 1 : f < 1 ? 2 : primary.fade > .5 ? 3 : 4; }
        if (ph !== lastPhase) { lastPhase = ph; opts.onPhase(ph); }
      }
      if (running && visible && !reduce) raf = requestAnimationFrame(frame);
    }

    function kick() { if (!raf && running) { last = performance.now(); raf = requestAnimationFrame(frame); } }

    // drag to spin
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
    document.addEventListener('visibilitychange', function () { visible = !document.hidden; if (visible) kick(); });

    resize();
    if (reduce) frame(performance.now()); else kick();

    return {
      destroy: function () { running = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); }
    };
  }

  global.SCGGlobe = { mount: mount };
})(window);
