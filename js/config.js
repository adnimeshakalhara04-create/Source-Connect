/* Where the shop's backend lives.
   Nothing set      = offline demo: data stays in this browser only (what GitHub Pages shows today).
   PRODUCTION_SUPABASE = the real shop on Supabase (recommended): { url: 'https://<project>.supabase.co', anonKey: '<public anon key>' }
     The anon key is PUBLIC by design (it is in every visitor's browser); all protection is on the server
     (database permissions, MFA, Edge Functions). NEVER put the service_role key or any secret here.
   PRODUCTION_API = the older self-hosted API (branch claude/fullstack-backend), kept for comparison.
   On a developer machine (localhost only) a page can be pointed at a local stack with
     ?supabase=http://127.0.0.1:54321&anon=<local anon key>   or   ?api=http://127.0.0.1:8080 */
(function () {
  var PRODUCTION_SUPABASE = { url: 'https://nuqmaiybqmuvtfnjdzvn.supabase.co', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51cW1haXlicW11dnRmbmpkenZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0Njg2MjcsImV4cCI6MjExMDA0NDYyN30.dDmFoURtnXAUSAJCVQ2W3ZsMHNgp-wdjYdHX_4-MwX8' };   // public anon key (safe in the browser)
  var PRODUCTION_API = '';
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // a developer machine or a test run never talks to the real shop database (tests must not create real orders)
  var sb = PRODUCTION_SUPABASE.url && !local ? PRODUCTION_SUPABASE : null, api = local ? '' : PRODUCTION_API;
  if (local) {   // never on the real website: a link must not be able to point customers at another server
    var get = function (k) { var m = new RegExp('[?&]' + k + '=([^&#]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; };
    var store = function (k, v) { try { if (v === null) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); return v; } catch (e) { return v; } };
    var lsb = store('scg_sb_url', get('supabase')), lanon = store('scg_sb_anon', get('anon'));
    if (lsb && lanon && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(lsb)) sb = { url: lsb, anonKey: lanon };
    var la = store('scg_api', get('api'));
    if (la !== null && (la === '' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(la))) api = la;
  }
  window.SCG_SUPABASE = sb;
  window.SCG_API = sb ? '' : api;
})();
