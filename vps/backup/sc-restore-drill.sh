#!/usr/bin/env bash
# Restore drill: proves the newest backup can really be brought back. Weekly by systemd timer, and before launch.
#   1. take the newest backup from R2 (or a given local file) and check its SHA-256
#   2. decrypt (age identity = the drill key; the owner also has an offline key)
#   3. start a throw-away Supabase Postgres 17 container (same image family as the hosted database)
#   4. restore, re-create the scheduled jobs, run verify-supabase.sql (money, stock, accounts, security)
#   5. compare row counts with the counts taken just before the dump (restored must be >= before)
#   6. write an evidence file, record the result for the admin Backups page, remove the container
# It never touches the live Supabase project.
. "$(dirname "$0")/lib.sh"
need AGE_IDENTITY_FILE
: "${SCRATCH_IMAGE:=public.ecr.aws/supabase/postgres:17.11.0.006}"
: "${DOCKER:=docker}"
NAME=sc-restore-drill-$$
EVID="$BACKUP_DIR/drills"; mkdir -p "$EVID"
WORK=$(mktemp -d "$BACKUP_DIR/.drill-XXXXXX")
T0=$(date +%s)
cleanup() { [ "${KEEP_SCRATCH:-0}" = 1 ] && log "scratch container kept: $NAME" || $DOCKER rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() { log "FAILED: $1"; record restore_test failed "{\"error\": $(jstr "$1"), \"backup\": $(jstr "${SRC:-}")}"; alert "Source Connect: restore drill FAILED" "$1"; exit 1; }
trap 'fail "unexpected error on line $LINENO"' ERR
record restore_test running '{}'

log "1/6 choose and check the backup"
if [ -n "${1:-}" ]; then
  SRC=$1; cp "$SRC" "$WORK/b.tar.age"; EXPECTED=$(cut -d' ' -f1 "$SRC.sha256")
else
  need R2_DB_REMOTE
  SRC=$($RCLONE lsf "$R2_DB_REMOTE/db/" --include 'sc-db-*.tar.age' | sort | tail -1)
  [ -n "$SRC" ] || fail "no backups found on R2"
  $RCLONE copyto "$R2_DB_REMOTE/db/$SRC" "$WORK/b.tar.age" || fail "download from R2 failed"
  EXPECTED=$($RCLONE cat "$R2_DB_REMOTE/db/$SRC.sha256" | cut -d' ' -f1) || fail "checksum file missing on R2"
fi
ACTUAL=$(sha256sum "$WORK/b.tar.age" | cut -d' ' -f1)
[ "$ACTUAL" = "$EXPECTED" ] || fail "checksum mismatch for $SRC"
log "   $SRC sha256 ok"

log "2/6 decrypt"
$AGE --decrypt -i "$AGE_IDENTITY_FILE" "$WORK/b.tar.age" | tar -C "$WORK" -xf - || fail "decryption failed (wrong key or damaged file)"
[ "$(sha256sum "$WORK/db.pgc" | cut -d' ' -f1)" = "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["db_pgc_sha256"])' "$WORK/manifest.json")" ] \
  || fail "dump inside the bundle does not match its manifest"

log "3/6 scratch database ($SCRATCH_IMAGE)"
SCRATCH_PW=$(openssl rand -hex 16)
$DOCKER run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$SCRATCH_PW" "$SCRATCH_IMAGE" >/dev/null || fail "cannot start scratch database"
for _ in $(seq 1 60); do $DOCKER exec "$NAME" pg_isready -U postgres -q 2>/dev/null && $DOCKER exec "$NAME" psql -U supabase_admin -d postgres -Atqc 'select 1' >/dev/null 2>&1 && break; sleep 2; done
sleep 3   # the image runs its own init scripts after the first ready signal
X() { $DOCKER exec -i "$NAME" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

log "4/6 restore"
T1=$(date +%s)
# Supabase services create auth/storage tables at start-up; the backup brings its own, so the empty ones go first.
X -c "DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS storage CASCADE;
      CREATE EXTENSION IF NOT EXISTS citext SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_cron;
      DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sc_worker') THEN CREATE ROLE sc_worker NOLOGIN NOINHERIT; END IF; END\$\$;" 2>/dev/null \
  || fail "scratch preparation failed"
# IMPORTANT: Supabase gives anon/authenticated/service_role automatic grants on every new function/table in schema public
# (ALTER DEFAULT PRIVILEGES). pg_dump does not undo those, so a plain restore would let website visitors call
# server-only functions such as place_order. Switch the automatic grants off for the restore; the dump then
# brings back exactly the original grants (checked below with the security fingerprint).
X -c "DO \$\$DECLARE r record; BEGIN
        FOR r IN SELECT pg_get_userbyid(defaclrole) AS rol, defaclnamespace::regnamespace::text AS nsp, defaclobjtype AS t FROM pg_default_acl
                  WHERE defaclnamespace::regnamespace::text = 'public' LOOP
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM anon, authenticated, service_role',
                         r.rol, r.nsp, CASE r.t WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES' END);
        END LOOP; END\$\$;" 2>/dev/null \
  || fail "scratch preparation failed"
$DOCKER cp "$WORK/db.pgc" "$NAME:/tmp/db.pgc"
$DOCKER exec "$NAME" sh -c 'pg_restore -l /tmp/db.pgc | grep -v " SCHEMA - public " > /tmp/db.list' || fail "cannot read dump table of contents"
$DOCKER exec "$NAME" pg_restore -U supabase_admin -d postgres --exit-on-error -L /tmp/db.list /tmp/db.pgc 2> "$WORK/restore.err" \
  || fail "pg_restore failed: $(head -c 500 "$WORK/restore.err")"
X < "$WORK/cron.sql" >/dev/null || fail "re-creating scheduled jobs failed"
RESTORE_S=$(( $(date +%s) - T1 ))

log "5/6 verify"
X < "$HERE/verify-supabase.sql" 2> "$WORK/verify.err" || fail "verification failed: $(head -c 500 "$WORK/verify.err")"
AFTER=$(X -At < "$HERE/counts.sql")
python3 - "$WORK/manifest.json" "$AFTER" <<'PY' || fail "restored copy has fewer rows than before the dump, or different permissions"
import json, sys
before = json.load(open(sys.argv[1]))["counts_before_dump"]; after = json.loads(sys.argv[2])
grow_only = ["orders", "order_items", "payments", "payment_events", "order_status_history", "audit_logs", "products", "variants"]
bad = [k for k in grow_only if after[k] < before[k]]
if bad: print("fewer rows after restore:", {k: (before[k], after[k]) for k in bad}, file=sys.stderr); sys.exit(1)
if after["security_fingerprint"] != before["security_fingerprint"]:
    print("permissions differ from the original (security fingerprint mismatch)", file=sys.stderr); sys.exit(1)
PY

log "6/6 evidence"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TOTAL_S=$(( $(date +%s) - T0 ))
cat > "$EVID/drill-$STAMP.json" <<EOF
{"drill_at": "$STARTED", "backup": "$SRC", "backup_sha256": "$ACTUAL", "manifest": $(cat "$WORK/manifest.json"),
 "restored_counts": $AFTER, "verify_sql": "passed", "restore_seconds": $RESTORE_S, "total_seconds": $TOTAL_S,
 "scratch_image": "$SCRATCH_IMAGE", "host": "$(hostname)"}
EOF
record restore_test ok "{\"backup\": $(jstr "$SRC"), \"restore_seconds\": $RESTORE_S, \"total_seconds\": $TOTAL_S, \"counts\": $AFTER}"
ping_ok RESTORE_DRILL_PING_URL
log "PASSED: $SRC restored and verified in ${TOTAL_S}s (restore ${RESTORE_S}s). Evidence: $EVID/drill-$STAMP.json"
