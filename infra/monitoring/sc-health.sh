#!/usr/bin/env bash
# Every 5 minutes (systemd timer): alert the owner when something needs attention.
# Checks: API readiness, disk, memory, load, PostgreSQL connections, PayHere callback errors, TLS certificate expiry.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ALERT="$HERE/../backup/alert.sh"
API_DOMAIN=${API_DOMAIN:-}
STATE=/var/tmp/sc-health.last; touch "$STATE"
P=()
curl -fsS -m 10 http://127.0.0.1:8080/ready >/dev/null 2>&1 || P+=("API is not ready (http://127.0.0.1:8080/ready)")
DISK=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "$DISK" -ge 85 ] && P+=("Disk ${DISK}% full")
MEM=$(free | awk '/Mem:/ {printf "%d", $7/$2*100}'); [ "$MEM" -le 8 ] && P+=("Only ${MEM}% memory available")
LOAD=$(awk '{print int($2)}' /proc/loadavg); [ "$LOAD" -ge 4 ] && P+=("High load average (5 min): $LOAD on 2 CPUs")
CONN=$(sudo -u postgres psql -qAt -c "select count(*) from pg_stat_activity" 2>/dev/null || echo 0); [ "$CONN" -ge 50 ] && P+=("PostgreSQL connections: $CONN (max 60)")
BAD=$(sudo -u postgres psql -d source_connect -qAt -c "select count(*) from payment_events where received_at > now() - interval '1 hour' and result like 'rejected:%'" 2>/dev/null || echo 0)
[ "${BAD:-0}" -ge 5 ] && P+=("$BAD rejected PayHere notifications in the last hour (wrong secret? attack?)")
if [ -n "$API_DOMAIN" ]; then
  END=$(echo | openssl s_client -connect "$API_DOMAIN:443" -servername "$API_DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$END" ]; then DAYS=$(( ($(date -d "$END" +%s) - $(date +%s)) / 86400 )); [ "$DAYS" -le 14 ] && P+=("TLS certificate for $API_DOMAIN expires in $DAYS days"); fi
fi
if [ ${#P[@]} -gt 0 ]; then
  MSG=$(printf '%s\n' "${P[@]}")
  # do not repeat the same alert more than once an hour
  if [ "$MSG" != "$(cat "$STATE")" ] || [ $(( $(date +%s) - $(stat -c %Y "$STATE") )) -ge 3600 ]; then "$ALERT" "Source Connect: server needs attention" "$MSG"; echo "$MSG" > "$STATE"; fi
  echo "$MSG"; exit 1
fi
: > "$STATE"; echo ok
