# Operations runbook

## Layout in production

| Piece | Where | How it runs |
|---|---|---|
| Website `/` and admin `/admin/` | Cloudflare Pages (static files from this repo) | Build: none. Set `PRODUCTION_API` in `js/config.js` to `https://api.<domain>` |
| API | VPS, Docker container `source-connect-api:<git-sha>` on `127.0.0.1:8080` | `infra/compose.yaml`, deployed by `infra/deploy/deploy.sh` |
| HTTPS for the API | Caddy on the VPS (Let's Encrypt), behind Cloudflare proxy | `/etc/caddy/Caddyfile` (`infra/deploy/Caddyfile`) |
| PostgreSQL 16 | VPS, `localhost` only | apt package. Settings in `conf.d/source-connect.conf` |
| Backups | pgBackRest → private R2; images via rclone | systemd timers (`infra/backup/systemd/`) |
| Health alerts | `sc-health.timer` every 5 min, plus an external uptime monitor | `infra/monitoring/` |

Configuration and secrets live in `/etc/source-connect/api.env` (mode 600), built from `server/.env.example`. Backup keys live in `/etc/pgbackrest/secrets.env`. Alert settings live in `/etc/source-connect/alert.env`. **None of these files are in git.**

## First deployment (staging first)

1. Owner approves the VPS. Check the provider against the list in `docs/budget-and-capacity.md` §3.
2. `infra/deploy/setup-vps.sh` sets up the SSH key, firewall, fail2ban, automatic security updates, swap, PostgreSQL bound to localhost, Docker, Caddy and log limits.
3. `git clone` the repo to `/opt/source-connect`. Create `/etc/source-connect/api.env`.
4. `infra/deploy/deploy.sh` builds the image, takes a backup, migrates, starts the container, health-checks it and rolls back automatically if that fails.
5. Create the first owner:
   `docker run --rm -it --network host --env-file /etc/source-connect/api.env source-connect-api:<tag> node dist/src/cli/create-owner.js --username <name> --name "<Full name>"`
6. Seed the catalogue (empty database only):
   `docker run --rm --network host --env-file /etc/source-connect/api.env source-connect-api:<tag> node dist/src/db/seed.js`
7. Set up backups: `docs/backup-restore-runbook.md` §2. Run the first restore test.
8. Cloudflare:
   - DNS `api` → VPS IP (proxied).
   - Pages project for the repo, with `js/config.js` → `PRODUCTION_API`.
   - SSL mode "Full (strict)".
   - A WAF rate-limit rule on `/api/v1/orders` and `/api/v1/admin/auth/login` as a second layer.
9. External uptime check (UptimeRobot free tier or Cloudflare Health Checks) on `https://api.<domain>/ready`, alerting the owner.

## Everyday operations

| Task | Command / place |
|---|---|
| Deploy the latest code | `cd /opt/source-connect && git pull && infra/deploy/deploy.sh` |
| Roll back to the previous version | `infra/deploy/deploy.sh rollback` (database migrations are additive, so the previous image still works) |
| API logs | `docker logs --since 1h source-connect-api-1`. JSON lines; passwords, cookies, CSRF tokens and card data are redacted |
| Access log | `/var/log/caddy/api-access.log` (rotated at 20 MB × 10) |
| PostgreSQL slow queries | `journalctl -u postgresql` (statements over 500 ms are logged) |
| Backup status | Admin → Backups, or `sudo -u postgres pgbackrest --stanza=source-connect info` |
| Server health | `infra/monitoring/sc-health.sh` |
| Disk usage | `df -h /`; `du -sh /var/lib/postgresql /srv/source-connect/uploads /var/lib/docker` |
| Lock out a staff member now | Admin → Staff & Roles → Disabled. All their sessions end at once |
| Reset a staff password | Admin → Staff & Roles → Edit → Reset password. They must change it at their next sign-in |

## PayHere: sandbox now, live only with the owner's approval

1. **Sandbox.** Create a sandbox merchant at sandbox.payhere.lk. In the sandbox portal, add the website domain and copy the *Merchant ID* and *Merchant Secret* (the secret is generated per domain/app). Put them in `api.env` with `PAYHERE_MODE=sandbox`, then switch on "Card payment" in Admin → Store Settings.
2. Test with PayHere's sandbox cards. Check that:
   - the order page waits, then turns to paid;
   - Admin → order → *PayHere notifications* shows `applied:paid` with a valid signature;
   - a cancelled payment releases the stock.
3. **Live** needs the owner's written approval, plus an approved live PayHere merchant account with the domain verified. Then:
   - set `PAYHERE_MODE=live`, `PAYHERE_LIVE_APPROVED=true`, and the live ID and secret;
   - redeploy and make one real low-value payment;
   - refund it from the PayHere portal and record the refund in Admin.

   The API refuses to start in live mode without `PAYHERE_LIVE_APPROVED=true`.
4. `notify_url` must be reachable from the internet over HTTPS. It is `https://api.<domain>/api/v1/payments/payhere/notify`, and Cloudflare must not challenge it: add a WAF skip rule for that one path.
5. Reconciliation: once a day, compare the PayHere portal's settled payments with Admin → Orders → *Paid*. Orders marked **Needs review** (late payment after the hold expired, or a chargeback) must be handled by Finance.

## Incident response (short version)

1. **Site down.** Check `/ready`, `docker ps`, `systemctl status postgresql caddy`, and `df -h`. If the last deploy caused it, run `deploy.sh rollback`.
2. **Suspected break-in or leaked password.**
   - Disable the staff account, or all accounts except the owner's.
   - Rotate secrets: DB password, PayHere secret (regenerate in the portal), R2 keys and SSH keys.
   - Revoke sessions: `DELETE FROM staff_sessions;`
   - Read the Audit Log and the Caddy access log.
   - Restore data if needed, following the backup runbook §4.
3. **Wrong prices published.** Fix the product. Orders already placed keep their price snapshot. Cancel or refund them case by case, which leaves a trail in the audit log.
4. **Payment shows paid at PayHere but not in Admin.** Look for the order's PayHere notification events:
   - a `rejected:bad_signature` result means the merchant secret is wrong;
   - no event at all means `notify_url` was blocked.

   Fix the cause, then ask PayHere to resend, or confirm by hand only after checking the portal.

## Secrets rotation (every 6–12 months, and after any staff member leaves)

| Secret | Where to change it | Then |
|---|---|---|
| DB password | `ALTER ROLE sc_app PASSWORD …` | Update `api.env` and redeploy |
| PayHere secret | PayHere portal | Update `api.env` and redeploy |
| R2 keys | Cloudflare | Update `secrets.env`, then run `pgbackrest check` |
| Backup encryption passphrase | **cannot** be changed for existing backups | Create a new stanza/repo with the new passphrase, and keep the old one until its backups expire |
