/* =========================================================
   Source Connect Global — Supabase backend adapter
   Maps the calls the existing website/admin make (SCG.api(method, path, body))
   onto Supabase: database functions (REST /rpc), Edge Functions, Auth and Storage.
   Only the public "anon" key is used here; secrets never reach the browser.
   No external libraries: plain fetch.
   ========================================================= */
(function (global) {
  'use strict';
  var cfg = global.SCG_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey) return;
  var URL_ = String(cfg.url).replace(/\/+$/, ''), ANON = cfg.anonKey;

  // ---------- sessions: customers stay signed in on this device; staff sessions end when the browser closes ----------
  var STORE = { customer: { area: 'localStorage', key: 'scg_sb_customer_v1' }, staff: { area: 'sessionStorage', key: 'scg_sb_staff_v1' } };
  function load(kind) { try { return JSON.parse(global[STORE[kind].area].getItem(STORE[kind].key) || 'null'); } catch (e) { return null; } }
  function save(kind, s) {
    try {
      if (!s) global[STORE[kind].area].removeItem(STORE[kind].key);
      else global[STORE[kind].area].setItem(STORE[kind].key, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)) }));
    } catch (e) {}
  }
  function err(status, code, message, data) { var e = new Error(message || 'Request failed'); e.status = status; e.code = code; e.data = data; return e; }
  function readJson(res) { return res.text().then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }); }

  function authFetch(path, body, token, method) {
    return fetch(URL_ + '/auth/v1' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'), cache: 'no-store',
      headers: { apikey: ANON, authorization: 'Bearer ' + (token || ANON), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return readJson(res).then(function (d) {
        if (!res.ok) throw err(res.status, (d && (d.error_code || d.error)) || 'auth_error', authMessage(d, res.status), d);
        return d;
      });
    }, function () { throw err(0, 'network', 'Cannot reach the shop server. Check your internet connection and try again.'); });
  }
  function authMessage(d, status) {
    var m = d && (d.msg || d.message || d.error_description) || '';
    if (/invalid login credentials/i.test(m)) return 'Incorrect email or password.';
    if (/already (been )?registered|already exists/i.test(m)) return 'An account with this email already exists. Please sign in.';
    if (/password/i.test(m) && status === 422) return 'Use at least 12 characters with letters and numbers.';
    if (status === 429) return 'Too many tries. Please wait a few minutes.';
    return m || 'Request failed (' + status + ')';
  }
  // valid access token for this kind of user (refreshes it when it is about to expire)
  function token(kind) {
    var s = load(kind);
    if (!s) return Promise.resolve(null);
    if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s.access_token);
    return authFetch('/token?grant_type=refresh_token', { refresh_token: s.refresh_token }).then(function (n) { save(kind, n); return n.access_token; },
      function () { save(kind, null); return null; });
  }
  function signIn(kind, email, password) {
    return authFetch('/token?grant_type=password', { email: email, password: password }).then(function (s) { save(kind, s); return s; });
  }
  function signOut(kind) {
    return token(kind).then(function (t) { save(kind, null); if (t) return authFetch('/logout', {}, t).catch(function () {}); });
  }

  // ---------- database functions and Edge Functions ----------
  function rpc(fn, args, kind) {
    return (kind ? token(kind) : Promise.resolve(null)).then(function (t) {
      return fetch(URL_ + '/rest/v1/rpc/' + fn, {
        method: 'POST', cache: 'no-store',
        headers: { apikey: ANON, authorization: 'Bearer ' + (t || ANON), 'content-type': 'application/json' },
        body: JSON.stringify(args || {})
      });
    }).then(function (res) {
      return readJson(res).then(function (d) {
        if (!res.ok) {
          var code = (d && d.hint) || (d && d.code === '42501' ? 'forbidden' : 'error');
          var st = { bad_request: 400, unauthorized: 401, forbidden: 403, mfa_required: 403, password_change_required: 403, not_found: 404, conflict: 409, stock_changed: 409, price_changed: 409, duplicate_order: 409 }[code] || res.status;
          var details; try { details = d && d.details ? JSON.parse(d.details) : undefined; } catch (e) { details = undefined; }
          throw err(st, code, (d && d.message) || 'Request failed', { error: code, message: d && d.message, details: details });
        }
        return d;
      });
    }, function (e) { if (e && e.status !== undefined) throw e; throw err(0, 'network', 'Cannot reach the shop server. Check your internet connection and try again.'); });
  }
  function edge(name, body, kind, headers) {
    return (kind ? token(kind) : Promise.resolve(null)).then(function (t) {
      var h = { apikey: ANON, authorization: 'Bearer ' + (t || ANON), 'content-type': 'application/json' };
      Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
      return fetch(URL_ + '/functions/v1/' + name, { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify(body || {}) });
    }).then(function (res) {
      return readJson(res).then(function (d) {
        if (!res.ok) throw err(res.status, d && d.error, (d && d.message) || 'Request failed', d);
        return d;
      });
    }, function (e) { if (e && e.status !== undefined) throw e; throw err(0, 'network', 'Cannot reach the shop server. Check your internet connection and try again.'); });
  }
  function uploadImage(file) {
    var ext = /png/.test(file.type) ? 'png' : /webp/.test(file.type) ? 'webp' : 'jpg';
    var d = new Date(), id = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    var key = 'products/' + d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + id + '.' + ext;
    return token('staff').then(function (t) {
      if (!t) throw err(401, 'unauthorized', 'Please sign in.');
      return fetch(URL_ + '/storage/v1/object/product-images/' + key, { method: 'POST', headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': file.type || 'image/jpeg', 'x-upsert': 'false' }, body: file });
    }).then(function (res) {
      return readJson(res).then(function (d) {
        if (!res.ok) throw err(res.status, 'upload_failed', (d && (d.message || d.error)) || 'The photo could not be uploaded (JPEG, PNG or WebP up to 4 MB).');
        return { url: URL_ + '/storage/v1/object/public/product-images/' + key, key: key };
      });
    });
  }

  // ---------- staff sign-in with MFA (two-step verification) ----------
  function renewalArgs(id, b) {
    b = b || {};
    return { p_id: id, p_name: b.name, p_provider: b.provider || '', p_due: b.dueOn || null, p_cycle: b.cycle,
             p_remind_days: b.remindDays === undefined || b.remindDays === '' ? 1 : Number(b.remindDays), p_note: b.note || '', p_active: b.active !== false };
  }
  function staffEmail(u) { u = String(u || '').trim(); return u.indexOf('@') > -1 ? u : u + '@staff.invalid'; }
  function me(kind) { return token(kind).then(function (t) { return t ? authFetch('/user', undefined, t) : null; }); }
  var mfa = {
    // returns {factors: [...verified TOTP factors]}
    status: function () { return me('staff').then(function (u) { return { factors: ((u && u.factors) || []).filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; }) }; }); },
    enroll: function () {
      return token('staff').then(function (t) { return authFetch('/factors', { factor_type: 'totp', friendly_name: 'Source Connect ' + new Date().toISOString().slice(0, 10) }, t); });
    },
    verify: function (factorId, code) {
      return token('staff').then(function (t) {
        return authFetch('/factors/' + factorId + '/challenge', {}, t).then(function (c) {
          return authFetch('/factors/' + factorId + '/verify', { challenge_id: c.id, code: String(code).replace(/\s/g, '') }, t);
        });
      }).then(function (s) { save('staff', s); return s; });
    }
  };

  // ---------- the router: old API paths -> Supabase ----------
  function q(path) { var i = path.indexOf('?'); var o = {}; if (i > -1) new URLSearchParams(path.slice(i + 1)).forEach(function (v, k) { o[k] = v; }); return o; }
  function m(re, path) { return re.exec(path.split('?')[0]); }
  function call(method, path, body, opts) {
    opts = opts || {};
    var x, qs = q(path);
    // ---- storefront ----
    if (path === '/storefront') return rpc('storefront_snapshot');
    if (path === '/cart/quote') return rpc('quote_cart', { p_items: body.items, p_coupon: body.coupon || null });
    if (path === '/orders') return edge('checkout', body, load('customer') ? 'customer' : null, opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {});
    if (path === '/orders/track') return edge('track-order', body);
    if (path === '/account/orders') return rpc('my_orders', {}, 'customer');
    if ((x = m(/^\/account\/orders\/([^/]+)$/, path))) return rpc('my_order', { p_number: decodeURIComponent(x[1]) }, 'customer').then(function (o) { if (!o) throw err(404, 'not_found', 'Order not found.'); return o; });
    if (path === '/customers/me' && method === 'GET') return token('customer').then(function (t) {
      if (!t) throw err(401, 'unauthorized', 'Please sign in to your account.');
      return rpc('my_profile', {}, 'customer').then(function (p) { if (!p) throw err(401, 'unauthorized', 'Please sign in to your account.'); return { customer: p }; });
    });
    if (path === '/customers/me' && method === 'PUT') return rpc('update_my_profile', { p_data: body }, 'customer');
    if (path === '/customers/login') return signIn('customer', body.email, body.password).then(function () { return call('GET', '/customers/me'); });
    if (path === '/customers/register') return authFetch('/signup', { email: body.email, password: body.password, data: { name: body.name, phone: body.phone || '' } })
      .then(function (s) { if (s && s.access_token) { save('customer', s); return call('GET', '/customers/me'); } return { customer: { name: body.name, email: body.email, verified: false, pendingConfirmation: true } }; });
    if (path === '/customers/logout') return signOut('customer').then(function () { return { ok: true }; });
    if (path === '/customers/password-reset/request') return authFetch('/recover?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { email: body.email }).then(function () { return { ok: true }; });
    if (path === '/customers/password-reset/confirm') return authFetch('/user', { password: body.password }, body.token, 'PUT').then(function () { return { ok: true }; });
    if (path === '/customers/verify-email') return Promise.resolve({ ok: true });   // Supabase confirms the email when the link is opened
    // ---- staff auth ----
    if (path === '/admin/auth/login') return signIn('staff', staffEmail(body.username), body.password).then(function () { return call('GET', '/admin/auth/session'); });
    if (path === '/admin/auth/session') return token('staff').then(function (t) {
      if (!t) throw err(401, 'unauthorized', 'Please sign in.');
      return rpc('admin_me', {}, 'staff').then(function (s) {
        return { staff: { username: s.username, displayName: s.displayName, roles: s.roles, permissions: s.permissions, mustChangePassword: !!s.mustChangePassword,
          needsMfa: !!(s.mfaRequired && s.aal !== 'aal2'), allShops: s.shops === null } };
      });
    });
    if (path === '/admin/auth/logout') return signOut('staff').then(function () { return { ok: true }; });
    if (path === '/admin/auth/password') return edge('admin-staff', { action: 'change-own-password', currentPassword: body.currentPassword, newPassword: body.newPassword }, 'staff');
    // ---- admin catalogue ----
    if (path === '/admin/state') return rpc('admin_state', {}, 'staff');
    if (path === '/admin/products' && method === 'POST') return rpc('admin_save_product', { p_slug: null, p_data: body }, 'staff');
    if ((x = m(/^\/admin\/products\/([^/]+)\/stock$/, path))) return rpc('admin_set_stock', { p_slug: decodeURIComponent(x[1]), p_stock: body.stock || null, p_total: body.total == null ? null : body.total, p_reorder: body.reorder || null, p_note: body.note || '' }, 'staff');
    if ((x = m(/^\/admin\/products\/([^/]+)\/stock-history$/, path))) return rpc('admin_stock_history', { p_slug: decodeURIComponent(x[1]) }, 'staff');
    if ((x = m(/^\/admin\/products\/([^/]+)$/, path))) return method === 'DELETE' ? rpc('admin_archive_product', { p_slug: decodeURIComponent(x[1]) }, 'staff')
      : rpc('admin_save_product', { p_slug: decodeURIComponent(x[1]), p_data: body }, 'staff');
    if (path === '/admin/categories-order') return rpc('admin_order_categories', { p_slugs: body.slugs }, 'staff');
    if ((x = m(/^\/admin\/categories\/([^/]+)$/, path))) return method === 'DELETE' ? rpc('admin_delete_category', { p_slug: decodeURIComponent(x[1]) }, 'staff')
      : rpc('admin_save_category', { p_slug: decodeURIComponent(x[1]), p_data: body }, 'staff');
    if ((x = m(/^\/admin\/collections\/([^/]+)$/, path))) return method === 'DELETE' ? rpc('admin_delete_collection', { p_slug: decodeURIComponent(x[1]) }, 'staff')
      : rpc('admin_save_collection', { p_slug: decodeURIComponent(x[1]), p_data: body }, 'staff');
    if (path === '/admin/settings') return rpc('admin_save_settings', { p_data: body }, 'staff');
    if (path === '/admin/banners') return rpc('admin_save_banners', { p_list: body }, 'staff');
    if (path === '/admin/uploads') return uploadImage(body.get('file'));
    // ---- admin orders ----
    if (m(/^\/admin\/orders$/, path)) return rpc('admin_orders', { p_status: qs.status || null, p_payment: qs.payment || null, p_review: qs.review === '1', p_q: qs.q || null, p_limit: +(qs.limit || 50), p_offset: +(qs.offset || 0) }, 'staff');
    if ((x = m(/^\/admin\/orders\/([^/]+)$/, path))) return rpc('admin_order', { p_number: decodeURIComponent(x[1]) }, 'staff');
    if ((x = m(/^\/admin\/orders\/([^/]+)\/(status|shipments|verify-bank-transfer|cod-collected|cancel|resolve-review)$/, path))) {
      var n = decodeURIComponent(x[1]);
      switch (x[2]) {
        case 'status': return rpc('admin_set_order_status', { p_number: n, p_status: body.status, p_note: body.note || '' }, 'staff');
        case 'shipments': return rpc('admin_add_shipment', { p_number: n, p_data: body }, 'staff');
        case 'verify-bank-transfer': return rpc('admin_verify_bank_transfer', { p_number: n, p_reference: body.reference, p_confirm_checked: body.confirmChecked === true }, 'staff');
        case 'cod-collected': return rpc('admin_cod_collected', { p_number: n }, 'staff');
        case 'cancel': return rpc('admin_cancel_order', { p_number: n, p_reason: body.reason, p_refund: body.refund || null }, 'staff');
        case 'resolve-review': return rpc('admin_resolve_review', { p_number: n, p_note: body.note }, 'staff');
      }
    }
    // ---- admin ops ----
    if (path === '/admin/dashboard') return rpc('admin_dashboard', {}, 'staff');
    if (m(/^\/admin\/customers$/, path)) return rpc('admin_customers', { p_q: qs.q || null, p_limit: +(qs.limit || 100), p_offset: +(qs.offset || 0) }, 'staff');
    if (m(/^\/admin\/audit$/, path)) return rpc('admin_audit', { p_before: qs.before ? +qs.before : null, p_action: qs.action || null, p_limit: +(qs.limit || 100) }, 'staff');
    if (path === '/admin/backups') return rpc('admin_backups', {}, 'staff');
    if (m(/^\/admin\/reports\/sales$/, path)) return rpc('admin_sales_report', { p_from: qs.from, p_to: qs.to }, 'staff');
    if (path === '/admin/product-costs') return rpc('admin_product_costs', {}, 'staff');
    if ((x = m(/^\/admin\/product-costs\/([^/]+)$/, path))) return rpc('admin_set_product_cost', { p_slug: decodeURIComponent(x[1]), p_cost: body.cost == null || body.cost === '' ? null : Number(body.cost), p_apply_to_past: body.applyToPast === true }, 'staff');
    if (path === '/admin/renewals' && method === 'GET') return rpc('admin_renewals', {}, 'staff');
    if (path === '/admin/renewals' && method === 'POST') return rpc('admin_save_renewal', renewalArgs(null, body), 'staff');
    if ((x = m(/^\/admin\/renewals\/([0-9a-f-]{36})$/, path))) return method === 'DELETE' ? rpc('admin_delete_renewal', { p_id: x[1] }, 'staff')
      : rpc('admin_save_renewal', renewalArgs(x[1], body), 'staff');
    if (path === '/admin/coupons' && method === 'GET') return rpc('admin_coupons', {}, 'staff');
    if (path === '/admin/coupons' && method === 'POST') return rpc('admin_create_coupon', { p_data: body }, 'staff');
    if ((x = m(/^\/admin\/coupons\/([^/]+)$/, path))) return rpc('admin_set_coupon_active', { p_id: x[1], p_active: !!body.active }, 'staff');
    if (path === '/admin/staff' && method === 'GET') return rpc('admin_staff_list', {}, 'staff');
    if (path === '/admin/staff' && method === 'POST') return edge('admin-staff', Object.assign({ action: 'create' }, body), 'staff');
    if ((x = m(/^\/admin\/staff\/([^/]+)$/, path))) return edge('admin-staff', Object.assign({ action: 'update', id: x[1] }, body), 'staff');
    return Promise.reject(err(404, 'not_found', 'Unknown request: ' + method + ' ' + path));
  }

  // Links from Supabase Auth emails land on the website with a session in the address (#access_token=...&type=...)
  function takeAuthRedirect() {
    var h = location.hash;
    if (!/access_token=/.test(h)) return null;
    var p = new URLSearchParams(h.replace(/^#/, ''));
    var s = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: +(p.get('expires_in') || 3600) };
    var type = p.get('type');
    if (type === 'recovery') { history.replaceState(null, '', location.pathname + location.search + '#reset/' + encodeURIComponent(s.access_token)); return 'recovery'; }
    save('customer', s);
    history.replaceState(null, '', location.pathname + location.search + '#account');
    return type || 'signin';
  }

  global.SCGSupabase = { call: call, rpc: rpc, edge: edge, mfa: mfa, signOut: signOut, token: token, url: URL_, takeAuthRedirect: takeAuthRedirect };
})(window);
