/* Every picture on the shop pages (products, banners, posters, categories, collections …) fades and rises in
   the first time it comes into view, after it has loaded. Pictures already on screen animate right away.
   - Only an entrance animation (fill-mode "backwards"): once it ends, the page's own styles apply again,
     so hover zooms and the second-photo swap on product cards keep working.
   - Never hides a picture for good: if this script is missing or fails, nothing is hidden (the hiding rule
     needs the class this script adds); a picture that fails to load is shown anyway.
   - Off for visitors who ask for less motion, and in very old browsers. */
(function () {
  var app = document.getElementById('app');
  if (!app || !('IntersectionObserver' in window) || !('MutationObserver' in window)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('ia-on');

  function show(img) {
    function go() { img.classList.add('ia-in'); }
    if (img.complete) go();
    else { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); }
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); show(e.target); } });
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0.01 });

  function tag(img) {
    if (img.classList.contains('ia') || img.classList.contains('alt')) return;   // .alt = second photo, shown only on hover
    img.classList.add('ia');
    io.observe(img);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') { tag(node); return; }
    var list = node.getElementsByTagName('img');
    for (var i = 0; i < list.length; i++) tag(list[i]);
  }
  scan(app);
  new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) scan(ms[i].addedNodes[j]);
  }).observe(app, { childList: true, subtree: true });
})();
