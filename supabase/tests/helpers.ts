import { inject } from 'vitest';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export const PW = 'Test-Password-2026!';
export const cfg = () => (inject as any)('cfg') as { url: string; anon: string; service: string; db: string };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const anon = () => createClient(cfg().url, cfg().anon, opts);
export const service = () => createClient(cfg().url, cfg().service, opts);
export async function staff(username: string): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: `${username}@staff.test`, password: PW });
  if (error) throw error;
  return c;
}
let n = 0;
export async function customer(name = 'Test Customer'): Promise<{ c: SupabaseClient; id: string; email: string }> {
  const c = anon(); const email = `cust-${Date.now()}-${n++}@example.com`;
  const { data, error } = await c.auth.signUp({ email, password: 'Customer-Pass-123', options: { data: { name } } });
  if (error) throw error;
  return { c, id: data.user!.id, email };
}
let pool: pg.Pool | null = null;
export const db = () => (pool ??= new pg.Pool({ connectionString: cfg().db, max: 30 }));
export const q1 = async (sql: string, args: unknown[] = []) => (await db().query(sql, args)).rows[0];
export async function rpc(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await c.rpc(fn, args);
  return { data, error, code: error?.hint || error?.code };
}
export const guest = { name: 'Nimal Perera', phone: '0771234567', email: 'nimal@example.com', address: '12 Temple Road', city: 'Kandy', district: 'Kandy', note: '' };
export const setStock = (sku: string, n: number) => db().query(`UPDATE app.inventory SET on_hand = $2, reserved = 0 FROM app.product_variants v WHERE v.id = inventory.variant_id AND v.sku = $1`, [sku, n]);
export const stock = (sku: string) => q1(`SELECT on_hand, reserved FROM app.inventory i JOIN app.product_variants v ON v.id = i.variant_id WHERE v.sku = $1`, [sku]);
export const order = (num: string) => q1(`SELECT status, payment_status, needs_review FROM app.orders WHERE order_number = $1`, [num]);
/** Places an order exactly as the checkout Edge Function does (service role). */
export async function placeOrder(items: any[], payment = 'cod', extra: Record<string, unknown> = {}, customerId: string | null = null, key: string | null = null) {
  return rpc(service(), 'place_order', { p_input: { items, customer: guest, payment, ...extra }, p_customer_id: customerId, p_idempotency_key: key });
}
