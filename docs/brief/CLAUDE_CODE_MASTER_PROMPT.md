# SOURCE CONNECT GLOBAL — CLAUDE CODE MASTER IMPLEMENTATION BRIEF

**Project:** Source Connect Global — Sri Lankan single-vendor, multi-department e-commerce store  
**Repository:** https://github.com/adnimeshakalhara04-create/Source-Connect  
**Project status verified from GitHub:** static HTML/CSS/JS storefront and Seller Center admin panel, with browser-local data and browser-side admin login. **Not production ready.**  
**Read and inspect the repo before writing code.** Current default branch at the time this brief was written: `claude/meka-admin-panel-website-gu6dxg`; verify the latest branch and HEAD. Do not assume anything here is still current.

## Your role and delivery rule

Act as senior full-stack engineer, PostgreSQL DBA, security engineer, SRE/DevOps engineer, and QA lead. **Implement and test actual code**, not just outline a hypothetical system, as far as your execution environment and authorized access permit. Preserve the existing branding, homepage/cinematic globe, navigation, responsive layout, shop categories, product cards, admin visual editor and order-management UX. Prefer incremental integration over a wholesale rewrite.

Use a new feature branch and small reviewable commits, then create a pull request when authorized; **do not replace/delete existing website assets, reset real data, force-push, buy paid services, or deploy live payment processing without explicit permission.** If infrastructure credentials/accounts are missing, provide completed code/config templates, local tests, and the exact next human actions. Never claim production readiness without passing acceptance checks and a restore drill.

**Business model (non-negotiable):** This is NOT an open Daraz-style multi-vendor marketplace. Source Connect is one merchant/company; its own staff operate departments or shops such as Clothing, Electronics, Shoes, Bags, Accessories. Customers check out through one company/merchant account. No public seller registration, seller wallets, commissions or third-party seller payouts. Use `shops` only for internal organizational and reporting boundaries; a single checkout can contain products across internal shops.

**Owner constraints:** Limited budget (original budget ~LKR 60,000, some already spent on AI tools), PayHere Plus planned (~LKR 3,990/month, subject to current official pricing). VPS option being considered from PXN is advertised as Linux 2 vCPU, 4GB RAM, 80GB NVMe, LKR 1,100/50 days. **These are unverified offer terms, not confirmed renewal rates, performance or SLA.** Do not purchase yet. Avoid two VPSs at launch solely for backups; use one primary VPS plus independent off-site encrypted backup storage, then add a true standby at scale.

## A. First: audit and preserve the original project

1. Inspect `README.md`, `index.html`, `js/store.js`, `js/app.js`, `js/globe.js`, `js/globe-data.js`, `admin/index.html`, `admin/admin.js`, styles and any existing tests/deployment workflows. List the current actual file structure, routes, controls and data shapes. The README reports localStorage plus default admin `admin / admin123`; verify actual implementation, remove unsafe client-only authorization in production, and never let this default account survive production migration.
2. Generate `docs/current-state-audit.md` describing functional features, missing server-side components, attack surfaces, dependencies, migration risks and broken/placeholder flows. The fact that UI features exist does not mean they work across devices.
3. Capture baseline screenshots or equivalent visual regression snapshots (desktop and mobile) of storefront, product page, checkout, account/order tracking, admin dashboard, products, orders, visual editor, banners/globe settings. Save reproducible tests.
4. Document existing localStorage keys/data schema and create a safe import path for curated product/catalog data only. Do not automatically trust or import browser-local ‘paid’ orders or admin user accounts as legitimate production records.
5. Keep original URL semantics and design when feasible. Server migration will require changing more than `js/store.js` because both `js/app.js` and `admin/admin.js` call synchronous `SCG.load()` and write local state. Plan an async API-based state layer and update dependent code carefully.

## B. Target architecture (budget-aware, scalable)

```text
Customers + internal staff web browsers
       |
Cloudflare DNS / TLS / WAF / CDN
       |
Cloudflare Pages -> existing static storefront + /admin interface
       |
api.<domain> (HTTPS, rate-limited, authenticated)
       |
Linux VPS: Caddy or Nginx reverse proxy + Node.js LTS/TypeScript API
       |                  |
       |                  +--> PayHere Checkout & server-to-server notify endpoint
       |                  +--> background jobs / email alerts
       |
PostgreSQL (same VPS only for initial small-load stage, private bind)
       |
pgBackRest: full/differential backups + continuously archived WAL
       |
Private, encrypted, separate off-site S3-compatible backup store (e.g. Cloudflare R2)

Product images -> separate storage bucket/origin, CDN served, not stored as giant base64 in PostgreSQL.
Product-image BACKUPS -> separate private destination/policy; DB backup alone does not back up object storage.
```

Start with an economical modular monolith, not microservices. Recommend a supported Node.js LTS + TypeScript + Fastify, `pg`/typed SQL migrations or Drizzle (choose one and explain rationale), Zod request validation, structured logging, secure cookie session or equivalent server-based authentication, and PostgreSQL. Containerize if it reduces operational complexity without jeopardizing 4GB VPS memory. Use a supported PostgreSQL major release. Define `/api/v1`, health/readiness endpoints, environment-specific settings, immutable deployment images/tags, zero-downtime compatible migrations and graceful shutdown. Plan stateless APIs, externalized file storage and a later independent DB tier to allow horizontal scaling.

Server purchases, DNS registration, paid plan activation and live credential configuration require owner approval. If provider has unconfirmed root/SSH control, backup features, storage IOPS or renewal pricing, give a validation checklist rather than assume it works.

## C. Complete PostgreSQL data design

Create actual version-controlled SQL migrations, indexes, foreign keys, constraints, seed scripts and ER diagram. Normalize critical business data and include created/updated timestamps, audit history, pagination keys and status indexes. Use UUID/ULID IDs (or consistent database IDs); money must be `numeric(12,2)` or integer minor units, **never floating-point totals**. All server-side prices and discounts must be authoritative.

Minimum entities/fields/relationships:

- `shops` (internal departments only: name, slug, status, sort order, staff assignments)
- `categories` (hierarchy, slug, images, shop mapping)
- `products` (slug, SKU/product family, title, description, import country, China-Direct/local status, publish state, SEO metadata)
- `product_variants` (product ID, unique SKU, sizes, colors, option values, active state, unit price/currency)
- `product_images` (object key, alt text, sort order, variants, CDN URL derivative logic)
- `inventory` (variant ID, on-hand quantity, reserved quantity, reorder threshold, warehouse/location, constraints)
- `inventory_movements` (adjustment events, actor, reason, order/return reference; immutable audit trail)
- `customers` and `customer_auth_identities` (verified identity where applicable; guest customers supported)
- `customer_addresses` (shipping/billing) and normalized Sri Lankan districts
- `carts`, `cart_items` (cart can be ephemeral; never trust browser price or stock)
- `orders` (public order number, customer or guest token, currency, address snapshots, subtotal, discount, shipping, final amount, order/payment/fulfilment statuses)
- `order_items` (immutable purchase-time snapshot of product name, SKU, unit price, quantity, shop, tax/discount)
- `stock_reservations` (order, variant, quantity, expiration, released/consumed state)
- `payments` (gateway name, unique provider payment ID, merchant order ref, expected amount/currency, status, paid time, no full card data)
- `payment_events` (dedupe IDs, verified status, sanitized payload metadata, arrival time, processing result)
- `shipments`, `shipment_events` (carrier/tracking, country of origin, local dispatch, delivered events)
- `coupons`, `coupon_redemptions`, `collections`, `collection_products`, `flash_sale_rules`
- `staff_users`, `roles`, `permissions`, `staff_shop_access`, `admin_sessions` or equivalent session records
- `site_content`, `banners`, `globe_settings`, `shipping_rates`, `payment_settings` and `audit_logs`
- `backup_job_status` if needed for admin-visible read-only backup health; **never store backup credentials in the admin DB**.

Explain FK cascade vs soft-delete policy: never delete paid order/payment history from routine product cleanup. Add unique constraints for public order number, SKU, provider transaction IDs, callback idempotency, and check constraints for nonnegative stock / valid amounts. Enforce row locks or atomic conditional updates during concurrent checkout.

Use one database for all internal departments. Introduce `shop_id` for filtering/permissions/reporting; no multi-vendor settlement logic.

## D. Backend/API and secure authentication

Implement real server-side endpoints with OpenAPI documentation and tests, e.g.:

Public: `GET /api/v1/shops`, `/categories`, `/products`, `/products/:slug`, `/collections`, `/site-content`, `/shipping-rates`; `POST /api/v1/cart/quote`, `POST /api/v1/orders`, `GET /api/v1/orders/:number` with properly authorized ownership or unguessable/expiring guest tracking token, not order number alone.

Customer: verified account registration/login and optional Google OAuth later (no mock-login presented as real), profile/address/order history, guest checkout without creating a falsely verified account. Security for password reset/email verification and PII minimization.

Admin: `POST /api/v1/admin/auth/login`, logout, refresh/session introspection; role-protected CRUD for shops, categories, products, variants, images, inventory, orders, shipments, promotions, content, settings; dashboard metrics; audit history; role-specific permissions and staff creation. **All authorization enforced server side.** Example roles: Owner/Super Admin, Operations Manager, Catalog Editor, Fulfillment, Support, Finance, and shop-limited Staff.

Use Argon2id for local staff password hashes, Secure/HttpOnly/SameSite session cookies, CSRF protection for cookie-authenticated mutations, rate limits and lockout/backoff, optional strong admin MFA, server-side logout/invalidation, CORS allowlist, strict input validation, output escaping, upload scanning/format-size restrictions, safe content-security-policy, secret and PII redaction in logs. Never expose PostgreSQL to public Internet. Keep credentials in secret stores or ignored `.env` on server; provide `.env.example` with placeholders only. Never expose service role keys, PayHere merchant secret, session signing secrets, R2 tokens or DB credentials in static JavaScript/browser/localStorage/repository. Never preserve production `admin/admin123` default login.

## E. Real checkout/payment/inventory flow

1. Customer chooses variant and quantity; API re-checks stock and server-controlled price, discount, shipping and totals.
2. In one DB transaction, create `pending_payment` order + line item price snapshots + short-lived stock reservations, using row locks or equivalent atomic stock checks to prevent overselling. Implement reservation timeout/release job, expired checkout logic and idempotency keys.
3. Integrate PayHere **Sri Lankan merchant Checkout API** in SANDBOX first, not similarly named unrelated platforms. Server generates required hash/order parameters; `merchant_secret` stays server-only. Customer uses PayHere hosted payment page.
4. Receive PayHere's publicly accessible `notify_url` callback. Parse `application/x-www-form-urlencoded`; verify official `md5sig` as specified by PayHere plus merchant ID, order ID, expected amount with exact decimal formatting, currency, valid status transitions; use constant-time signature comparison and reject mismatches. Verify `status_code == 2` before marking payment successful. Idempotently handle duplicate/out-of-order callbacks; transactionally update payment/order/reservation/inventory; persist a sanitised audit trail. Treat chargeback/cancel/failure according to documented status code handling. Never mark payment as successful on browser `return_url` or a UI callback alone.
5. `return_url` displays pending until server-confirmed state is available; support webhook delay, missing webhook, payment reconciliation and manual review.
6. Support COD and bank-transfer payment as **different explicit workflows**: COD orders await collection; bank transfer requires independently verified receipt by authorized finance staff. No false “paid” flag.
7. Refund/return process and inventory reversal must be auditable, permissions checked and never silently lose money or stock.

Official PayHere Sri Lanka documentation: https://support.payhere.lk/api-%26-mobile-sdk/checkout-api (verify current rules and merchant plan). Merchant credentials must be acquired through owner's approved account.

## F. Preserve and complete customer website AND admin panel

Storefront required: categories/shops, search/filter/sort, product variations, persistent cart (local browser cart allowed but always server quoted), wishlist, guest/customer checkout, checkout loading/error states, PayHere sandbox, delivery options China Direct vs Colombo, account verification/order history, secure tracking, stock/out-of-stock display, flash sales, promo codes, responsive mobile navigation, SEO, accessible checkout and bilingual content where applicable. Keep the cinematic intro, animated globe, import-country pages, original look and logo, no invented reviews/ratings.

Admin required: server-protected login, complete product CRUD and bulk actions, up to eight images per product, stock/variant management, order search/filter/status timeline, paid/pending/COD distinction, customer management with access controls, delivery tracking, flash sale and collections, categories, banners, homepage/globe configuration, admin visual editor/live preview, shipping settings, staff and roles, payment reconciliation, backups dashboard (read-only status + safe restore request, not public credentials), audit trail, warning alerts for low stock/failed backups. Every admin edit must persist in PostgreSQL and appear across browsers/devices. Keep current visual editor UX as close as possible and do not remove existing working features.

Build a migration adapter and gradually replace browser-local “DB”/auth/order logic with authenticated HTTP API calls. `localStorage` is acceptable for non-sensitive UI preferences/cart cache only, not source-of-truth inventory, payment state, admin authorization, staff accounts, and orders. Clear migration path for user data. Write UI smoke tests across devices/viewports.

## G. Backup architecture: one VPS plus independent backup storage

**Conceptual distinction:** (1) backup = recover DATA; (2) standby/failover server = continue SERVICE after server failure. One does not replace the other.

**Initial implementation:** PostgreSQL on primary VPS; `pgBackRest` with tested S3-compatible off-site storage, e.g. PRIVATE Cloudflare R2 bucket `source-connect-db-backups` using separate minimum-permission credentials. Set PostgreSQL WAL archiving and backup scheduling, monitor archive lag and storage. Configure full weekly and differential daily (or equivalent provider-verified schedule) plus continuous WAL archiving, compressed and encrypted (prefer client-side encryption; do not rely only on provider encryption). Define time-based retention policy: at least ~4 weekly full restore points and recent daily history, capacity permitting; monthly archive snapshots if business/legal needs dictate. Determine actual retention using projected DB size and costs.

**Recovery targets (design targets, not guarantees):** RPO <= 15 minutes (max intended data loss under tested failure conditions), RTO <= 4 hours for initial single-VPS manually restored recovery (depends on storage, size, DNS and human response). Set alerts if WAL archive/backups are late; test real recovery against those targets. Consider tighter RPO/RTO only after monitoring and tested standby architecture.

**Other critical backup content:** product image original objects (separate backup copy, not merely pointing to original bucket), schema migrations, minimal deployment configuration, service secrets recovery procedure (store encrypted/offline, do not embed plaintext in backup), domain/DNS records, tested service reconstruction steps. Never put DB backup files under public CDN/static web paths. Protect against ransomware/accidental deletion with bucket retention/lock if compatible; IMPORTANT: retention locks can conflict with pgBackRest's pruning/expiry; plan appropriate prefixes/buckets and TEST before enabling permanent lock rules. Prefer separate owner credentials from backup write credentials; assess second backup provider/account to reduce common-account risk.

**Monitoring + restore:** `pgbackrest check`, scheduled `info`/backup-age and WAL-lag checks, checksum/integrity verification, daily automated alert, weekly restoration to disposable/staging Postgres, monthly documented disaster-recovery exercise on a clean host (masked production data), verify actual representative products, orders, payments, stock, user relationships. Never restore over live database without owner approval, maintenance plan and independent emergency snapshot. Provide `docs/backup-restore-runbook.md` and scripts under `infra/backup/` with secure tested example configuration. No pretend backup checks or dummy success statuses.

**VPS 2 policy:** do NOT rent a second VPS just to copy snapshots to its disk. Add a second VPS only when uptime requirements and budget justify a warm standby, preferably in a different provider/region with tested replication/monitoring/failover. Replication is NOT backup: accidental deletion can replicate. Automatic failover has split-brain risks and requires fencing/leader election/rehearsals.

Official docs to consult and match before coding:
- PostgreSQL WAL/PITR: https://www.postgresql.org/docs/current/continuous-archiving.html
- pgBackRest guides: https://pgbackrest.org/user-guide.html
- pgBackRest S3 config: https://pgbackrest.org/configuration.html
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 retention lock: https://developers.cloudflare.com/r2/buckets/bucket-locks/

## H. Infrastructure and security deployment

- Provide checked-in but non-secret IaC or scripts: `infra/compose.yaml` or equivalent; VPS setup, container/service startup and restart policies, migrations, reverse proxy, HTTPS/TLS issuance, UFW/SSH key-only/non-root/admin access, security updates, disk and memory limits, log rotation, fail2ban if appropriate, backups and monitoring.
- Frontend stays on Cloudflare Pages (unless owner's explicit preference changes); backend VPS is on `api.<domain>`, secure TLS. Restrict CORS and cookie scopes to intended domains. Avoid unnecessary public DB ports; backup should use TLS and limited credentials.
- Rate limit high-impact endpoints (login, checkout, search, image upload, callbacks appropriately), do not break valid PayHere server callbacks. Use CDN for static assets/image derivatives, cache headers on public products with invalidation, never cache private admin/customer responses.
- Health endpoints for web API, PostgreSQL and backup visibility. Alerts: endpoint unavailable, CPU/RAM/disk, DB failure/slow queries, backups older than threshold, WAL archiving errors, queue backlog, payment callback error rate, certificate expiration. Document logging and security incident response.
- Test load against measured targets with realistic checkout/stock lock contention and read/write split. If a 4GB/2vCPU machine cannot pass, recommend an upgrade to 8GB or split backend/DB. No unsupported promise that it handles 100k simultaneous users.
- Keep development/staging/production data and credentials isolated. Prohibit hard-coded live credentials in tests.

## I. Required automated test plan

Create runnable test scripts and report output:

- SQL migration up/down strategies (no destructive downgrade on prod), seed correctness, relational/index constraints.
- Auth: default password removed, staff RBAC boundaries, CSRF, token/session expiry, logout, brute-force rate limiting.
- Storefront/admin E2E: catalog search, product variants and 8-image uploads, changes synced across two separate browser contexts, mobile layouts, order tracking ownership.
- Concurrency: two buyers ordering last item => max one purchase; expired reservation releases stock; duplicate payment callback => one payment/order state update, no double decrement; invalid signature/amount/currency/order ID => no success; browser `return_url` alone => not paid.
- Bank transfer/COD separate flows, cancel/chargeback, refund and status authorization.
- Backup drills: full restore, PITR recovery to controlled timestamp, corrupted/missing file detection, media restore, credential loss assumptions, restoration to clean host and DB consistency checks.
- Performance: benchmark catalog pages/API, admin lists and representative checkout load, report p95 response times and error rate under a specified measured load.

## J. Implementation sequence (do not skip gates)

**Phase 0 — Audit and plan:** inventory repo, threats, database model, migration strategy, baseline visual snapshots. Deliver architecture diagram and risks. No production change.

**Phase 1 — Local backend + database:** run Postgres in reproducible local development; real SQL migrations, seed internal departments/products, typed API + schema validation + OpenAPI, error handlers and integration tests.

**Phase 2 — Security:** replace browser-only admin login with server sessions and RBAC, customer/guest identity model, protect admin APIs, move secrets. Test brute-force, authorization, CSRF.

**Phase 3 — Data migration:** move catalog/site admin edits to database-backed APIs, convert storefront/admin to async data fetch, preserve original UI, import approved seed data, test two browsers and inventory.

**Phase 4 — Checkout + PayHere sandbox:** order workflow, pricing, stock reservation, PayHere notify validation, COD/bank-transfer and failure/retry handling. Tests must pass before live merchant activation.

**Phase 5 — Backup/recovery:** pgBackRest/WAL to independent encrypted object storage, separate image backup, alerts, documented restore, PITR test to clean staging instance. Produce evidence of actual success.

**Phase 6 — VPS staging:** audit candidate host, configure hardened Linux, HTTPS, backup credentials, DNS and application deployment in staging; test across browsers, load, security and restore.

**Phase 7 — Production launch gate:** only after explicit owner approval, verified PayHere account and domain, correct final pricing, external backups, successful restore, observability, accepted runbook, security review, real merchant webhook verification. Roll out with rollback plan. **Do not say “ready” just because code compiles.**

**Phase 8 — Future growth:** monitor actual metrics; if demanded, split DB and API, add Redis/worker queue, read replicas, independent standby and a failover plan. Restore backups remain independent of replication.

## K. Required artifacts / final report

Create or update, at minimum:

- `docs/current-state-audit.md`, `docs/architecture.md`, `docs/database-erd.md`, `docs/operations-runbook.md`, `docs/backup-restore-runbook.md`, `docs/security-checklist.md`, `docs/release-checklist.md`, `docs/budget-and-capacity.md`
- `server/` modular production API (TypeScript), migrations and seed scripts with repeatable local setup
- `infra/` deploy config and secret-free examples; `infra/backup/` verified scripts/config examples; monitoring and alerts instructions
- `.env.example`, `.gitignore`, secure `.github/workflows/` tests, tests for checkout/payment/security/restore
- Full integration for existing storefront `/` and admin `/admin/` without damaging original visual style
- A clear table **Implemented / Tested / Blocked / Needs owner action** with proof (test names/results, commands, environment).

At the end, respond with:
1. Summary of actual changes and exact file paths/commits/PRs.
2. Before/after security and feature status.
3. Tests actually run (pass/fail/skipped) and backup restoration evidence.
4. Paid accounts/credentials/infrastructure still needed, if any.
5. Step-by-step beginner-friendly Sinhala instructions to operate Source Connect, add products, view orders, test PayHere sandbox, check backup alerts, restore to staging, and launch with approval.

**Safety/operational boundary:** No live purchases, no real merchant secrets, no production data deletion or overwrite, no unreviewed migration, no live PayHere activation, no server purchase and no false deployment claims. Work with whatever authorized local/repo resources are available, implement as much as possible immediately, and state accurately what remains blocked. Do not ask repeated broad clarifying questions; make the above choices your default, and ask only for truly required approvals/secret settings.
