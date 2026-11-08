#!/usr/bin/env bash
# Controlled deploy with automatic rollback. Run on the VPS from /opt/source-connect:
#   infra/deploy/deploy.sh            # deploy the current git commit
#   infra/deploy/deploy.sh rollback   # go back to the previously running image
# Migrations are forward-only and must be backward compatible (expand first, remove old columns in a later release),
# so the previous image keeps working after a rollback without undoing the database.
set -euo pipefail
cd "$(dirname "$0")/../.."
STATE=/etc/source-connect/deploy-state
COMPOSE="docker compose -f infra/compose.yaml"
health() { for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/ready >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

if [ "${1:-}" = rollback ]; then
  PREV=$(sed -n 2p "$STATE" 2>/dev/null); [ -n "$PREV" ] || { echo "no previous version recorded"; exit 1; }
  API_TAG=$PREV $COMPOSE up -d && health && { printf '%s\n%s\n' "$PREV" "$(sed -n 1p "$STATE")" > "$STATE"; echo "rolled back to $PREV"; exit 0; }
  echo "ROLLBACK FAILED — see docker logs"; exit 1
fi

[ -z "$(git status --porcelain)" ] || { echo "working tree has local changes; commit or discard them first"; exit 1; }
TAG=$(git rev-parse --short=12 HEAD)
CUR=$(sed -n 1p "$STATE" 2>/dev/null || true)
echo "== building image $TAG"
mkdir -p server/seed-catalogue && cp js/store.js server/seed-catalogue/store.js
docker build -t "source-connect-api:$TAG" server
echo "== emergency backup before migrating"
sudo -u postgres pgbackrest --stanza=source-connect --type=incr backup || { echo "backup failed — not deploying"; exit 1; }
echo "== migrations"
docker run --rm --network host --env-file /etc/source-connect/api.env "source-connect-api:$TAG" node dist/src/db/migrate.js
echo "== start $TAG"
API_TAG=$TAG $COMPOSE up -d
if health; then
  printf '%s\n%s\n' "$TAG" "$CUR" > "$STATE"
  echo "deployed $TAG (previous: ${CUR:-none})"
  docker image prune -f --filter "until=720h" >/dev/null || true
else
  echo "new version is not healthy — rolling back to ${CUR:-nothing}"
  [ -n "$CUR" ] && API_TAG=$CUR $COMPOSE up -d && health && echo "rolled back to $CUR"
  /opt/source-connect/infra/backup/alert.sh "Source Connect: DEPLOY FAILED" "version $TAG was not healthy; rolled back to ${CUR:-none}" || true
  exit 1
fi
