import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STORE_JS = path.resolve(here, '../../../js/store.js');

/**
 * Runs the original js/store.js in an isolated VM with an empty fake localStorage
 * and returns its built-in seed catalogue (the curated demo catalogue shipped with the site).
 * Nothing from any real browser is read here.
 */
export function loadLegacySeed(file = STORE_JS): any {
  const code = fs.readFileSync(file, 'utf8');
  const mem = new Map<string, string>();
  const window: any = {
    localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) },
  };
  window.window = window;
  const ctx = vm.createContext({ window, localStorage: window.localStorage, console, Date, Math, JSON });
  vm.runInContext(code, ctx, { filename: 'store.js', timeout: 5000 });
  const SCG = window.SCG;
  if (!SCG || typeof SCG.load !== 'function') throw new Error('js/store.js did not define window.SCG');
  return JSON.parse(JSON.stringify(SCG.load()));
}

/** Internal departments and which legacy categories belong to each. */
export const SHOPS: { slug: string; name: string; categories: string[] }[] = [
  { slug: 'clothing', name: 'Clothing', categories: ['mens', 'womens', 'kids', 'sportswear', 'officewear', 'winter'] },
  { slug: 'shoes', name: 'Shoes', categories: ['shoes'] },
  { slug: 'bags', name: 'Bags & Wallets', categories: ['bags'] },
  { slug: 'accessories', name: 'Watches & Accessories', categories: ['watches', 'accessories'] },
  { slug: 'electronics', name: 'Electronics', categories: ['electronics', 'mobile'] },
];

export function skuFor(slug: string, size: string): string {
  const s = (slug + (size ? '-' + size : '')).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s.slice(0, 64);
}

/** Splits a legacy per-product stock number across sizes so the total stays the same. */
export function splitStock(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
