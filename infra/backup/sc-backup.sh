#!/usr/bin/env bash
# Usage: sc-backup.sh full|diff|incr   (run as the postgres user, e.g. from the systemd timers)
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
TYPE=${1:?full|diff|incr}
START=$(now_iso)
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
if $PGBR --stanza="$STANZA" --type="$TYPE" backup >"$OUT" 2>&1; then
  INFO=$($PGBR --stanza="$STANZA" --output=json info)
  LABEL=$(echo "$INFO" | python3 -c 'import json,sys; b=json.load(sys.stdin)[0]["backup"][-1]; print(json.dumps({"label":b["label"],"type":b["type"],"size":b["info"]["size"],"repo_size":b["info"]["repository"]["delta"],"wal_start":b["archive"]["start"],"wal_stop":b["archive"]["stop"]}))')
  record "$TYPE" ok "$START" "$LABEL"
  echo "backup $TYPE ok: $LABEL"
else
  MSG=$(tail -c 2000 "$OUT")
  record "$TYPE" failed "$START" "{\"error\": $(echo "$MSG" | json_escape)}"
  alert "Source Connect: $TYPE BACKUP FAILED" "$MSG"
  echo "$MSG" >&2; exit 1
fi
