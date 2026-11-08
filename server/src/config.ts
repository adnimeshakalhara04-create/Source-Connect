import { z } from 'zod';

// All configuration comes from environment variables (see server/.env.example).
// Secrets are never given defaults and never logged.
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // Comma separated list of browser origins allowed to call the API with cookies.
  CORS_ORIGINS: z.string().default('http://127.0.0.1:8000,http://localhost:8000'),
  // Public URL of the API (used for PayHere notify_url) and of the website (return/cancel URLs).
  PUBLIC_API_URL: z.string().url().default('http://127.0.0.1:8080'),
  PUBLIC_SITE_URL: z.string().url().default('http://127.0.0.1:8000'),
  // Set true when the API is served over HTTPS (cookies get the Secure flag).
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  // Cookies are shared between storefront/admin (site) and API when they share a parent domain (e.g. .example.lk).
  COOKIE_DOMAIN: z.string().optional(),
  // SameSite policy: 'strict' when site and API share a registrable domain, 'none' for cross-site dev setups.
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  STAFF_SESSION_HOURS: z.coerce.number().min(1).max(72).default(12),
  CUSTOMER_SESSION_DAYS: z.coerce.number().min(1).max(90).default(30),
  RESERVATION_MINUTES: z.coerce.number().int().min(5).max(240).default(30),         // card payments (PayHere)
  BANK_RESERVATION_HOURS: z.coerce.number().int().min(1).max(168).default(48),      // waiting for a bank transfer
  // PayHere (sandbox first). Secret is only read from the environment.
  PAYHERE_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYHERE_MERCHANT_ID: z.string().default(''),
  PAYHERE_MERCHANT_SECRET: z.string().default(''),
  PAYHERE_LIVE_APPROVED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  // Images
  UPLOAD_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  PUBLIC_UPLOAD_URL: z.string().default('/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  ENABLE_API_DOCS: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  BACKUP_MAX_AGE_HOURS: z.coerce.number().default(26),
  // checkout requests per IP per minute (raise only for load tests / drills on a private test server)
  ORDER_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(100000).default(10),
});

export type Config = z.infer<typeof Env> & { corsOrigins: string[]; apiDocs: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error('Invalid configuration: ' + msg);
  }
  const c = parsed.data;
  if (c.PAYHERE_MODE === 'live' && !c.PAYHERE_LIVE_APPROVED) {
    throw new Error('PAYHERE_MODE=live requires PAYHERE_LIVE_APPROVED=true (owner approval).');
  }
  if (c.NODE_ENV === 'production') {
    if (!c.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production.');
    if (c.COOKIE_SAMESITE === 'none' && !c.COOKIE_SECURE) throw new Error('SameSite=None needs Secure cookies.');
  }
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    apiDocs: c.ENABLE_API_DOCS ? c.ENABLE_API_DOCS === 'true' : c.NODE_ENV !== 'production',
  };
}
