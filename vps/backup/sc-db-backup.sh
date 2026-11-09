#!/usr/bin/env bash
# Independent database backup of the Supabase project, made on the VPS (hourly by systemd timer).
#   1. row counts before the dump (used later by the restore drill)
#   2. pg_dump (custom format) of the schemas that hold our data: app, auth, storage (file list), public (API functions)
#   3. the scheduled jobs (pg_cron) as SQL
#   4. bundle -> encrypt with age to PUBLIC keys only (the VPS cannot decrypt unless it holds a drill key)
#   5. SHA-256 checksum, keep locally for LOCAL_KEEP_DAYS, upload to Cloudflare R2, check the upload
#   6. record the result in the database (admin Backups page); alert the owner on any failure
# This complements, and does not replace, Supabase's own daily backups / PITR.
. "$(dirname "$0")/lib.sh"
need BACKUP_DATABASE_URL; need AGE_RECIPIENTS_FILE
[ -s "$AGE_RECIPIENTS_FILE" ] || { log "no age public keys in $AGE_RECIPIENTS_FILE"; exit 2; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="sc-db-$STAMP"
mkdir -p "$BACKUP_DIR/db"
WORK=$(mktemp -d "$BACKUP_DIR/.work-XXXXXX")
trap 'rm -rf "$WORK"' EXIT
fail() { log "FAILED: $1"; record full failed "{\"error\": $(jstr "$1"), \"file\": \"$NAME.tar.age\"}"; alert "Source Connect: database backup FAILED" "$1 ($NAME)"; exit 1; }
trap 'fail "unexpected error on line $LINENO"' ERR

record full running "{\"file\": \"$NAME.tar.age\"}"
log "1/6 row counts"
COUNTS=$($PSQL "$BACKUP_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -f "$HERE/counts.sql") || fail "cannot read row counts (database unreachable?)"

log "2/6 pg_dump"
# shellcheck disable=SC2086  # PG_DUMP may be a command with arguments (e.g. a docker run for the local drill)
$PG_DUMP "$BACKUP_DATABASE_URL" --format=custom --compress=6 --schema=app --schema=auth --schema=storage --schema=public \
  > "$WORK/db.pgc" || fail "pg_dump failed"
[ "$(head -c 5 "$WORK/db.pgc")" = "PGDMP" ] || fail "dump file is not a PostgreSQL custom-format archive"

log "3/6 scheduled jobs"
$PSQL "$BACKUP_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 \
  -c "SELECT format('SELECT cron.schedule(%L, %L, %L);', jobname, schedule, command) FROM cron.job ORDER BY jobname" > "$WORK/cron.sql" \
  || fail "cannot read pg_cron jobs"

DUMP_SHA=$(sha256sum "$WORK/db.pgc" | cut -d' ' -f1)
SERVER_VERSION=$($PSQL "$BACKUP_DATABASE_URL" -XAtq -c "SHOW server_version" | cut -d' ' -f1)
DUMP_VERSION=$($PG_DUMP --version | awk '{print $NF}')
cat > "$WORK/manifest.json" <<EOF
{"name": "$NAME", "created_at": "$STARTED", "server_version": "$SERVER_VERSION", "pg_dump_version": "$DUMP_VERSION",
 "schemas": ["app","auth","storage","public"], "db_pgc_sha256": "$DUMP_SHA", "counts_before_dump": $COUNTS}
EOF

log "4/6 encrypt (age, public keys only)"
OUT="$BACKUP_DIR/db/$NAME.tar.age"
tar -C "$WORK" -cf - manifest.json db.pgc cron.sql | $AGE --encrypt -R "$AGE_RECIPIENTS_FILE" -o "$OUT.part" || fail "encryption failed"
mv "$OUT.part" "$OUT"
( cd "$BACKUP_DIR/db" && sha256sum "$NAME.tar.age" > "$NAME.tar.age.sha256" )
SIZE=$(stat -c %s "$OUT"); SHA=$(cut -d' ' -f1 "$OUT.sha256")

log "5/6 upload to R2 and keep $LOCAL_KEEP_DAYS days locally"
UPLOADED=false
if [ -n "${R2_DB_REMOTE:-}" ]; then
  $RCLONE copy --no-traverse "$OUT" "$R2_DB_REMOTE/db/" || fail "upload to R2 failed"
  $RCLONE copy --no-traverse "$OUT.sha256" "$R2_DB_REMOTE/db/" || fail "upload of checksum to R2 failed"
  REMOTE_SIZE=$($RCLONE lsjson "$R2_DB_REMOTE/db/$NAME.tar.age" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["Size"])') || fail "uploaded file not found on R2"
  [ "$REMOTE_SIZE" = "$SIZE" ] || fail "R2 copy has the wrong size ($REMOTE_SIZE, expected $SIZE)"
  UPLOADED=true
else
  log "warning: R2_DB_REMOTE not set — backup kept on this VPS only"
fi
find "$BACKUP_DIR/db" -maxdepth 1 -name 'sc-db-*.tar.age*' -mtime +"$LOCAL_KEEP_DAYS" -delete

log "6/6 record"
record full ok "{\"file\": \"$NAME.tar.age\", \"bytes\": $SIZE, \"sha256\": \"$SHA\", \"offsite\": $UPLOADED, \"counts\": $COUNTS}"
ping_ok DB_BACKUP_PING_URL
log "done: $OUT ($SIZE bytes, offsite=$UPLOADED)"
echo "$OUT"
