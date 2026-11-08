#!/usr/bin/env bash
# Daily copy of product images to a SEPARATE private backup bucket (database backups do not include images).
# Deleted/overwritten images are kept for 90 days under _deleted/<date>/ so a mistake or attack can be undone.
# Needs rclone with two remotes in /etc/source-connect/rclone.conf: `images` (live bucket or local dir) and `imgbackup`.
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
SRC=${IMAGES_SRC:-images:source-connect-images}
DST=${IMAGES_DST:-imgbackup:source-connect-image-backups}
START=$(now_iso); DAY=$(date -u +%F)
export RCLONE_CONFIG=${RCLONE_CONFIG:-/etc/source-connect/rclone.conf}
if OUT=$(rclone sync "$SRC" "$DST/current" --backup-dir "$DST/_deleted/$DAY" --checksum --stats-one-line -v 2>&1); then
  rclone delete "$DST/_deleted" --min-age 90d --rmdirs >/dev/null 2>&1 || true
  record image_sync ok "$START" "{\"summary\": $(echo "$OUT" | tail -3 | json_escape)}"
else
  record image_sync failed "$START" "{\"error\": $(echo "$OUT" | json_escape)}"
  alert "Source Connect: IMAGE BACKUP FAILED" "$OUT"; exit 1
fi
