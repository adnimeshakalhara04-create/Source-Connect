#!/usr/bin/env bash
# Product photo backup (Supabase's own database backups do NOT include Storage files).
#   Supabase Storage (S3 protocol) --copy--> VPS folder --copy--> R2 through an rclone "crypt" remote (encrypted names + contents)
# "copy", never "sync": a photo deleted on the website (by mistake or by an attacker) stays in the backups.
# Old copies on R2 are removed only by the R2 lifecycle rule, never by this VPS.
. "$(dirname "$0")/lib.sh"
need SUPABASE_S3_REMOTE
: "${STORAGE_BUCKETS:=product-images}"
: "${CATALOG_DIR:=/var/lib/source-connect/catalog}"
MIRROR="$BACKUP_DIR/storage"
mkdir -p "$MIRROR"
fail() { log "FAILED: $1"; record image_sync failed "{\"error\": $(jstr "$1")}"; alert "Source Connect: photo backup FAILED" "$1"; exit 1; }
trap 'fail "unexpected error on line $LINENO"' ERR

record image_sync running '{}'
for b in $STORAGE_BUCKETS; do
  log "Supabase Storage bucket $b -> $MIRROR/$b"
  $RCLONE copy --checksum --transfers 4 "$SUPABASE_S3_REMOTE$b" "$MIRROR/$b" || fail "download of bucket $b failed"
done
FILES=$(find "$MIRROR" -type f | wc -l); BYTES=$(du -sb "$MIRROR" | cut -f1)

UPLOADED=false
if [ -n "${R2_STORAGE_REMOTE:-}" ]; then
  log "VPS copy -> R2 (encrypted)"
  $RCLONE copy --fast-list --transfers 4 "$MIRROR" "$R2_STORAGE_REMOTE/storage" || fail "upload of photos to R2 failed"
  [ -d "$CATALOG_DIR" ] && { $RCLONE copy "$CATALOG_DIR" "$R2_STORAGE_REMOTE/catalog" || fail "upload of catalogue snapshots failed"; }
  # every local file must exist on R2 with the same size (names are decrypted through the crypt remote;
  # --fast-list = one recursive listing: fewer billed requests on R2)
  $RCLONE check --fast-list --one-way --size-only "$MIRROR" "$R2_STORAGE_REMOTE/storage" 2> "$MIRROR.check.log" \
    || fail "R2 photo copy is incomplete: $(grep -m3 -E 'ERROR|NOTICE' "$MIRROR.check.log" | tr '\n' ' ')"
  UPLOADED=true
else
  log "warning: R2_STORAGE_REMOTE not set — photos kept on this VPS only"
fi
record image_sync ok "{\"files\": $FILES, \"bytes\": $BYTES, \"offsite\": $UPLOADED}"
ping_ok STORAGE_BACKUP_PING_URL
log "done: $FILES files, $BYTES bytes, offsite=$UPLOADED"
