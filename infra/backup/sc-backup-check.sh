#!/usr/bin/env bash
# Hourly: proves WAL archiving works end-to-end (pgbackrest check) and that the newest backup is not too old.
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
MAX_AGE_H=${MAX_AGE_H:-26}
START=$(now_iso)
PROBLEMS=()
if ! CHECK=$($PGBR --stanza="$STANZA" check 2>&1); then PROBLEMS+=("pgbackrest check failed: $(echo "$CHECK" | tail -3 | tr '\n' ' ')"); fi
INFO=$($PGBR --stanza="$STANZA" --output=json info 2>&1) || PROBLEMS+=("pgbackrest info failed")
AGE_H=$(echo "$INFO" | python3 -c 'import json,sys,time
try:
  d=json.load(sys.stdin)[0]; b=d.get("backup",[])
  print(round((time.time()-b[-1]["timestamp"]["stop"])/3600,1) if b else -1)
except Exception: print(-2)' 2>/dev/null || echo -2)
case "$AGE_H" in -1) PROBLEMS+=("no backup exists yet");; -2) PROBLEMS+=("cannot read backup info");; esac
if python3 -c "import sys; sys.exit(0 if float('$AGE_H') > $MAX_AGE_H else 1)"; then PROBLEMS+=("newest backup is ${AGE_H}h old (limit ${MAX_AGE_H}h)"); fi
# WAL archiver errors reported by PostgreSQL itself
if [ -n "$STATUS_DB" ]; then
  FAIL=$(psql "$STATUS_DB" -qAt -c "SELECT CASE WHEN last_failed_time > coalesce(last_archived_time, 'epoch') THEN 'last WAL archive attempt failed at ' || last_failed_time END FROM pg_stat_archiver" 2>/dev/null || true)
  [ -n "$FAIL" ] && PROBLEMS+=("$FAIL")
  LAG=$(psql "$STATUS_DB" -qAt -c "SELECT coalesce(round(extract(epoch FROM now() - last_archived_time)/60), -1) FROM pg_stat_archiver" 2>/dev/null || echo -1)
fi
if [ ${#PROBLEMS[@]} -eq 0 ]; then
  record check ok "$START" "{\"newest_backup_age_hours\": $AGE_H, \"minutes_since_last_wal_archived\": ${LAG:--1}}"
  echo "backups healthy (newest ${AGE_H}h old)"
else
  MSG=$(printf '%s\n' "${PROBLEMS[@]}")
  record check failed "$START" "{\"problems\": $(echo "$MSG" | json_escape)}"
  alert "Source Connect: BACKUP PROBLEM" "$MSG"
  echo "$MSG" >&2; exit 1
fi
