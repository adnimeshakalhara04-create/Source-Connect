# Source Connect Global — Supabase + VPS hybrid (branch `claude/supabase-vps7-hybrid`)

Status: **built and tested locally, not deployed.**
- No paid service has been bought, no hosted project exists, and live payments are off.
- The live GitHub Pages site is unchanged.
- The earlier self-hosted backend (`claude/fullstack-backend`, Fastify + PostgreSQL on the VPS) is kept unchanged for comparison and rollback.

## 1. Who does what

```
 Customer / staff browser
   │  same Source Connect UI (index.html, admin/) — only the data layer changed (js/supabase-backend.js)
   ▼
 Cloudflare Pages (static files)
   │
   ▼
 Supabase Pro  ── the live system: everything a customer or staff member waits for
   • Postgres 17: all data in schema `app`, RLS forced, no table readable from the browser
   • Browser API = a fixed list of SECURITY DEFINER functions in `public` (deny by default)
   • Auth: customers + staff (staff need TOTP two-step sign-in, enforced inside the database)
   • Edge Functions: checkout, payhere-notify (signature check), track-order (rate limited), admin-staff
   • Storage: product photos (public read, staff-only upload, size/type limits)
   • pg_cron: releases unpaid reservations every minute
   │ jobs table (queue)                          ▲ pg_dump / Storage S3 (read)
   ▼                                             │
 VPS ── never on the checkout path: if it is down, customers can still browse and order; jobs simply wait
   • sc-worker: photo checks (real bytes, EXIF/GPS removed, max 2000 px), catalogue snapshots, order emails
   • hourly encrypted database backup + hourly photo backup + weekly restore drill
   ▼
 Cloudflare R2 ── off-site copy: age-encrypted DB dumps, rclone-crypt photos; deletion only by lifecycle rule
```

## 2. Where things are

| Part | Path |
|---|---|
| Database schema, security, business logic | `supabase/migrations/2026110900000{1..7}_*.sql` |
| Seed (144 products from the original site) | `supabase/seed.sql` |
| Edge Functions | `supabase/functions/` (settings: `supabase/functions/.env.example`) |
| Website ↔ Supabase adapter | `js/supabase-backend.js`, `js/config.js` (URL + anon key only) |
| VPS worker | `vps/worker/` + `vps/systemd/sc-worker.service` |
| Backups, restore drill, checks | `vps/backup/` + `vps/systemd/sc-*-backup.*`, `sc-restore-drill.*` |
| VPS setup | `vps/setup-vps-hybrid.sh` |
| Tests | `supabase/tests/` (62), `e2e/supabase-e2e.mjs` (26 browser checks), `vps/backup/drill/run-hybrid-drill.sh` |
| CI | `.github/workflows/supabase.yml` (everything above, on a local Supabase stack in the runner) |
| Evidence | `docs/evidence/hybrid-*` (+ `docs/evidence/README.md`) |
| Operations | [`vps-runbook.md`](vps-runbook.md), [`go-live-checklist.md`](go-live-checklist.md), Sinhala: [`OWNER-GUIDE-HYBRID-SINHALA.md`](OWNER-GUIDE-HYBRID-SINHALA.md) |

## 3. What was proven locally (2026-11-09)

| Area | Evidence | Result |
|---|---|---|
| Server-side prices, stock locking and no overselling under concurrency; coupons; idempotent orders | `commerce.test.ts` | 25/25 |
| RLS/grants catalogue checks, staff roles, MFA required in the database, temporary passwords, privacy, worker role | `security-admin.test.ts` | 21/21 |
| Edge Functions: checkout, PayHere hash made on the server, forged/duplicate notifications, rate limits, staff creation | `functions.test.ts` | 10/10 |
| VPS worker: least privilege, fake photo removed, GPS stripped, emails once, retries → dead | `worker.test.ts` | 6/6 |
| Real browser: storefront, admin with TOTP, price/stock/photo edits, COD + PayHere sandbox flow, customer account, mobile | `e2e/supabase-e2e.mjs` | 26/26 |
| Backup → R2 → restore into a fresh Supabase Postgres, integrity + **security fingerprint**, photo restore, tamper/wrong-key refusal | `docs/evidence/hybrid-backup-drill-2026-11-09.log` | all steps passed |

**What local tests cannot prove** (re-checked on staging, see the go-live checklist):
- hosted gateway CORS and client-IP headers;
- whether `pg_dump` with the hosted `postgres` role can read all `auth` tables;
- Supabase Pro limits;
- real R2 lifecycle/lock options;
- the PayHere sandbox with a real merchant account;
- email deliverability;
- VPS performance.

## 4. Important design decisions

1. **The checkout never depends on the VPS.** Orders, payments and stock all live in Supabase SQL functions inside one transaction.
2. **Deny by default.** No table is reachable through the REST API. A new function is invisible to the browser until it is explicitly granted (migrations revoke `PUBLIC` and default grants). Tests check the privilege catalogue itself.
3. **Payments:**
   - PayHere notifications are trusted only with a valid `md5sig` made with the merchant secret, plus the right merchant, amount and currency.
   - Each notification is applied once, even when it arrives several times.
   - The return URL never marks an order paid.
   - `live` mode needs `PAYHERE_LIVE_APPROVED=true` **and** a recorded owner approval in the database (CHECK constraint).
4. **Backups are independent of Supabase.**
   - Supabase's own backups stay on: daily on Pro. Point-in-time recovery is a paid add-on; check the current price.
   - The VPS adds hourly logical dumps (RPO ≤ 1 h) and photo copies (Supabase backups do not include Storage files).
   - The VPS holds only **public** encryption keys plus a drill key. The owner keeps an offline key.
5. **Restores must reproduce the permissions exactly.** The drill found that a plain `pg_restore` into a Supabase database gives website visitors access to every `public` function, because of Supabase's default privileges. The restore procedure prevents that, and every drill compares a security fingerprint.
