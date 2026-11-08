import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireStaff, actorOf } from '../../auth/staff.js';
import { badRequest, HttpError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import type { Config } from '../../config.js';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Detects the real image type from the first bytes (the browser-supplied name/type is not trusted). SVG is refused (can carry scripts). */
export function sniffImage(b: Buffer): { ext: string; type: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

export interface Storage { put(key: string, body: Buffer, type: string): Promise<string> }
export function createStorage(cfg: Config): Storage {
  if (cfg.UPLOAD_DRIVER === 's3') {
    if (!cfg.S3_BUCKET || !cfg.S3_ENDPOINT || !cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY) throw new Error('UPLOAD_DRIVER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
    const s3 = new S3Client({ region: cfg.S3_REGION, endpoint: cfg.S3_ENDPOINT, credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY } });
    return {
      async put(key, body, type) {
        await s3.send(new PutObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key, Body: body, ContentType: type, CacheControl: 'public, max-age=31536000, immutable' }));
        return cfg.PUBLIC_UPLOAD_URL.replace(/\/$/, '') + '/' + key;
      },
    };
  }
  const root = path.resolve(cfg.UPLOAD_DIR);
  return {
    async put(key, body) {
      const file = path.join(root, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body, { flag: 'wx' });
      return cfg.PUBLIC_UPLOAD_URL.replace(/\/$/, '') + '/' + key;
    },
  };
}

export default async function adminUploads(app: FastifyInstance) {
  const db = app.db, cfg = app.config;
  const storage = createStorage(cfg);
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2 } });

  app.post('/uploads', { preHandler: requireStaff(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['admin-uploads'], summary: 'Upload one product/banner image (JPEG, PNG or WebP, max 4 MB)' } }, async (req) => {
    const p = req.staff!.permissions;
    if (!p.has('catalog.write') && !p.has('content.write')) throw new HttpError(403, 'forbidden', 'You cannot upload images.');
    const file = await req.file();
    if (!file) throw badRequest('Choose an image file.');
    const buf = await file.toBuffer().catch(() => { throw new HttpError(413, 'too_large', 'The image is larger than 4 MB.'); });
    if (file.file.truncated) throw new HttpError(413, 'too_large', 'The image is larger than 4 MB.');
    const kind = sniffImage(buf);
    if (!kind) throw badRequest('Only JPEG, PNG or WebP images are allowed.');
    const d = new Date();
    const key = `products/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${kind.ext}`;
    const url = await storage.put(key, buf, kind.type);
    await audit(db, actorOf(req), 'upload.image', 'upload', key, undefined, { bytes: buf.length, type: kind.type });
    return { url, key, bytes: buf.length, type: kind.type };
  });
}

/** Development only: serve local uploads from the API (production: Caddy/CDN serves them). */
export async function serveLocalUploads(app: FastifyInstance) {
  const root = path.resolve(app.config.UPLOAD_DIR);
  app.get('/uploads/*', { config: { rateLimit: false } }, async (req, reply) => {
    const rel = String((req.params as any)['*'] || '');
    if (!/^[a-z0-9/_-]+\.(jpg|png|webp)$/i.test(rel) || rel.includes('..')) return reply.status(404).send();
    try {
      const buf = await fs.readFile(path.join(root, rel));
      const k = sniffImage(buf);
      if (!k) return reply.status(404).send();
      reply.header('content-type', k.type).header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff');
      return buf;
    } catch { return reply.status(404).send(); }
  });
}
