# Release checklist and rollback plan

## A. Every release (staging first, then production)

- [ ] CI is green: type check, 69 API tests and the image build (`.github/workflows/ci.yml`).
- [ ] `e2e/api-e2e.mjs` passes against staging. That is 27 checks: two devices, COD, PayHere sandbox, accounts and mobile.
- [ ] Migrations reviewed: **additive only** (new tables or columns with defaults). Removing or renaming happens in a later release, after the old code is gone.
- [ ] `infra/deploy/deploy.sh` takes a backup first, migrates, starts the new image, health-checks it, and rolls back automatically if the check fails.
- [ ] After the deploy: place a test COD order, open it in Admin, then cancel it.

## B. Launch gate (production with real customers) — owner signs each line

| # | Requirement | Status today |
|---|---|---|
| 1 | No default credentials. The owner account was created with `create-owner` | ✅ code ready |
| 2 | Orders, stock and payments live in PostgreSQL, not the browser | ✅ code ready |
| 3 | Customer A cannot see customer B's orders | ✅ tested |
| 4 | Server validates price, shipping and stock | ✅ tested |
| 5 | Duplicate PayHere notifications never double-count | ✅ tested |
| 6 | Forged or wrong notifications never create a paid order | ✅ tested |
| 7 | Weekly full, daily differential and continuous WAL backups active; archiving monitored | ✅ scripts tested locally · ⬜ **on the real VPS + R2** |
| 8 | Backup bucket private, encrypted, separate credentials | ✅ design + drill · ⬜ **owner creates R2 buckets and keys** |
| 9 | Restore tested on a clean server, including product images | ✅ local drill · ⬜ **repeat on staging** |
| 10 | Backup, CPU, disk and API alerts reach the owner | ✅ scripts · ⬜ **owner sets up ntfy or email and confirms a test alert** |
| 11 | PayHere live merchant approved for the domain; one real payment + refund tested | ⬜ **owner** |
| 12 | Real contact details, bank details, photos and prices; demo products hidden; privacy and refund policy pages | ⬜ **owner** |
| 13 | Load test on the real VPS meets §1 of `budget-and-capacity.md` | ⬜ after the VPS is approved |
| 14 | Owner approves this release and the rollback plan | ⬜ |

## C. Rollback plan

| Problem after a release | Action | Data impact |
|---|---|---|
| New API version misbehaves | `infra/deploy/deploy.sh rollback` (switches to the previous image tag in seconds) | None. Migrations are additive, so the old image keeps working |
| Website (Pages) change misbehaves | Cloudflare Pages → Deployments → "Rollback to this deployment" | None |
| A migration was wrong (data damaged) | Maintenance page → point-in-time restore to just before the deploy (`backup-restore-runbook.md` §4). deploy.sh takes an incremental backup right before migrating | Orders placed after the deploy must be re-entered from PayHere or the admin log |
| Switch back to the old browser-only site | Set `PRODUCTION_API = ''` in `js/config.js` and redeploy Pages | **Do not** do this once real orders exist: the demo mode keeps orders only in each visitor's browser |
| PayHere live problem | Admin → Store Settings → switch Card payment off (COD and bank transfer keep working). Fix it, then switch back on | None |
