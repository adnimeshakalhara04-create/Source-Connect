import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { anon, staff, rpc } from './helpers.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Poster banners: a finished picture shown whole on the website. Ordinary ("card") banners are unchanged.
let editor: SupabaseClient, original: any[];
const save = (list: any[]) => rpc(editor, 'admin_save_banners', { p_list: list });

beforeAll(async () => {
  editor = await staff('editor1');   // catalog editor has content.write
  original = (await rpc(anon(), 'storefront_snapshot')).data.hero;
});
afterAll(async () => { await save(original); });

describe('poster banners', () => {
  it('existing banners are ordinary text banners', () => {
    expect(original.length).toBeGreaterThan(0);
    for (const h of original) expect(h.style).toBe('card');
  });

  it('a poster is saved with its picture and reaches the website in order', async () => {
    const poster = { id: 'p1111', title: '11:11 Special Offer', link: '#flash', image: 'https://example.com/offer-1111.webp', style: 'poster' };
    const r = await save([poster, ...original]); expect(r.error).toBeNull();
    const hero = (await rpc(anon(), 'storefront_snapshot')).data.hero;
    expect(hero[0]).toMatchObject({ id: 'p1111', style: 'poster', image: poster.image, title: '11:11 Special Offer', link: '#flash' });
    expect(hero.slice(1).map((h: any) => h.id)).toEqual(original.map(h => h.id));
  });

  it('refuses a poster without a picture, an unknown type and unsafe links', async () => {
    expect((await save([{ id: 'p2', title: 'x', style: 'poster', image: '' }])).error?.message).toMatch(/needs its picture/);
    expect((await save([{ id: 'p3', title: 'x', style: 'giant', image: 'https://e.com/a.png' }])).error).not.toBeNull();
    expect((await save([{ id: 'p4', title: 'x', style: 'poster', image: 'javascript:alert(1)' }])).error).not.toBeNull();
    expect((await save([{ id: 'p5', title: 'x', style: 'poster', image: 'https://e.com/a.png', link: 'javascript:alert(1)' }])).error).not.toBeNull();
  });

  it('only staff with content.write can change banners', async () => {
    for (const u of ['support1', 'fulfil1']) {
      const c = await staff(u);
      expect((await rpc(c, 'admin_save_banners', { p_list: original })).error?.code).toBe('42501');
    }
    expect((await rpc(anon(), 'admin_save_banners', { p_list: original })).error).not.toBeNull();
  });
});
