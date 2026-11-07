/* =========================================================
   Source Connect Global — cinematic welcome intro
   Plays when the site opens (once per visit by default), built
   from the brand logo: medallion emblem + wordmark over a globe.
   Settings live in admin → Homepage & Globe → Welcome intro.
   Force it with ?intro=1 in the address.
   ========================================================= */
(function (global) {
  'use strict';
  var SEEN = 'scg_intro_seen';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function shouldShow(w) {
    if (/[?&]intro=1/.test(location.search)) return true;
    if (!w || w.on === false || w.mode === 'off') return false;
    try {
      if (w.mode === 'visit') return true;
      if (w.mode === 'first') return !localStorage.getItem(SEEN);
      return !sessionStorage.getItem(SEEN);
    } catch (e) { return false; }
  }
  function markSeen() { try { sessionStorage.setItem(SEEN, '1'); localStorage.setItem(SEEN, '1'); } catch (e) {} }

  function show(opts) {
    opts = opts || {};
    var w = opts.welcome || {}, done = opts.onDone || function () {};
    var root = document.documentElement;
    if (!shouldShow(w)) { root.classList.remove('intro-on'); done(false); return; }
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var codes = (opts.origins || []).filter(function (o) { return o.on; }).map(function (o) { return o.code; });
    var sub = String(w.subtitle || '');

    var el = document.createElement('div');
    el.className = 'intro' + (reduce ? ' still' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Welcome to Source Connect Global');
    el.innerHTML =
      '<canvas class="in-globe" aria-hidden="true"></canvas><div class="in-vignette"></div><div class="in-grain"></div>' +
      '<div class="in-flare" aria-hidden="true"></div>' +
      '<div class="in-center">' +
        '<div class="in-emblem"><span class="in-ring r1"></span><span class="in-ring r2"></span><span class="in-halo"></span>' +
          '<img src="assets/intro-emblem.webp?v=1" alt="" width="260" height="260"><span class="in-shine"></span>' +
          '<span class="in-orbit">' + '<i></i>'.repeat(6) + '</span></div>' +
        '<p class="in-eyebrow">' + esc(w.eyebrow || 'Welcome to').split('').map(function (c, i) { return '<span style="--i:' + i + '">' + (c === ' ' ? '&nbsp;' : esc(c)) + '</span>'; }).join('') + '</p>' +
        '<img class="in-word" src="assets/intro-word.png?v=2" alt="Global Source Connect">' +
        (sub ? '<p class="in-sub">' + sub.split(' ').map(function (wd, i) { return '<span style="--i:' + i + '">' + esc(wd) + '</span>'; }).join(' ') + '</p>' : '') +
        (codes.length ? '<div class="in-route" aria-label="We import from ' + esc(codes.join(', ')) + ' to Sri Lanka">' + codes.map(function (c, i) { return '<b style="--i:' + i + '">' + esc(c) + '</b>'; }).join('') + '<i></i><b class="lk">LK</b></div>' : '') +
        '<button class="in-enter" type="button">' + esc(w.button || 'Enter the Store') + ' <span aria-hidden="true">→</span></button>' +
      '</div>' +
      '<div class="in-bar t"></div><div class="in-bar b"></div>' +
      '<button class="in-skip" type="button">Skip intro</button>';
    document.body.appendChild(el);
    root.classList.add('intro-on');

    var globe = null;
    if (global.SCGGlobe && !reduce) {
      try { globe = SCGGlobe.mount(el.querySelector('.in-globe'), { fit: true, labels: false, cities: opts.cities }); } catch (e) {}
    }
    // pointer parallax on the emblem
    function onMove(e) {
      var x = (e.clientX / innerWidth - .5), y = (e.clientY / innerHeight - .5);
      el.style.setProperty('--px', (x * 18).toFixed(1) + 'px'); el.style.setProperty('--py', (y * 14).toFixed(1) + 'px');
    }
    el.addEventListener('pointermove', onMove);

    var enter = el.querySelector('.in-enter'), leaving = false;
    setTimeout(function () { try { enter.focus({ preventScroll: true }); } catch (e) {} }, reduce ? 50 : 3400);
    function leave() {
      if (leaving) return; leaving = true;
      markSeen();
      el.classList.add('leaving');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () {
        if (globe) globe.destroy();
        el.remove(); root.classList.remove('intro-on');
        done(true);
      }, reduce ? 50 : 1150);
    }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); leave(); } }
    enter.onclick = leave;
    el.querySelector('.in-skip').onclick = leave;
    document.addEventListener('keydown', onKey);
  }

  global.SCGIntro = { show: show, shouldShow: shouldShow };
})(window);
