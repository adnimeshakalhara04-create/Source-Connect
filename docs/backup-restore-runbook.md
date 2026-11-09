# Backup & disaster-recovery runbook

**Backup** gets the *data* back. A **standby server** keeps the *service* running when the main server dies. They do different jobs. Source Connect starts with backups only, plus a tested manual restore. A standby can be added later (see §8). Replication is never a substitute for backups, because a mistake such as a deleted table is replicated within a second.

## 1. What is protected, where, and how often

| What | Tool | Where it goes | Schedule | Kept for |
|---|---|---|---|---|
| PostgreSQL full backup | pgBackRest `sc-backup.sh full` | Private R2 bucket `source-connect-db-backups`, **encrypted on the VPS** (AES-256) before upload | Sunday 02:10 (Sri Lanka time) | 4 full backups (about 4 weeks) |
| PostgreSQL differential | `sc-backup.sh diff` | same | Mon–Sat 02:10 | 7 most recent |
| Every database change (WAL) | `archive_command` → `pgbackrest archive-push` (async) | same | continuously; forced at least every 5 min (`archive_timeout = 300`) | as long as the backups that need it |
| Backup health | `sc-backup-check.sh` (`pgbackrest check` + backup age + `pg_stat_archiver`) | status row in `backup_job_status`, alert if bad | hourly | 90 days of rows |
| Restore test | `sc-restore-test.sh` (verify every file's checksum, restore into a throwaway directory, run `verify.sql`) | — | Wednesday 03:40 | — |
| Product images | `images-sync.sh` (rclone) | separate private bucket `source-connect-image-backups`; changed/deleted images kept 90 days under `_deleted/<date>/` | daily 03:10 | 90 days of history |
| Code, migrations, config templates | git (GitHub) | GitHub | every commit | forever |
| Secrets (DB password, PayHere secret, R2 keys, **backup encryption passphrase**) | owner's password manager plus a printed sealed copy | **never** in the backups, in git or in the admin panel | when changed | — |

Design targets, which were checked in the drill (§6):
- **RPO ≤ 15 minutes:** at most about 5 minutes of orders can be lost if the server disappears completely.
- **RTO ≤ 4 hours:** restoring onto a new server, including rebuilding it, takes under 4 hours for one person following this runbook.

These are targets that the drill and the weekly tests measure. They are not guarantees.

## 2. Setting it up (one time, needs the owner's Cloudflare account)

1. In Cloudflare R2, create two **private** buckets: `source-connect-db-backups` and `source-connect-image-backups`. Never turn on public access for them.
2. Create an R2 API token **scoped to these two buckets only**, with *Object Read & Write*. This token goes on the VPS. Keep the owner's account-level token off the server.
3. **Ransomware and mistake protection.** R2 bucket lock rules stop deletion for N days, but they **conflict with pgBackRest's own expiry**: expiry would fail and alert. Recommended:
   - Option A (simple): no lock rule on `pgbackrest/`. Twice a month the owner downloads `pgbackrest info` output. The second copy in §2.4 is the protection.
   - Option B: a lock rule of 35 days on the bucket, with `repo1-retention-full=6`, so pgBackRest only expires backups older than the lock. **Test that expiry still succeeds** before relying on it.
4. A second, independent copy, recommended once there are real orders: add `repo2` in `pgbackrest.conf` pointing at another provider or account (for example Backblaze B2). pgBackRest writes to both. A problem with one account then cannot destroy every copy.
5. On the VPS, as root:
   ```bash
   apt install pgbackrest rclone
   install -o postgres -m 600 /dev/null /etc/pgbackrest/secrets.env
   # put PGBACKREST_REPO1_S3_KEY=..., PGBACKREST_REPO1_S3_KEY_SECRET=..., PGBACKREST_REPO1_CIPHER_PASS=<long random> in that file
   cp infra/backup/pgbackrest.conf.example /etc/pgbackrest/pgbackrest.conf   # fill in <ACCOUNT_ID>
   cat infra/backup/postgresql-archiving.conf >> /etc/postgresql/16/main/conf.d/archiving.conf && systemctl restart postgresql
   sudo -u postgres pgbackrest --stanza=source-connect stanza-create
   sudo -u postgres pgbackrest --stanza=source-connect check
   cp infra/backup/systemd/* /etc/systemd/system/ && systemctl daemon-reload
   systemctl enable --now sc-backup-full.timer sc-backup-diff.timer sc-backup-check.timer sc-restore-test.timer sc-images-sync.timer
   sudo -u postgres /opt/source-connect/infra/backup/sc-backup.sh full     # the first backup now
   ```
6. Set up alerts in `/etc/source-connect/alert.env`. The simplest is `ALERT_WEBHOOK_URL=https://ntfy.sh/<long-random-topic>` with the ntfy app on the owner's phone. **Test it:** run `infra/backup/alert.sh "test" "hello"` and check that it arrives.
7. **Write the encryption passphrase down and store it away from the server.** Without it the backups cannot be read by anyone, including us.

## 3. Daily and weekly checks (5 minutes)

- Admin → **Backups**: the top line must be green. The Dashboard shows a warning when backups are late, WAL archiving failed or a restore test failed.
- Once a week, confirm that Wednesday's `restore_test` row is `ok`.
- Once a month, run the full drill on a separate test machine (§6) and keep the log.

**Never assume backups work because a timer exists.** Only an `ok` restore test proves it.

## 4. Restoring after an accident (data deleted or overwritten by mistake)

> **Do not restore over the live database without the owner's written OK.** First take an emergency copy of how things are now.

1. Find the moment just before the mistake, from the Admin **Audit Log** or the PostgreSQL log. Example: `2026-11-08 18:55:00+05:30`.
2. Restore into a **throwaway copy** and check it:
   `sudo -u postgres RESTORE_DIR=/var/lib/postgresql/pitr KEEP=1 /opt/source-connect/infra/backup/sc-restore-test.sh "2026-11-08 18:55:00+05:30"`
   The script prints the counts of products, orders, payments and stock. Compare them with what you expect.
3. Choose one:
   - **Small mistake** (a few products or orders): copy just those rows from the throwaway copy with `pg_dump -t` / `psql`. Write down what you did in the audit notes.
   - **Large mistake**: put up the maintenance page, then `systemctl stop source-connect-api`. Take an emergency snapshot:
     `sudo -u postgres pgbackrest --stanza=source-connect --type=full backup`
     Then restore the live cluster to the target time:
     `sudo -u postgres pgbackrest --stanza=source-connect --delta --type=time "--target=<time>" --target-action=promote restore`
     Start PostgreSQL, run `verify.sql`, start the API and take the maintenance page down.
4. Orders paid on PayHere **after** the target time are not in the restored database. Find them in the PayHere merchant portal and re-enter or refund them. Every PayHere notification is also in `payment_events` on the emergency snapshot.

## 5. Rebuilding after losing the whole server

1. Rent or replace the VPS (owner approval), then run `infra/deploy/setup-vps.sh` (see `docs/operations-runbook.md`).
2. Restore `/etc/pgbackrest/secrets.env` from the password manager, install `pgbackrest.conf`, then:
   `sudo -u postgres pgbackrest --stanza=source-connect restore` (latest), start PostgreSQL and run `verify.sql`.
3. Restore images: `rclone copy imgbackup:source-connect-image-backups/current images:source-connect-images`. If images live on the server disk, restore them to `/srv/source-connect/uploads` instead.
4. Deploy the API image (same git tag as before), point DNS `api.<domain>` at the new IP and check `/ready`.
5. In the PayHere portal, compare payments from the last hour with the restored orders (see §4.4).
6. Take a fresh full backup: `sc-backup.sh full`.

## 6. Drill evidence (2026-11-08, test environment)

Script: `infra/backup/drill/run-local-drill.sh`. Full log: `docs/evidence/backup-drill-2026-11-08.log`.

**Environment.** PostgreSQL 16.15 and pgBackRest 2.50 on Linux. The R2 stand-in was a local **HTTPS** S3-compatible server (`s3rver`, own TLS certificate, verified by pgBackRest). It used the same pgBackRest S3 settings as production, except the endpoint and the keys. The data was the real seeded catalogue (144 products, 528 variants), plus orders placed through the real API (COD, PayHere with a signed notification, and bank transfer).

| Test | Result |
|---|---|
| stanza-create + `check` (WAL reaches the bucket) | **PASS** |
| Full backup, then differential, through `sc-backup.sh` (status recorded in DB) | **PASS** (full 34 MB data → 4.1 MB stored; diff 0.2 MB) |
| Hourly check script | **PASS** |
| Restore test of the latest state into a throwaway directory + `verify.sql` | **PASS** (7–9 s). It also showed the accident (orders wiped) is in "latest", which is why PITR matters |
| **Point-in-time recovery** to just before an accident (TRUNCATE of orders + stock set to 0) | **PASS**. Products, variants, stock units, orders, paid orders, payments, payment events, staff and role grants were all identical to before the accident |
| **Total server loss** (immediate stop + data directory deleted) → rebuild from the bucket | **PASS**. Restored in 9 s, including downloading the backup, WAL replay and the `verify.sql` checks. Lost: the orders placed in the last 70 s, which had not been shipped yet (the drill used `archive_timeout=60`). With the production value of 300 s the expected worst case is about 5 minutes, within the 15-minute RPO |
| Corrupted file in the bucket → `pgbackrest verify` | **PASS**: reported as `checksum invalid`. **Note:** pgBackRest 2.50 `verify` exits with code 0 even then, so `sc-restore-test.sh` reads the report text |
| Bucket copy without the encryption passphrase | **PASS**: pgBackRest cannot read it, and the stored WAL is random-looking ciphertext |
| Image backup (`images-sync.sh`, rclone) | **PASS**: deleted and overwritten images were kept under `_deleted/<date>/` |

**Not yet done, and needs the owner's accounts:**
- the same drill against **real Cloudflare R2**;
- the RTO measurement on the real VPS, including DNS change and API deploy;
- a check that alerts actually reach the owner's phone or email.

The production RTO will be dominated by provisioning the server and downloading the backup. Measure it during the first staging drill and write the number here.

## 7. Alerts that must reach the owner

Backup failed · backup older than 26 h · WAL archiving failing · restore test failed · bucket files damaged · image backup failed · a systemd job did not finish. The API dashboard repeats these. See `docs/operations-runbook.md` for CPU, disk, API and certificate alerts.

## 8. Future standby server (not at launch)

When downtime starts costing more than a second server (about USD 10–20 a month):

1. Rent a VPS with **another provider or region**. Run PostgreSQL as a streaming-replication standby with `primary_conninfo`, plus a replication slot with a size limit. Also give it `restore_command` from the same pgBackRest repository, so it can catch up from WAL in the bucket.
2. Keep failover **manual** at first: `pg_ctl promote` on the standby, change DNS, then fence the old primary (stop it or block it in the firewall) so two primaries never accept orders at once. Automatic failover (Patroni etc.) needs three nodes and rehearsals, and is not worth it at this size.
3. Backups and restore tests continue unchanged. The standby does **not** replace them.
4. Rehearse failover every quarter, and write down how long it took and what broke.
