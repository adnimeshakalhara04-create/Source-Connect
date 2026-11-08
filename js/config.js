/* Where the shop's server (API) lives.
   Empty  = offline demo: data stays in this browser only (what GitHub Pages shows today).
   Set it = real shop: products, orders and admin edits are saved in the PostgreSQL database.
   Example for production:  var PRODUCTION_API = 'https://api.example.lk';
   On a developer machine (localhost only) a page can be pointed at a test server with ?api=http://127.0.0.1:8080 */
(function () {
  var PRODUCTION_API = '';
  var api = PRODUCTION_API;
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local) {   // never on the real website: a link must not be able to point customers at another server
    var m = /[?&]api=([^&#]+)/.exec(location.search), saved = null;
    try { saved = sessionStorage.getItem('scg_api'); } catch (e) {}
    var v = m ? decodeURIComponent(m[1]) : saved;
    if (v !== null && (v === '' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v))) {
      api = v;
      if (m) { try { sessionStorage.setItem('scg_api', v); } catch (e) {} }
    }
  }
  window.SCG_API = api;
})();
