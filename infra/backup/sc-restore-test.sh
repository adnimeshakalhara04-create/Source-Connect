#!/usr/bin/env bash
# Restores the off-site backup into a THROWAWAY directory on another port and checks the data.
# Never touches the live database. Usage:
#   sc-restore-test.sh                      # latest backup + all archived WAL
#   sc-restore-test.sh "2026-11-08 10:15:00+05:30"   # point-in-time recovery to that moment
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
TARGET=${1:-}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PORT=${RESTORE_PORT:-5499}
DIR=${RESTORE_DIR:-/var/lib/postgresql/restore-test}
DBNAME=${RESTORE_DBNAME:-source_connect}
START=$(now_iso); T0=$(date +%s)
cleanup() { "$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
rm -rf "$DIR"; mkdir -p "$DIR"; chmod 700 "$DIR"
# 1) every file in the repository still matches its checksum (detects damage or tampering in the bucket).
#    NOTE: pgbackrest 2.50 `verify` exits 0 even when it finds bad files, so read its report instead of the exit code.
if [ -z "$TARGET" ] && [ "${SKIP_VERIFY:-0}" != 1 ]; then
  VOUT=$($PGBR --stanza="$STANZA" --log-level-console=info verify 2>&1) || true
  if echo "$VOUT" | grep -qiE "status: invalid|checksum invalid|missing"; then
    record restore_test failed "$START" "{\"step\": \"verify\", \"error\": $(echo "$VOUT" | grep -iE 'invalid|missing' | head -5 | json_escape)}"
    alert "Source Connect: BACKUP FILES DAMAGED" "$(echo "$VOUT" | grep -iE 'invalid|missing' | head -10)"; exit 1
  fi
fi
# 2) restore into the throwaway directory
ARGS=(--stanza="$STANZA" --pg1-path="$DIR" --delta restore --archive-mode=off)
if [ -n "$TARGET" ]; then ARGS+=(--type=time "--target=$TARGET" --target-action=promote); fi
if ! OUT=$($PGBR "${ARGS[@]}" 2>&1); then
  record restore_test failed "$START" "{\"step\": \"restore\", \"error\": $(echo "$OUT" | json_escape)}"
  alert "Source Connect: RESTORE TEST FAILED" "$OUT"; exit 1
fi
cat >> "$DIR/postgresql.auto.conf" <<CONF
port = $PORT
listen_addresses = ''
unix_socket_directories = '/tmp'
archive_mode = off
CONF
"$PGBIN/pg_ctl" -D "$DIR" -l "$DIR/restore.log" -w -t 600 start >/dev/null
# wait until recovery is finished
for i in $(seq 1 120); do
  R=$(psql -h /tmp -p "$PORT" -d "$DBNAME" -qAt -c "select pg_is_in_recovery()" 2>/dev/null || true)
  [ "$R" = "f" ] && break; sleep 2
done
if ! V=$(psql -h /tmp -p "$PORT" -d "$DBNAME" -v ON_ERROR_STOP=1 -qAt -f "$HERE/verify.sql" 2>&1); then
  record restore_test failed "$START" "{\"step\": \"verify\", \"error\": $(echo "$V" | json_escape)}"
  alert "Source Connect: RESTORE TEST FAILED (data check)" "$V"; echo "$V" >&2; exit 1
fi
SECS=$(( $(date +%s) - T0 ))
DETAIL=$(echo "$V" | tail -1)
record restore_test ok "$START" "$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); d['seconds']=int(sys.argv[2]); d['target']=sys.argv[3] or 'latest'; print(json.dumps(d))" "$DETAIL" "$SECS" "$TARGET")"
echo "restore test ok in ${SECS}s: $DETAIL"
