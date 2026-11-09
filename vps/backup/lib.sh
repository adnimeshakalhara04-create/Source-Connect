#!/usr/bin/env bash
# Shared helpers for the Source Connect VPS backup scripts. Sourced, not run.
# Settings: /etc/source-connect/backup.env (root:root 0600). Template: vps/backup/backup.env.example
set -euo pipefail
umask 077
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE=${SC_BACKUP_ENV:-/etc/source-connect/backup.env}
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

: "${BACKUP_DIR:=/var/backups/source-connect}"
: "${PG_DUMP:=pg_dump}"            # must be PostgreSQL 17 client tools (same major version as Supabase)
: "${PSQL:=psql}"
: "${RCLONE:=rclone}"
: "${AGE:=age}"
: "${LOCAL_KEEP_DAYS:=7}"
: "${ALERT:=$HERE/../../infra/backup/alert.sh}"
export RCLONE_CONFIG=${RCLONE_CONFIG:-/etc/source-connect/rclone.conf}

STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log() { echo "$(date -u +%H:%M:%S) $*" >&2; }
need() { [ -n "${!1:-}" ] || { log "setting $1 is missing in $ENV_FILE"; exit 2; }; }

# Writes a row to app.backup_job_status (shown on the admin Backups page) using the least-privilege worker role.
# Never fails the backup itself: if the database is unreachable the alert below still fires.
record() {  # record <kind> <ok|failed|running> <detail-json>
  [ -n "${WORKER_DATABASE_URL:-}" ] || return 0
  # psql only substitutes :'variables' in SQL read from stdin/files (not -c), and quotes them safely
  echo "SELECT app.worker_record_backup(:'kind', :'status', :'started'::timestamptz, :'detail'::jsonb)" |
    $PSQL "$WORKER_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -v kind="$1" -v status="$2" -v started="$STARTED" -v detail="$3" >/dev/null 2>&1 \
    || log "warning: could not record $1/$2 in the database"
}
# Optional "dead man's switch": an outside service (e.g. healthchecks.io or Uptime Kuma push monitor) expects this ping
# after every success and alerts the owner when pings STOP — this also covers "the whole VPS is down".
ping_ok() { local url=${!1:-}; [ -n "$url" ] && curl -fsS -m 10 --retry 3 "$url" >/dev/null 2>&1 || true; }
alert() { [ -x "$ALERT" ] && "$ALERT" "$1" "$2" || log "ALERT: $1 — $2"; }

# json-escape a string for detail fields
jstr() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
