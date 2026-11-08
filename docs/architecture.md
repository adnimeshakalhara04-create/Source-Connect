# Architecture

```text
Customers + staff browsers
        │  HTTPS
Cloudflare DNS / TLS / WAF / CDN
        │
Cloudflare Pages ── static storefront  /        (index.html, js/, css/, assets/)
                └─ static admin        /admin/  (admin/)
        │  fetch() with credentials, CORS allowlist
api.<domain>  ── Caddy (TLS, HTTP/2, request size limits, access log)
        │
Node.js 22 LTS + TypeScript + Fastify  (server/, one modular monolith, stateless)
   ├─ /api/v1/*            public catalogue, cart quote, orders, tracking, customer auth
   ├─ /api/v1/admin/*      staff session + RBAC + CSRF, all admin edits, audit log
   ├─ /api/v1/payments/payhere/notify   server-to-server PayHere callback (md5sig verified)
   ├─ /health, /ready      liveness / readiness (DB ping, migrations applied)
   ├─ /docs                OpenAPI (Swagger UI; disabled in production by default)
   └─ jobs (in-process timers): expire stock reservations, backup-age check
        │  private socket / 127.0.0.1 only
PostgreSQL 16  (same VPS at first; listen_addresses = localhost)
        │  archive_command = pgbackrest archive-push
pgBackRest ── encrypted (aes-256-cbc) full / diff backups + WAL ─► private S3-compatible bucket (Cloudflare R2)
Product images ─► object storage bucket (served via CDN); separate rclone copy to a private backup bucket
```

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript (strict) | Supported LTS, one language with the frontend |
| Framework | Fastify 5 | Fast, small memory footprint on a 4 GB VPS, first-class schema validation, hooks for auth |
| DB access | `pg` with hand-written SQL plus a ~60-line migration runner (`server/src/db/migrate.ts`) | Every query and constraint is readable SQL a DBA can review. No ORM magic around locking (`SELECT … FOR UPDATE`) or money. Migrations are plain `.sql` files with checksums |
| Validation | Zod schemas on every request body and query | One place for limits and types; rejects unknown fields |
| Money | `bigint` **cents** (minor units) in DB and code | Never floating point. PayHere amounts are formatted from cents (`123450 → "1234.50"`) |
| IDs | `uuid` (`gen_random_uuid()`) primary keys plus human slugs/SKUs; public order number `SC-YYMMDD-XXXXXX` (random, unique) | Not guessable, and safe to show customers |
| Staff auth | Argon2id hashes, opaque random session ID in a `__Host-`-style HttpOnly, Secure, SameSite=Strict cookie, stored hashed in `staff_sessions`; CSRF double-submit token header on every mutation; login rate limit plus lockout | Server-side logout and expiry, no JWT revocation problem |
| Customer auth | Email + password (Argon2id) with email verification token; guest checkout gives a random **tracking token**, so the order number alone reveals nothing | Brief §D |
| Images | Stored as files/objects (`local` driver for dev, `s3` driver for R2), referenced by key; only URLs go to browsers | No base64 in PostgreSQL |
| Jobs | In-process interval jobs guarded by `pg_try_advisory_lock` | No Redis needed at launch, and safe if two API instances run later |
| Deploy | Docker Compose on the VPS (api + postgres + caddy), image tags pinned by git SHA | Reproducible, easy rollback |

## Frontend integration (keeping the original UI)

`js/app.js` and `admin/admin.js` were written against a synchronous in-memory object (`SCG.load()` returns the whole catalogue, and `SCG.save()` persists it). Rewriting about 2,000 lines of UI risked the design. Instead:

1. `js/api.js` (new) knows the API base URL (`window.SCG_API` in `js/config.js`). When it is empty, the site runs in its old offline demo mode, so GitHub Pages keeps working.
2. **Storefront:** before `app.js` boots, `SCG.ready` fetches `GET /api/v1/storefront` (a catalogue snapshot in the exact legacy shape: products with server prices and per-product available stock, categories, collections, banners, settings). The cart and wishlist stay in localStorage as a cache, but every cart view calls `POST /api/v1/cart/quote`, so prices, stock and shipping always come from the server. Checkout calls `POST /api/v1/orders`, and tracking or account pages call authenticated endpoints.
3. **Admin:** the login form calls `POST /api/v1/admin/auth/login`. After login, `GET /api/v1/admin/state` fills the same in-memory object. `SCG.save()` becomes a **sync adapter**: it diffs the object against the last server snapshot and sends only the changed entities to typed endpoints (`PUT /admin/products/:id`, `PUT /admin/settings`, …). The server validates and saves them, writes an audit log, and returns the new value. On error the admin shows the server's message and reloads the server state, so the browser can never be the source of truth.
4. Orders, customers, payments, staff, audit log and backups are new server-backed admin screens, or existing ones switched to API calls.

## Scaling path

- The API is stateless (sessions live in PostgreSQL), so a second API container behind Caddy works without code changes.
- PostgreSQL can move to its own VPS or a managed instance by changing `DATABASE_URL` and the pgBackRest stanza host.
- Later additions: Redis for rate limits and queues, read replicas for catalogue reads, and a warm standby (see `docs/backup-restore-runbook.md` §Standby). Replication never replaces backups.
