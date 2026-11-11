import { describe, it, expect, beforeAll } from 'vitest';
import { anon, staff, rpc, q1, db, setStock, placeOrder } from './helpers.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Sales & profit report. Every expected number below is worked out by hand from the seed prices:
//   A = accessories-5, Rs 1,240.00 each, cost Rs 1,000.00 (set before the sales)
//   B = accessories-6, Rs 1,670.00 each, no cost price at first
//   C = accessories-7, only in a cancelled order
// Orders are moved to fixed past dates (Sri Lanka time) so other tests' orders never mix in.
const D = '2025-03-10', D1 = '2025-03-11', D2 = '2025-03-12';
const at = (num: string, iso: string) => db().query(`UPDATE app.orders SET placed_at = $2::timestamptz WHERE order_number = $1`, [num, iso]);
const shipping = async (num: string) => Number((await q1(`SELECT shipping_cents FROM app.orders WHERE order_number = $1`, [num])).shipping_cents) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
let owner: SupabaseClient;
const report = async (from: string, to: string, c: SupabaseClient = owner) => rpc(c, 'admin_sales_report', { p_from: from, p_to: to });
const o: Record<string, string> = {};

beforeAll(async () => {
  owner = await staff('owner1');
  for (const s of ['ACCESSORIES-5-M', 'ACCESSORIES-6-M', 'ACCESSORIES-7-M']) await setStock(s, 50);
  await db().query(`INSERT INTO app.coupons (code, kind, value) VALUES ('REPORT100', 'fixed', 10000) ON CONFLICT DO NOTHING`);   // Rs 100 off
  expect((await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-5', p_cost: 1000 })).error).toBeNull();
  const place = async (key: string, items: any[], pay = 'cod', extra = {}) => {
    const r = await placeOrder(items, pay, extra); expect(r.error).toBeNull(); o[key] = r.data.orderNumber;
  };
  const A = (qty: number) => ({ id: 'accessories-5', size: 'M', qty }), B = (qty: number) => ({ id: 'accessories-6', size: 'M', qty });
  await place('o1', [A(2)]);                                         // D 10:00 Colombo
  await place('o2', [A(1), B(1)], 'cod', { coupon: 'REPORT100' });   // D 23:30 Colombo = D 18:00 UTC
  await place('o3', [B(1)]);                                         // D+1 00:15 Colombo = D 18:45 UTC (same UTC day!)
  await place('o4', [{ id: 'accessories-7', size: 'M', qty: 1 }]);   // cancelled -> not a sale
  await place('o5', [A(1)], 'payhere');                              // card checkout never paid -> not a sale
  await at(o.o1, `${D}T10:00:00+05:30`); await at(o.o2, `${D}T23:30:00+05:30`); await at(o.o3, `${D1}T00:15:00+05:30`);
  await at(o.o4, `${D}T12:00:00+05:30`); await at(o.o5, `${D}T13:00:00+05:30`);
  expect((await rpc(owner, 'admin_cancel_order', { p_number: o.o4, p_reason: 'customer changed mind' })).error).toBeNull();
  await db().query(`UPDATE app.orders SET payment_status = 'cod_collected' WHERE order_number = $1`, [o.o1]);   // cash received for o1
});

describe('sales & profit report', () => {
  it('one day: sales, coupon, shipping, received, best seller; cancelled and unpaid card orders left out', async () => {
    const r = await report(D, D); expect(r.error).toBeNull();
    const s = r.data.summary, s1 = await shipping(o.o1), s2 = await shipping(o.o2);
    expect(s.orders).toBe(2);
    expect(s.units).toBe(4);
    expect(s.itemSales).toBe(5390);            // 2×1240 + 1240 + 1670
    expect(s.discounts).toBe(100);
    expect(s.netSales).toBe(5290);
    expect(s.shipping).toBe(r2(s1 + s2));
    expect(s.total).toBe(r2(5290 + s1 + s2));
    expect(s.received).toBe(r2(2480 + s1));    // only o1's cash was collected
    expect(s.toCollect).toBe(r2(2810 + s2));
    expect(s.closedOrders).toBe(1); expect(s.unpaidCardOrders).toBe(1);
    // B has no cost: no made-up profit, but the profit on items that have a cost is shown
    expect(s.costMissingUnits).toBe(1); expect(s.profit).toBeNull(); expect(s.cost).toBeNull();
    expect(s.profitOnItemsWithCost).toBe(720); // 3 × (1240 − 1000)
    expect(r.data.days).toHaveLength(1);
    expect(r.data.days[0]).toMatchObject({ day: D, orders: 2, units: 4, netSales: 5290, best: { slug: 'accessories-5', units: 3 } });
    expect(r.data.topProducts[0]).toMatchObject({ slug: 'accessories-5', units: 3, sales: 3720, cost: 3000, profit: 720, marginPercent: 19.4 });
    expect(r.data.topProducts[1]).toMatchObject({ slug: 'accessories-6', units: 1, sales: 1670, profit: null, costMissingUnits: 1 });
  });

  it('days follow Sri Lanka time: an order at 00:15 belongs to the next day', async () => {
    const r = await report(D, D1); const d = r.data.days;
    expect(d.map((x: any) => x.day)).toEqual([D, D1]);
    expect(d[1]).toMatchObject({ orders: 1, units: 1, netSales: 1670, best: { slug: 'accessories-6', units: 1 } });
    expect(r.data.summary).toMatchObject({ orders: 3, units: 5, itemSales: 7060 });
  });

  it('least sold lists products on sale with the fewest units (0 = not sold), cancelled sales do not count', async () => {
    const r = await report(D, D);
    const active = Number((await q1(`SELECT count(*) n FROM app.products WHERE status = 'active'`)).n);
    expect(r.data.notSoldCount).toBe(active - 2);   // C was only in a cancelled order
    expect(r.data.leastSold).toHaveLength(10);
    expect(r.data.leastSold.every((x: any) => x.units === 0 && x.sales === 0)).toBe(true);
    expect(r.data.leastSold.map((x: any) => x.slug)).not.toContain('accessories-5');
  });

  it('cost at the time of sale is kept; filling a missing cost later completes the profit', async () => {
    // A's cost goes up: earlier A sales keep Rs 1,000 (nothing to fill, they already had a cost)
    const a = await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-5', p_cost: 1500, p_apply_to_past: true });
    expect(a.data).toMatchObject({ cost: 1500, appliedToEarlierSaleLines: 0 });
    // B gets a cost and the owner applies it to B's earlier sales (o2 and o3)
    const b = await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-6', p_cost: 1200, p_apply_to_past: true });
    expect(b.error).toBeNull();
    expect(b.data).toMatchObject({ cost: 1200, appliedToEarlierSaleLines: 2 });
    const s = (await report(D, D)).data.summary;
    expect(s.costMissingUnits).toBe(0);
    expect(s.cost).toBe(4200);                 // 3×1000 + 1200
    expect(s.profit).toBe(1090);               // 5290 − 4200 (coupon counted once, on the order)
    expect(s.marginPercent).toBe(20.6);        // 1090 / 5290
    expect(s.profitOnItemsWithCost).toBe(1190);// before the coupon: 720 + 470
    // applying a different cost again never overwrites a cost already filled in for those sales
    const again = await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-6', p_cost: 999, p_apply_to_past: true });
    expect(again.data).toMatchObject({ cost: 999, appliedToEarlierSaleLines: 0 });
    expect((await report(D, D)).data.summary.profit).toBe(1090);
    expect((await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-6', p_cost: 1200 })).error).toBeNull();
    // a new sale uses the NEW cost and can show a loss
    const n = await placeOrder([{ id: 'accessories-5', size: 'M', qty: 1 }], 'cod'); expect(n.error).toBeNull();
    await at(n.data.orderNumber, `${D2}T09:00:00+05:30`);
    const s3 = (await report(D2, D2)).data.summary;
    expect(s3).toMatchObject({ orders: 1, netSales: 1240, cost: 1500, profit: -260, marginPercent: -21 });
  });

  it('only owner and finance see reports; only the owner sets costs; every change is in the audit log', async () => {
    const fin = await staff('finance1');
    expect((await report(D, D, fin)).error).toBeNull();
    expect((await rpc(fin, 'admin_product_costs')).error).toBeNull();
    expect((await rpc(fin, 'admin_set_product_cost', { p_slug: 'accessories-5', p_cost: 1 })).error?.code).toBe('42501');
    for (const u of ['support1', 'editor1', 'fulfil1', 'shoesguy']) {
      const c = await staff(u);
      expect((await report(D, D, c)).error?.code).toBe('42501');
      expect((await rpc(c, 'admin_product_costs')).error?.code).toBe('42501');
    }
    expect((await report(D, D, anon())).error).not.toBeNull();
    const a = (await db().query(`SELECT actor_label, before, after FROM app.audit_logs WHERE action = 'product.cost' AND entity_id = 'accessories-6' ORDER BY created_at, id`)).rows;
    expect(a.map((x: any) => [x.before.cost, x.after.cost, x.after.appliedToEarlierSaleLines])).toEqual([[null, 1200, 2], [1200, 999, 0], [999, 1200, 0]]);
    expect(a.every((x: any) => x.actor_label === 'owner1')).toBe(true);
  });

  it('cost prices never reach the website or staff without the reports permission', async () => {
    const costs = (await rpc(owner, 'admin_product_costs')).data;
    expect(costs.find((x: any) => x.slug === 'accessories-6')).toMatchObject({ cost: 1200, price: 1670 });
    const pub = JSON.stringify([(await rpc(anon(), 'storefront_snapshot')).data, (await rpc(anon(), 'get_product', { p_slug: 'accessories-6' })).data]);
    expect(pub).not.toMatch(/cost/i);
    const ed = JSON.stringify((await rpc(await staff('editor1'), 'admin_state')).data);
    expect(ed).not.toMatch(/cost/i);
    const ord = JSON.stringify((await rpc(owner, 'admin_order', { p_number: o.o2 })).data);
    expect(ord).not.toMatch(/cost/i);
    // the table itself is not reachable through the REST API
    const { error } = await anon().schema('app' as any).from('product_costs').select('*');
    expect(error).not.toBeNull();
  });

  it('leaves stock consistent: reserved units = active reservations for every size', async () => {
    const bad = await q1(`SELECT count(*)::int n FROM app.inventory i WHERE i.reserved <> coalesce((SELECT sum(r.quantity) FROM app.stock_reservations r WHERE r.variant_id = i.variant_id AND r.state = 'active'), 0)
                            AND i.variant_id IN (SELECT v.id FROM app.product_variants v JOIN app.products p ON p.id = v.product_id WHERE p.slug LIKE 'accessories-%')`);
    expect(bad.n).toBe(0);
  });

  it('refuses bad input', async () => {
    expect((await report(D1, D)).code).toBe('bad_request');
    expect((await report('2024-01-01', '2025-01-02')).code).toBe('bad_request');   // more than a year
    for (const bad of [-1, 10.555, 20000000]) expect((await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-5', p_cost: bad })).code).toBe('bad_request');
    expect((await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-5', p_cost: null, p_apply_to_past: true })).code).toBe('bad_request');
    expect((await rpc(owner, 'admin_set_product_cost', { p_slug: 'no-such-product', p_cost: 5 })).code).toBe('not_found');
    // clearing a cost works and is not applied to anything
    const cl = await rpc(owner, 'admin_set_product_cost', { p_slug: 'accessories-7', p_cost: null });
    expect(cl.data).toMatchObject({ cost: null, appliedToEarlierSaleLines: 0 });
  });
});
