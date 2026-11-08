#!/usr/bin/env bash
# alert.sh "<subject>" "<message>" — sends an operations alert to the owner.
# Configure ONE of these in /etc/source-connect/alert.env (mode 0600):
#   ALERT_WEBHOOK_URL=https://ntfy.sh/<secret-topic>        (phone push via the free ntfy app) or a Slack/Discord webhook
#   ALERT_EMAIL=owner@example.lk                             (needs a working `mail`/`sendmail`, e.g. msmtp)
set -u
[ -f /etc/source-connect/alert.env ] && . /etc/source-connect/alert.env
SUBJECT=${1:-Source Connect alert}; MSG=${2:-}
logger -t source-connect-alert "$SUBJECT: $MSG" 2>/dev/null || true
sent=0
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  curl -fsS -m 15 -H "Title: $SUBJECT" -d "$MSG" "$ALERT_WEBHOOK_URL" >/dev/null && sent=1
fi
if [ -n "${ALERT_EMAIL:-}" ] && command -v mail >/dev/null; then
  printf '%s\n' "$MSG" | mail -s "$SUBJECT" "$ALERT_EMAIL" && sent=1
fi
[ $sent = 1 ] || { echo "ALERT NOT DELIVERED (no channel configured): $SUBJECT" >&2; exit 1; }
