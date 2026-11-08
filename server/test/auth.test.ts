import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, Agent, json, PW } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => { ({ app } = await makeApp()); });
afterAll(async () => { await app.close(); });

describe('staff authentication', () => {
  it('the old default login admin / admin123 does not work', async () => {
    const r = await new Agent(app).post('/api/v1/admin/auth/login', { username: 'admin', password: 'admin123' });
    expect(r.statusCode).toBe(401);
  });
  it('owner can sign in; cookie is HttpOnly and path-scoped; no password or hash in the response', async () => {
    const a = new Agent(app);
    const r = await a.post('/api/v1/admin/auth/login', { username: 'owner1', password: PW });
    expect(r.statusCode).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/sc_staff=/); expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/Path=\/api\/v1\/admin/);
    expect(r.body).not.toMatch(/argon2|password_hash/);
    expect(json(r).csrfToken).toBeTruthy();
  });
  it('wrong password gives the same message as an unknown user', async () => {
    const a = await new Agent(app).post('/api/v1/admin/auth/login', { username: 'support1', password: 'wrong-password-123' });
    const b = await new Agent(app).post('/api/v1/admin/auth/login', { username: 'nobody-here', password: 'wrong-password-123' });
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(401);
    expect(json(a).message).toBe(json(b).message);
  });
  it('admin endpoints need a session', async () => {
    expect((await new Agent(app).get('/api/v1/admin/staff')).statusCode).toBe(401);
    expect((await new Agent(app).req('GET', '/api/v1/admin/staff', undefined, { cookie: 'sc_staff=forged-value' })).statusCode).toBe(401);
  });
  it('writes without the CSRF token are refused even with a valid session', async () => {
    const a = await new Agent(app).staffLogin('owner1');
    const r = await a.req('POST', '/api/v1/admin/staff', { username: 'x' }, { 'x-csrf-token': 'wrong' });
    expect(r.statusCode).toBe(403); expect(json(r).error).toBe('csrf');
  });
  it('logout ends the session on the server (old cookie stops working)', async () => {
    const a = await new Agent(app).staffLogin('owner1');
    const old = new Map(a.cookies);
    expect((await a.post('/api/v1/admin/auth/logout')).statusCode).toBe(200);
    const b = new Agent(app); b.cookies = old;
    expect((await b.get('/api/v1/admin/auth/session')).statusCode).toBe(401);
  });
  it('expired sessions are refused', async () => {
    const a = await new Agent(app).staffLogin('owner1');
    await app.db.query(`UPDATE staff_sessions SET expires_at = now() - interval '1 second' WHERE staff_id = (SELECT id FROM staff_users WHERE username = 'owner1')`);
    expect((await a.get('/api/v1/admin/auth/session')).statusCode).toBe(401);
  });
  it('locks the account after 5 wrong passwords (even with the right one afterwards)', async () => {
    const ip = '10.9.9.9';
    for (let i = 0; i < 5; i++) await new Agent(app, ip).post('/api/v1/admin/auth/login', { username: 'victim1', password: 'bad-password-' + i });
    const r = await new Agent(app, '10.9.9.10').post('/api/v1/admin/auth/login', { username: 'victim1', password: PW });
    expect(r.statusCode).toBe(429); expect(json(r).error).toBe('locked');
    const log = await app.db.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'auth.login_failed'`);
    expect(log.rows[0].n).toBeGreaterThanOrEqual(5);
  });
  it('rate-limits login attempts per IP (brute force)', async () => {
    const ip = '10.8.8.8'; let last = 0;
    for (let i = 0; i < 12; i++) last = (await new Agent(app, ip).post('/api/v1/admin/auth/login', { username: 'u' + i, password: 'x' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('role-based permissions (enforced on the server)', () => {
  it('support staff cannot manage staff', async () => {
    const a = await new Agent(app).staffLogin('support1');
    expect((await a.get('/api/v1/admin/staff')).statusCode).toBe(403);
  });
  it('owner can create staff; new staff must change the temporary password before anything else', async () => {
    const o = await new Agent(app).staffLogin('owner1');
    const weak = await o.post('/api/v1/admin/staff', { username: 'newbie', displayName: 'New', roles: ['support'], temporaryPassword: 'short' });
    expect(weak.statusCode).toBe(400);
    const r = await o.post('/api/v1/admin/staff', { username: 'newbie', displayName: 'New', roles: ['support'], temporaryPassword: 'Temporary-Pass-77' });
    expect(r.statusCode).toBe(200);
    const n = await new Agent(app).staffLogin('newbie', 'Temporary-Pass-77');
    expect((await n.get('/api/v1/admin/orders')).statusCode).toBe(403);
    expect((await n.post('/api/v1/admin/auth/password', { currentPassword: 'Temporary-Pass-77', newPassword: 'My-Own-Strong-Pass-1' })).statusCode).toBe(200);
  });
  it('the last owner cannot remove their own owner role', async () => {
    const o = await new Agent(app).staffLogin('owner1');
    const id = (await app.db.query(`SELECT id FROM staff_users WHERE username = 'owner1'`)).rows[0].id;
    expect((await o.put('/api/v1/admin/staff/' + id, { roles: ['support'] })).statusCode).toBe(400);
  });
});

describe('API hardening', () => {
  it('CORS only allows the configured website origin', async () => {
    const ok = await app.inject({ method: 'OPTIONS', url: '/api/v1/storefront', headers: { origin: 'http://shop.test', 'access-control-request-method': 'GET' } });
    const bad = await app.inject({ method: 'OPTIONS', url: '/api/v1/storefront', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://shop.test');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('security headers are set and admin responses are never cached', async () => {
    const a = await new Agent(app).staffLogin('owner1');
    const r = await a.get('/api/v1/admin/auth/session');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['content-security-policy'])).toMatch(/default-src 'none'/);
  });
  it('unknown fields and bad input are rejected with a readable message', async () => {
    const r = await new Agent(app).post('/api/v1/admin/auth/login', { username: 'owner1', password: PW, isAdmin: true });
    expect(r.statusCode).toBe(400);
  });
  it('health and readiness', async () => {
    expect(json(await app.inject({ url: '/health' }))).toEqual({ ok: true });
    expect(json(await app.inject({ url: '/ready' }))).toEqual({ ok: true, db: true });
  });
});
