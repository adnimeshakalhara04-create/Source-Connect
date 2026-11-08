// node make-orders.mjs <api> <count> <merchantId> <secret> <tag> — places real orders through the API (COD, card + signed notify, bank transfer)
import crypto from 'node:crypto';
const [api, countS, mid, secret, tag] = process.argv.slice(2);
const md5U = s => crypto.createHash('md5').update(s).digest('hex').toUpperCase();
const post = async (p, body, h = {}) => { const r = await fetch(api + '/api/v1' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const products = ['mens-1:M', 'mens-2:L', 'womens-1:M', 'womens-4:S', 'kids-2:4-5Y', 'shoes-2:41', 'electronics-1:', 'mobile-3:', 'bags-1:', 'watches-2:'];
const pay = ['cod', 'payhere', 'bank_transfer'];
let made = 0;
for (let i = 0; i < Number(countS); i++) {
  const id = products[(i * 3 + tag.length) % products.length].split(':')[0];
  const prod = await (await fetch(api + '/api/v1/products/' + id)).json();
  const best = (prod.variants || []).slice().sort((a, b) => b.stock - a.stock)[0];
  if (!best || best.stock < 2) { console.log('skip', id, '(no stock)'); continue; }
  const size = best.size;
  const method = pay[i % pay.length];
  const r = await post('/orders', { items: [{ id, size, qty: 1 + (i % 2) }], payment: method,
    customer: { name: 'Drill Customer ' + tag + ' ' + i, phone: '07712345' + String(i).padStart(2, '0'), email: `drill${i}@example.com`, address: i + ' Drill Road', city: 'Colombo', district: 'Colombo', note: tag } });
  if (r.status !== 201) { console.log('order failed', r.status, JSON.stringify(r.j)); continue; }
  made++;
  if (method === 'payhere') {
    const f = r.j.payhere.fields;
    const body = new URLSearchParams({ merchant_id: mid, order_id: f.order_id, payment_id: String(Date.now()).slice(-9), payhere_amount: f.amount, payhere_currency: 'LKR', status_code: '2', md5sig: md5U(mid + f.order_id + f.amount + 'LKR' + '2' + md5U(secret)), method: 'VISA', card_no: '************4242' });
    const n = await fetch(api + '/api/v1/payments/payhere/notify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (n.status !== 200) console.log('notify failed', n.status);
  }
}
console.log(`${tag}: ${made} orders placed through the API`);
