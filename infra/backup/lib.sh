#!/usr/bin/env bash
# Shared helpers for the backup scripts. Records job results in PostgreSQL (backup_job_status, no secrets)
# so the admin panel can show backup health, and sends alerts on failure.
set -euo pipefail
STANZA=${STANZA:-source-connect}
PGBR=${PGBR:-pgbackrest}
STATUS_DB=${STATUS_DB:-}          # e.g. "host=/var/run/postgresql dbname=source_connect user=postgres"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

record() {  # record <kind> <ok|failed|running> <started-iso> <json-detail>
  [ -n "$STATUS_DB" ] || return 0
  psql "$STATUS_DB" -v ON_ERROR_STOP=1 -qAt -v kind="$1" -v st="$2" -v started="$3" -v detail="$4" <<'SQL' >/dev/null || echo "warning: could not record status" >&2
INSERT INTO backup_job_status (kind, status, started_at, finished_at, detail)
VALUES (:'kind', :'st', :'started'::timestamptz, CASE WHEN :'st' = 'running' THEN NULL ELSE now() END, :'detail'::jsonb);
SQL
}
alert() {   # alert <subject> <message>
  "$HERE/alert.sh" "$1" "$2" || echo "warning: alert could not be sent: $1" >&2
}
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()[-2000:]))'; }
