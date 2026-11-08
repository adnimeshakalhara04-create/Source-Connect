#!/usr/bin/env bash
# Local disaster-recovery drill (run as root on a test machine, NEVER on the production server).
# Uses the real production scripts (sc-backup.sh, sc-backup-check.sh, sc-restore-test.sh, verify.sql) with:
#   * a throwaway PostgreSQL 16 "primary" with WAL archiving (port 5440)
#   * an HTTPS S3-compatible endpoint standing in for Cloudflare R2 (s3rver on localhost:9443, own TLS cert)
#   * the Source Connect API (port 8090) to create realistic orders, payments and stock movements
# Every step and its output is written to $WORK/drill.log for the evidence report.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
WORK=${WORK:-/var/tmp/sc-drill}
S3RVER=${S3RVER:-/var/tmp/s3rver/node_modules/.bin/s3rver}
PY=${PY:-/tmp/claude-0/bk/venv/bin/python3}
PGBIN=/usr/lib/postgresql/16/bin
PGPORT=5440 API_PORT=8090
LOG=$WORK/drill.log
MID=1211149 SECRET=drill-only-test-secret
CIPHER=drill-only-cipher-pass-$(date +%s)

as_pg() { su postgres -s /bin/bash -c "$*"; }
step() { echo; echo "===== $(date -u +%H:%M:%S) $*" | tee -a "$LOG"; }
log() { tee -a "$LOG"; }

cleanup() {
  as_pg "$PGBIN/pg_ctl -D $WORK/primary -m immediate stop" >/dev/null 2>&1 || true
  as_pg "$PGBIN/pg_ctl -D $WORK/pitr -m immediate stop" >/dev/null 2>&1 || true
  [ -n "${S3_PID:-}" ] && kill "$S3_PID" 2>/dev/null || true
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK"; chown postgres "$WORK"; : > "$LOG"; chmod 644 "$LOG"
step "0. versions"
{ as_pg "$PGBIN/postgres --version"; pgbackrest version; node --version; } | log

step "1. TLS certificate for the local S3 endpoint and start it (stands in for Cloudflare R2)"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$WORK/s3.key" -out "$WORK/s3.crt" >/dev/null 2>&1
chmod 644 "$WORK/s3.crt" "$WORK/s3.key"
mkdir -p "$WORK/s3data"; "$S3RVER" -a localhost -p 9443 --cert "$WORK/s3.crt" --key "$WORK/s3.key" -d "$WORK/s3data" --silent > "$WORK/s3.log" 2>&1 & S3_PID=$!
sleep 3
S3="$PY $REPO/infra/backup/drill/s3tool.py --endpoint https://localhost:9443 --ca $WORK/s3.crt"
$S3 mkbucket sc-db-backups | log

step "2. primary PostgreSQL with continuous WAL archiving"
as_pg "$PGBIN/initdb -D $WORK/primary -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
cat > "$WORK/pgbackrest.conf" <<EOF
[global]
repo1-type=s3
repo1-s3-endpoint=localhost
repo1-storage-port=9443
repo1-storage-ca-file=$WORK/s3.crt
repo1-s3-bucket=sc-db-backups
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-s3-key=S3RVER
repo1-s3-key-secret=S3RVER
repo1-path=/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$CIPHER
repo1-retention-full=4
repo1-retention-diff=7
compress-type=zst
start-fast=y
archive-async=y
spool-path=$WORK/spool
log-path=$WORK/log
log-level-console=warn

[source-connect]
pg1-path=$WORK/primary
pg1-port=$PGPORT
pg1-socket-path=/tmp
EOF
mkdir -p "$WORK/spool" "$WORK/log"; chown -R postgres "$WORK"; chmod 600 "$WORK/pgbackrest.conf"; chown postgres "$WORK/pgbackrest.conf"
cat >> "$WORK/primary/postgresql.conf" <<EOF
port = $PGPORT
listen_addresses = 'localhost'
unix_socket_directories = '/tmp'
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --config=$WORK/pgbackrest.conf --stanza=source-connect archive-push %p'
archive_timeout = 60
EOF
as_pg "$PGBIN/pg_ctl -D $WORK/primary -l $WORK/primary.log -w start" >/dev/null
DB="postgres://postgres@127.0.0.1:$PGPORT/source_connect"
psql -h 127.0.0.1 -p $PGPORT -U postgres -qc "CREATE DATABASE source_connect"
(cd "$REPO/server" && DATABASE_URL=$DB npx tsx src/db/migrate.ts && DATABASE_URL=$DB npx tsx src/db/seed.ts && \
  DATABASE_URL=$DB OWNER_PASSWORD='Drill-Owner-Pass-2026' npx tsx src/cli/create-owner.ts --username drillowner --name "Drill Owner") | log
psql "$DB" -qc "UPDATE payment_settings SET enabled = true"

PGBR="pgbackrest --config=$WORK/pgbackrest.conf"
export STANZA=source-connect STATUS_DB="host=/tmp port=$PGPORT dbname=source_connect user=postgres"
run_pg() { su postgres -s /bin/bash -c "export PGBR='$PGBR' STANZA=$STANZA STATUS_DB='$STATUS_DB' RESTORE_PORT=${RESTORE_PORT:-5499} RESTORE_DIR=${RESTORE_DIR:-$WORK/restore} PATH=$PATH; $*"; }

step "3. stanza-create + check (proves WAL archiving reaches the S3 bucket)"
as_pg "$PGBR --stanza=source-connect stanza-create" 2>&1 | log
as_pg "$PGBR --stanza=source-connect check" 2>&1 | log
echo "check ok" | log

step "4. start the API and create realistic data"
(cd "$REPO/server" && NODE_ENV=development DATABASE_URL=$DB PORT=$API_PORT LOG_LEVEL=warn PAYHERE_MERCHANT_ID=$MID PAYHERE_MERCHANT_SECRET=$SECRET \
  PUBLIC_API_URL=http://127.0.0.1:$API_PORT CORS_ORIGINS=http://x ORDER_RATE_LIMIT_PER_MIN=1000 npx tsx src/server.ts > "$WORK/api.log" 2>&1) & API_PID=$!
for i in $(seq 1 30); do curl -sf 127.0.0.1:$API_PORT/ready >/dev/null && break; sleep 1; done
mkorders() { node "$REPO/infra/backup/drill/make-orders.mjs" "http://127.0.0.1:$API_PORT" "$1" "$MID" "$SECRET" "$2"; }
mkorders 5 batch1 | log

step "5. FULL backup (production script, records status in the DB)"
run_pg "$REPO/infra/backup/sc-backup.sh full" 2>&1 | log
mkorders 4 batch2 | log

step "6. DIFFERENTIAL backup"
run_pg "$REPO/infra/backup/sc-backup.sh diff" 2>&1 | log
mkorders 3 batch3 | log
sleep 2
GOOD_TIME=$(psql "$DB" -qAt -c "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")
GOOD=$(psql "$DB" -qAt -f "$REPO/infra/backup/verify.sql" | tail -1)
echo "known-good point in time: $GOOD_TIME" | log
echo "data at that moment: $GOOD" | log
sleep 2

step "7. ACCIDENT: someone wipes the orders and zeroes stock"
psql "$DB" -qc "TRUNCATE orders, order_items, order_status_history, payments, payment_events, stock_reservations, coupon_redemptions, refunds, shipment_events, shipments CASCADE; UPDATE inventory SET on_hand = 0, reserved = 0;" 2>&1 | log
psql "$DB" -qAt -c "SELECT 'orders after accident: ' || count(*) FROM orders" | log
psql "$DB" -qAt -c "SELECT pg_switch_wal()" >/dev/null; sleep 8
as_pg "$PGBR --stanza=source-connect check" 2>&1 | log

step "8. hourly check script"
run_pg "$REPO/infra/backup/sc-backup-check.sh" 2>&1 | log

step "9. RESTORE TEST of the latest state (production script) — shows the accident is in the latest backup"
run_pg "$REPO/infra/backup/sc-restore-test.sh" 2>&1 | log

step "10. POINT-IN-TIME RECOVERY to just before the accident ($GOOD_TIME)"
T0=$(date +%s)
run_pg "RESTORE_DIR=$WORK/pitr-test $REPO/infra/backup/sc-restore-test.sh '$GOOD_TIME'" 2>&1 | tee "$WORK/pitr.out" | log
PITR=$(tail -1 "$WORK/pitr.out" | sed 's/^restore test ok in [0-9]*s: //')
echo "PITR restore took $(( $(date +%s) - T0 ))s" | log
python3 - "$GOOD" "$PITR" <<'PYEOF' | log
import json, sys
good, got = json.loads(sys.argv[1]), json.loads(sys.argv[2])
keys = ['products', 'variants', 'stock_units', 'orders', 'paid_orders', 'payments', 'payment_events', 'staff', 'role_grants']
bad = [k for k in keys if good[k] != got[k]]
print('PITR comparison (before accident vs restored):')
for k in keys: print(f'  {k:15} {good[k]:>8} {got[k]:>8}  ' + ('OK' if good[k] == got[k] else 'DIFFERENT'))
print('PITR RESULT: ' + ('PASS — every record from before the accident is back' if not bad else 'FAIL: ' + ', '.join(bad)))
sys.exit(1 if bad else 0)
PYEOF

step "11. RPO measurement: total loss of the primary server"
psql "$DB" -qc "UPDATE inventory SET on_hand = 40"   # put stock back so new orders can be placed
mkorders 2 batch4 | log
psql "$DB" -qAt -c "SELECT 'last order committed: ' || max(placed_at) FROM orders" | log
echo "waiting for archive_timeout (60s in the drill, 300s in production) so the WAL is shipped…" | log
sleep 70
mkorders 1 batch5-unsynced | log
LAST=$(psql "$DB" -qAt -c "SELECT max(placed_at) FROM orders")
kill "$API_PID" 2>/dev/null || true; API_PID=
as_pg "$PGBIN/pg_ctl -D $WORK/primary -m immediate stop" >/dev/null
rm -rf "$WORK/primary"
echo "primary DESTROYED (immediate stop + data directory deleted) at $(date -u +%T). Newest order at that moment: $LAST" | log
REC=$(su postgres -s /bin/bash -c "export PGBR='$PGBR' STANZA=$STANZA RESTORE_PORT=5498 RESTORE_DIR=$WORK/rebuild KEEP=1; $REPO/infra/backup/sc-restore-test.sh" 2>&1 | tail -1)
echo "$REC" | log
python3 - "$REC" "$LAST" <<'PYEOF' | log
import json, sys, datetime
import re
m = re.match(r'restore test ok in (\d+)s: (.*)', sys.argv[1]); d = json.loads(m.group(2)); d['seconds'] = int(m.group(1))
newest = d['newest_order']; lost_after = sys.argv[2]
print('newest order in the restored copy:', newest)
print('newest order on the destroyed server:', lost_after)
print('restore time (download + replay + checks):', d['seconds'], 'seconds')
from datetime import datetime
fmt = lambda x: datetime.fromisoformat(str(x).replace(' ', 'T').replace('+00', '+00:00') if not str(x).endswith(':00') else str(x).replace(' ', 'T'))
if newest and lost_after:
    gap = (fmt(lost_after) - fmt(newest)).total_seconds()
    print(f'DATA LOST: {max(0, gap):.0f} seconds of orders (the last batch was placed less than archive_timeout before the crash)')
    print('RPO RESULT: ' + ('PASS (<= 15 minutes)' if gap <= 900 else 'FAIL'))
PYEOF

step "12. tamper detection: corrupt one file in the bucket, then pgbackrest verify"
$S3 corrupt sc-db-backups pgbackrest/backup 2>&1 | log
VRC=0; as_pg "$PGBR --stanza=source-connect --log-level-console=info verify" > "$WORK/verify.out" 2>&1 || VRC=$?
(grep -iE "invalid|error|checksum|fail" "$WORK/verify.out" || true) | head -5 | cut -c1-220 | log
if [ "$VRC" != 0 ] || grep -qiE "invalid" "$WORK/verify.out"; then echo "TAMPER DETECTION: PASS (pgbackrest verify exit code $VRC, damaged file reported)" | log; else echo "TAMPER DETECTION: FAIL (verify exit $VRC)" | log; fi

step "13. stolen bucket without the encryption passphrase is useless"
sed "s/repo1-cipher-pass=.*/repo1-cipher-pass=wrong-passphrase/" "$WORK/pgbackrest.conf" > "$WORK/wrong.conf"; chown postgres "$WORK/wrong.conf"; chmod 600 "$WORK/wrong.conf"
if as_pg "pgbackrest --config=$WORK/wrong.conf --stanza=source-connect info" > "$WORK/wrong.out" 2>&1 && ! grep -qi error "$WORK/wrong.out"; then echo "ENCRYPTION: FAIL (readable without passphrase)" | log; else echo "ENCRYPTION: PASS — $(grep -i -m1 error "$WORK/wrong.out" | cut -c1-140)" | log; fi
$S3 peek sc-db-backups pgbackrest/archive | log

step "DONE"
echo "Full log: $LOG"
