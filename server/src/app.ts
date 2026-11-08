import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { HttpError } from './lib/errors.js';
import { pendingMigrations } from './db/migrate.js';
import publicCatalog from './routes/public/catalog.js';
import { invalidateStorefront } from './catalog.js';
import adminAuth from './routes/admin/auth.js';
import adminStaff from './routes/admin/staff.js';
import publicOrders from './routes/public/orders.js';
import customers from './routes/public/customers.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import adminCatalog from './routes/admin/catalog.js';
import adminContent from './routes/admin/content.js';
import adminOrders from './routes/admin/orders.js';
import adminOps from './routes/admin/ops.js';
import adminUploads, { serveLocalUploads } from './routes/admin/uploads.js';

declare module 'fastify' {
  interface FastifyInstance { db: Pool; config: Config; mailer: Mailer }
}

export interface Extra { register?: (app: FastifyInstance) => Promise<void> | void }

export async function buildApp(cfg: Config, db: Pool, extra: Extra = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 1_000_000,
    genReqId: () => crypto.randomUUID(),
    logger: cfg.LOG_LEVEL === 'silent' ? false : {
      level: cfg.LOG_LEVEL,
      // never log cookies, auth headers, passwords, card data or PayHere signatures
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', '*.password', '*.md5sig', '*.card_no'], censor: '[redacted]' },
    },
  });
  app.decorate('db', db);
  app.decorate('config', cfg);
  app.decorate('mailer', createMailer(cfg.NODE_ENV, app.log));

  await app.register(helmet, {
    // The API only returns JSON: forbid everything for any HTML that might slip through.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // uploaded images are shown on the website
    hsts: cfg.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                       // server-to-server (PayHere notify, curl)
      cb(null, cfg.corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(formbody, { bodyLimit: 20_000 });          // PayHere notify is x-www-form-urlencoded
  await app.register(rateLimit, { global: true, max: cfg.RATE_LIMIT_PER_MIN, timeWindow: '1 minute' });

  if (cfg.apiDocs) {
    await app.register(swagger, { openapi: { info: { title: 'Source Connect Global API', version: '1.0.0', description: 'Storefront, admin and PayHere endpoints. All admin writes need the x-csrf-token header.' } } });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' });
    if (err.validation || err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err instanceof SyntaxError)
      return reply.status(400).send({ error: 'bad_request', message: 'The request could not be read.' });
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.status(413).send({ error: 'too_large', message: 'The request is too large.' });
    // PostgreSQL constraint errors -> safe client messages
    if (err.code === '23505') return reply.status(409).send({ error: 'conflict', message: 'That already exists (it must be unique).' });
    if (err.code === '23503') return reply.status(400).send({ error: 'bad_reference', message: 'Something this refers to does not exist or is still in use.' });
    if (err.code === '23514' || err.code === '22P02' || err.code === '22003') return reply.status(400).send({ error: 'invalid', message: 'A value is out of the allowed range.' });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong on our side. Please try again.', requestId: req.id });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Not found.' }));

  // ---- health ----
  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get('/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      const pending = await pendingMigrations(db);
      if (pending.length) return reply.status(503).send({ ok: false, db: true, pendingMigrations: pending });
      return { ok: true, db: true };
    } catch {
      return reply.status(503).send({ ok: false, db: false });
    }
  });

  if (cfg.UPLOAD_DRIVER === 'local') await app.register(serveLocalUploads);

  await app.register(async v1 => {
    await v1.register(publicCatalog);
    await v1.register(publicOrders);
    await v1.register(customers);
    await v1.register(async admin => {
      // never cache anything private
      admin.addHook('onSend', async (_req, reply) => { reply.header('cache-control', 'no-store'); });
      // any successful change by staff makes the cached storefront stale
      admin.addHook('onSend', async (req, reply) => { if (req.method !== 'GET' && reply.statusCode < 400) invalidateStorefront(); });
      await admin.register(adminAuth);
      await admin.register(adminStaff);
      await admin.register(adminCatalog);
      await admin.register(adminContent);
      await admin.register(adminOrders);
      await admin.register(adminOps);
      await admin.register(adminUploads);
      if (extra.register) await extra.register(admin);
    }, { prefix: '/admin' });
  }, { prefix: '/api/v1' });

  return app;
}
