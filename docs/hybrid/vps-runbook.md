# VPS + backup runbook (Supabase hybrid)

Secrets are typed **only on the server or in the provider dashboards**, never in chat, email or Git.
Every file in `/etc/source-connect/` is mode 0600, except `worker.env` (0640 root:sc-worker) and `backup-recipients.txt` (public keys).

## 1. First setup

1. **VPS:** Ubuntu 24.04. Copy the repository to it, then run:
   `sudo ADMIN_USER=sc ADMIN_SSH_KEY="ssh-ed25519 …" bash vps/setup-vps-hybrid.sh`.
   Result:
   - only SSH is open;
   - SSH accepts keys only;
   - fail2ban and automatic security updates are on;
   - installed: Node 22, the PostgreSQL 17 client, age, rclone, Docker, the worker and the units (not started yet).
2. **Worker database role.** Generate the password on the VPS with `openssl rand -base64 32`. Then, in the Supabase SQL editor, run `ALTER ROLE sc_worker WITH LOGIN PASSWORD '…';`.
   - On the pooler, the user name is `sc_worker.<project-ref>`.
   - This role can only call `app.worker_*` functions and `storefront_snapshot`. A test checks it cannot read tables.
3. **`/etc/source-connect/worker.env`:** start from `vps/worker/worker.env.example`.
   - The Supabase service role key goes **only** here; it is needed for the photo checks.
   - Keep `EMAIL_TRANSPORT=none` until an email provider is chosen. Emails wait in the queue; nothing is lost.
4. **R2:**
   - Create a bucket, e.g. `sc-backups`.
   - Create an API token with Object Read & Write **for that bucket only**.
   - Add a lifecycle rule that deletes objects after, e.g., 35 days. The VPS never deletes from R2.
   - Check whether your R2 account offers bucket/object locks. If it does, enable a retention lock, so that a compromised VPS cannot erase the backups.
5. **`/etc/source-connect/rclone.conf`** (mode 0600), with three remotes:
   - `r2`: `type = s3`, `provider = Cloudflare`, endpoint `https://<account-id>.r2.cloudflarestorage.com`, plus the token's keys.
   - `r2crypt`: `type = crypt`, `remote = r2:sc-backups/files`. Create the passwords with `rclone config` and **store both passwords in the password manager**: without them the photo backups cannot be read.
   - `supabase`: `type = s3`, `provider = Other`, endpoint `https://<project-ref>.supabase.co/storage/v1/s3`, region from the dashboard, and an S3 access key from Dashboard → Storage → S3.
6. **Encryption keys:**
   - The setup script created the drill key (`drill-age.key`).
   - On the owner's **own computer**, run `age-keygen -o source-connect-owner.key`. Keep that file offline (USB + password manager).
   - Add the printed `age1…` public key as a second line to `/etc/source-connect/backup-recipients.txt`.
7. **`/etc/source-connect/backup.env`:** start from `vps/backup/backup.env.example`.
8. **Test before switching on:**
   ```
   sudo /opt/source-connect/vps/backup/sc-db-backup.sh
   sudo /opt/source-connect/vps/backup/sc-storage-backup.sh
   sudo /opt/source-connect/vps/backup/sc-restore-drill.sh      # must print PASSED
   sudo systemctl enable --now sc-worker sc-db-backup.timer sc-storage-backup.timer sc-restore-drill.timer
   ```
9. **Optional:** create three "push" monitors (healthchecks.io or Uptime Kuma). Put their URLs in `*_PING_URL`. You are then alerted when backups **stop**, including when the whole VPS is down.

## 2. Daily view

- The **admin → Backups page** shows the newest backup, photo backup and restore drill. It warns when the backup is older than `backup_max_age_hours`.
- On the VPS:
  - `systemctl list-timers 'sc-*'`;
  - `journalctl -u sc-worker -n 50`;
  - the evidence of each drill in `/var/backups/source-connect/drills/`.

## 3. Disaster recovery

Choose the smallest fix:

| Situation | What to do |
|---|---|
| A mistake made minutes/hours ago (wrong prices, deleted product) | Supabase dashboard restore / PITR (if bought) **or** pick the right hourly dump and copy back only the affected rows (§3.3). |
| Photos deleted | §3.4 |
| Supabase project lost / unusable | New project + full restore (§3.2) |
| VPS lost | The shop keeps running. Build a new VPS (§1). The backups are on R2. Without the old VPS, the owner's offline key decrypts them. |

### 3.1 Get a backup
```
rclone lsf r2:sc-backups/db/ | sort | tail -5
rclone copy r2:sc-backups/db/sc-db-<stamp>.tar.age .   &&   rclone copy r2:sc-backups/db/sc-db-<stamp>.tar.age.sha256 .
sha256sum -c sc-db-<stamp>.tar.age.sha256
age -d -i <drill-age.key or owner key> sc-db-<stamp>.tar.age | tar -xf -      # -> manifest.json, db.pgc, cron.sql
```

### 3.2 Full restore into a NEW Supabase project
1. Create the project in the same region. Do **not** run this repository's migrations first: the dump brings the schema with it. Then:
   - **a.** Connect as the `postgres` user on the **session** pooler.
   - **b.** Run the preparation SQL from `vps/backup/sc-restore-drill.sh` step 4:
     - drop the empty `auth` and `storage` schemas only if the new project has no users or files yet;
     - create the `citext` and `pg_cron` extensions;
     - create the `sc_worker` role;
     - **switch off the default grants in schema `public`**. Skipping this lets website visitors call server-only functions.
   - **c.** `pg_restore -d "<url>" -L <list without 'SCHEMA - public'> db.pgc`;
   - **d.** `psql -f cron.sql`;
   - **e.** `psql -f vps/backup/verify-supabase.sql`;
   - **f.** Compare `psql -f vps/backup/counts.sql` with `manifest.json`. The security fingerprint must match.
   - The hosted `postgres` role is not a superuser, and Supabase manages the `auth`/`storage` schemas. **Practise this on a staging project before launch** and write down any differences here. The local drill used a superuser.
2. Set the Edge Function secrets again (`supabase secrets set --env-file …`) and deploy the functions (`supabase functions deploy`).
3. Restore the photos (§3.4).
4. Put the new URL and anon key in `js/config.js`, redeploy Pages, and update the VPS env files.
5. Check: a test order, the admin login with TOTP, and the PayHere sandbox notification.

### 3.3 Partial repair (some rows)
Restore the dump into a scratch container, as the drill does with `KEEP_SCRATCH=1 sc-restore-drill.sh <file>`. Read the needed rows there and fix them through the admin panel. Do not run bulk SQL against production without a second person checking it.

### 3.4 Photos
```
rclone copy --fast-list r2crypt:storage/product-images ./photos         # decrypted on the fly
rclone copy --fast-list ./photos supabase:product-images                 # back into Storage (same paths, so product links keep working)
```

## 4. Tested numbers (local, small database — re-measure on the VPS)
- Encrypted dump of a 149-product test database: 0.69 MB.
- Restore 2 s; whole drill 7 s.
- Details: `docs/evidence/hybrid-backup-drill-2026-11-09.log`.
