// Measured load test of the API. Usage: node e2e/load/load-test.mjs <api-base> [seconds-per-scenario]
// The API must run with RATE_LIMIT_PER_MIN / ORDER_RATE_LIMIT_PER_MIN raised (one load generator = one IP).
import { createRequire } from 'node:module';
const autocannon = createRequire(import.meta.url)('../node_modules/autocannon');
const API = process.argv[2] || 'http://127.0.0.1:8085';
const SECS = Number(process.argv[3] || 20);
const run = (opts) => new Promise((res, rej) => autocannon({ duration: SECS, ...opts }, (e, r) => e ? rej(e) : res(r)));
const rows = [];
async function scenario(name, opts) {
  const { path, ...rest } = opts;
  const r = await run({ url: API + (path || ''), ...rest });
  const ok = r['2xx'], bad = r.non2xx + r.errors + r.timeouts;
  rows.push({ name, conns: opts.connections, rps: Math.round(r.requests.average), p50: r.latency.p50, p95: r.latency.p97_5 ?? r.latency.p95, p99: r.latency.p99, ok, errRate: ((bad / Math.max(1, ok + bad)) * 100).toFixed(2) + '%' });
  console.log(name, 'done');
}
const slugs = Array.from({ length: 12 }, (_, i) => ['mens', 'womens', 'shoes', 'electronics'][i % 4] + '-' + (1 + (i % 12)));
let n = 0;
await scenario('Storefront snapshot (whole catalogue, 140 KB)', { connections: 20, path: '/api/v1/storefront' });
await scenario('Product page', { connections: 50, requests: [{ setupRequest: req => ({ ...req, path: '/api/v1/products/' + slugs[n++ % slugs.length] }) }] });
await scenario('Search', { connections: 50, requests: [{ setupRequest: req => ({ ...req, path: '/api/v1/products?q=' + ['shirt', 'shoe', 'phone', 'bag', 'watch', 'dress'][n++ % 6] + '&limit=24' }) }] });
await scenario('Cart quote (server pricing)', { connections: 50, method: 'POST', path: '/api/v1/cart/quote', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ items: [{ id: 'mens-1', size: 'M', qty: 1 }, { id: 'electronics-2', size: '', qty: 1 }, { id: 'shoes-3', size: '40', qty: 2 }] }) });
let k = 0;
await scenario('Checkout: place COD orders, 30 buyers competing for the SAME 3 items', { connections: 30, method: 'POST', path: '/api/v1/orders', headers: { 'content-type': 'application/json' },
  requests: [{ setupRequest: req => ({ ...req, body: JSON.stringify({ items: [{ id: 'mens-1', size: 'M', qty: 1 }, { id: ['electronics-2', 'shoes-3', 'bags-1'][k % 3], size: k % 3 === 1 ? '40' : '', qty: 1 }],
    payment: 'cod', customer: { name: 'Load Test ' + (k++), phone: '0771234567', email: '', address: '1 Load Road', city: 'Colombo', district: 'Colombo', note: '' } }) }) }] });
console.table(rows);
console.log(JSON.stringify(rows));
