#!/usr/bin/env bash
# Local disaster-recovery drill for the Supabase + VPS + R2 design. Test machine only, NEVER production.
# Runs the REAL scripts (sc-db-backup.sh, sc-storage-backup.sh, sc-restore-drill.sh) against:
#   * the local Supabase stack (`supabase start`) as "the live project"
#   * s3rver over HTTPS on localhost:9443 standing in for Cloudflare R2
# Writes every step to $WORK/drill.log (no secrets are printed) for docs/evidence/.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
B=$REPO/vps/backup
WORK=${WORK:-/var/tmp/sc-hybrid-drill}
S3RVER=${S3RVER:-/var/tmp/s3rver/node_modules/.bin/s3rver}
IMG=${SCRATCH_IMAGE:-public.ecr.aws/supabase/postgres:17.11.0.006}
LOG=$WORK/drill.log
step() { echo; echo "===== $(date -u +%H:%M:%S) $*" | tee -a "$LOG"; }
log() { tee -a "$LOG"; }
expect_fail() { if "$@" >>"$LOG" 2>&1; then echo "UNEXPECTED SUCCESS: $*" | log; exit 1; else echo "refused as expected" | log; fi; }
cleanup() { [ -n "${S3_PID:-}" ] && kill "$S3_PID" 2>/dev/null || true; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK"/{etc,backups}; : > "$LOG"
ST=$(cd "$REPO" && npx -y supabase@2 status -o json 2>/dev/null)
j() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$ST" "$1"; }
API=$(j API_URL); SERVICE=$(j SERVICE_ROLE_KEY); ANON=$(j ANON_KEY)

step "0. versions"
{ docker run --rm "$IMG" pg_dump --version; psql --version; age --version; rclone version | head -1; node --version; } | log

step "1. local stand-in for Cloudflare R2 (s3rver, HTTPS with its own certificate)"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$WORK/s3.key" -out "$WORK/s3.crt" >/dev/null 2>&1
mkdir -p "$WORK/r2data"; "$S3RVER" -a localhost -p 9443 --cert "$WORK/s3.crt" --key "$WORK/s3.key" -d "$WORK/r2data" --silent > "$WORK/s3.log" 2>&1 & S3_PID=$!
sleep 3

step "2. encryption keys: a drill key (on the VPS) + the owner's offline key; backups are encrypted to BOTH public keys"
age-keygen -o "$WORK/etc/drill.key" 2>/dev/null; age-keygen -o "$WORK/etc/owner-offline.key" 2>/dev/null
{ age-keygen -y "$WORK/etc/drill.key"; age-keygen -y "$WORK/etc/owner-offline.key"; } > "$WORK/etc/recipients.txt"
echo "public keys in recipients.txt: $(wc -l < "$WORK/etc/recipients.txt") (private keys are never printed)" | log

step "3. rclone remotes: r2 (backups bucket), r2crypt (encrypted photos), supabase (Storage S3 protocol)"
CRYPT_PW=$(rclone obscure "$(openssl rand -base64 32)"); CRYPT_SALT=$(rclone obscure "$(openssl rand -base64 32)")
cat > "$WORK/etc/rclone.conf" <<EOF
[r2]
type = s3
provider = Other
endpoint = https://localhost:9443
access_key_id = S3RVER
secret_access_key = S3RVER
force_path_style = true

[r2crypt]
type = crypt
remote = r2:sc-backups/files
password = $CRYPT_PW
password2 = $CRYPT_SALT

[supabase]
type = s3
provider = Other
endpoint = $(j STORAGE_S3_URL)
access_key_id = $(j S3_PROTOCOL_ACCESS_KEY_ID)
secret_access_key = $(j S3_PROTOCOL_ACCESS_KEY_SECRET)
region = $(j S3_PROTOCOL_REGION)
force_path_style = true
EOF
cat "${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}" "$WORK/s3.crt" > "$WORK/ca-bundle.crt"   # system CAs + the stand-in's own certificate
unset AWS_CA_BUNDLE   # set by some sandboxes; rclone 1.60 cannot use it
export RCLONE_CONFIG=$WORK/etc/rclone.conf SSL_CERT_FILE=$WORK/ca-bundle.crt
export NO_PROXY="localhost,127.0.0.1${NO_PROXY:+,$NO_PROXY}" no_proxy="localhost,127.0.0.1${no_proxy:+,$no_proxy}"
rclone mkdir r2:sc-backups 2>&1 | log
echo "buckets on the R2 stand-in: $(rclone lsd r2: | awk '{print $NF}')" | log

cat > "$WORK/etc/backup.env" <<EOF
BACKUP_DIR=$WORK/backups
BACKUP_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
WORKER_DATABASE_URL=postgresql://sc_worker:local-worker-test-only@127.0.0.1:54322/postgres
PG_DUMP="docker run --rm -i --network host $IMG pg_dump"
AGE_RECIPIENTS_FILE=$WORK/etc/recipients.txt
AGE_IDENTITY_FILE=$WORK/etc/drill.key
R2_DB_REMOTE=r2:sc-backups
R2_STORAGE_REMOTE=r2crypt:
SUPABASE_S3_REMOTE=supabase:
CATALOG_DIR=$WORK/catalog
SCRATCH_IMAGE=$IMG
RCLONE_CONFIG=$WORK/etc/rclone.conf
ALERT=/bin/false
EOF
export SC_BACKUP_ENV=$WORK/etc/backup.env
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -XAtqc "ALTER ROLE sc_worker WITH LOGIN PASSWORD 'local-worker-test-only'"

step "4. real shop activity: 3 orders through the checkout Edge Function + a product photo upload"
ORDERS=()
for slug in kids-1 kids-2 womens-1; do
  size=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -XAtc "UPDATE app.inventory i SET on_hand = 5, reserved = 0 FROM app.product_variants v JOIN app.products p ON p.id = v.product_id WHERE v.id = i.variant_id AND p.slug = '$slug' AND v.sort_order = (SELECT min(sort_order) FROM app.product_variants WHERE product_id = p.id) RETURNING v.size" | head -1)
  r=$(curl -fsS "$API/functions/v1/checkout" -H "apikey: $ANON" -H "authorization: Bearer $ANON" -H 'content-type: application/json' \
      -d "{\"items\":[{\"id\":\"$slug\",\"size\":\"$size\",\"qty\":1}],\"customer\":{\"name\":\"Drill Buyer\",\"phone\":\"0771234567\",\"email\":\"drill-buyer@example.com\",\"address\":\"1 Drill Road\",\"city\":\"Galle\",\"district\":\"Galle\"},\"payment\":\"cod\"}")
  n=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["orderNumber"])' "$r"); ORDERS+=("$n"); echo "order $n placed" | log
done
PHOTO=products/2026/11/$(python3 -c 'import uuid; print(uuid.uuid4())').png
python3 -c 'import zlib,struct,sys
def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
raw=b"".join(b"\x00"+b"\xcc\x33\x33"*64 for _ in range(64))
sys.stdout.buffer.write(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",64,64,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b""))' > "$WORK/photo.png"
curl -fsS -X POST "$API/storage/v1/object/product-images/$PHOTO" -H "apikey: $SERVICE" -H "authorization: Bearer $SERVICE" -H 'content-type: image/png' --data-binary @"$WORK/photo.png" >/dev/null
echo "photo uploaded: $PHOTO ($(stat -c %s "$WORK/photo.png") bytes)" | log
mkdir -p "$WORK/catalog"; echo '{"note":"catalogue snapshot written by the VPS worker"}' > "$WORK/catalog/latest.json"

step "5. database backup (sc-db-backup.sh)"
OUT=$(bash "$B/sc-db-backup.sh" 2>>"$LOG")
echo "local file: $(basename "$OUT") $(stat -c %s "$OUT") bytes" | log
rclone ls r2:sc-backups/db | log
for n in "${ORDERS[@]}" drill-buyer@example.com "1 Drill Road"; do
  if grep -qa "$n" "$OUT"; then echo "PLAINTEXT FOUND in encrypted backup: $n" | log; exit 1; fi
done
echo "encrypted file contains none of the order numbers, the email or the address: ok" | log
echo "manifest counts recorded before the dump; age header: $(head -c 21 "$OUT")" | log

step "6. photo backup (sc-storage-backup.sh)"
bash "$B/sc-storage-backup.sh" 2>&1 | log
echo "objects on R2 under files/ (names are encrypted):" | log
rclone lsf -R r2:sc-backups/files | head -5 | log
if rclone lsf -R r2:sc-backups/files | grep -q "product-images\|\.png"; then echo "PLAIN NAMES FOUND on R2" | log; exit 1; fi
echo "no readable file names on R2: ok" | log

step "7. restore drill from R2 (sc-restore-drill.sh)"
bash "$B/sc-restore-drill.sh" 2>&1 | log
EVIDENCE=$(ls -t "$WORK"/backups/drills/drill-*.json | head -1)
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({k: d[k] for k in ["backup","verify_sql","restore_seconds","total_seconds","restored_counts"]}, indent=1))' "$EVIDENCE" | log

step "8. the orders placed in step 4 are inside the restored backup"
# restore into a second scratch to look inside (the drill script already removed its own container)
age --decrypt -i "$WORK/etc/owner-offline.key" "$OUT" | tar -C "$WORK" -xf - db.pgc manifest.json
echo "the OWNER'S OFFLINE KEY also decrypts the backup: ok" | log
for n in "${ORDERS[@]}"; do
  docker run --rm -i "$IMG" sh -c 'cat > /tmp/d && pg_restore -a -t orders -f - /tmp/d' < "$WORK/db.pgc" | grep -q "$n" && echo "order $n found in backup" | log
done

step "9. photo restore: R2 -> folder, bytes identical to the original"
rclone copy --fast-list "r2crypt:storage/product-images" "$WORK/photo-restore" 2>&1 | log
a=$(sha256sum "$WORK/photo.png" | cut -d' ' -f1); b=$(sha256sum "$WORK/photo-restore/$PHOTO" | cut -d' ' -f1)
[ "$a" = "$b" ] && echo "restored photo sha256 $b matches the original: ok" | log

step "10. safety checks: tampered backup, wrong key, deleted photo"
cp "$OUT" "$WORK/tampered.tar.age"; cp "$OUT.sha256" "$WORK/tampered.tar.age.sha256"
printf 'X' | dd of="$WORK/tampered.tar.age" bs=1 seek=2000 conv=notrunc 2>/dev/null
echo "-- restore of a tampered file (not recorded in the database, so the owner's page stays truthful):" | log
grep -v '^WORKER_DATABASE_URL=' "$WORK/etc/backup.env" > "$WORK/etc/norecord.env"
SC_BACKUP_ENV=$WORK/etc/norecord.env expect_fail bash "$B/sc-restore-drill.sh" "$WORK/tampered.tar.age"
grep -o 'FAILED: checksum mismatch[^"]*' "$LOG" | tail -1 | log
echo "-- decrypt with a key that is not a recipient:" | log
age-keygen -o "$WORK/stranger.key" 2>/dev/null
expect_fail age --decrypt -i "$WORK/stranger.key" -o /dev/null "$OUT"
echo "-- photo deleted on the website is still in the backups:" | log
curl -fsS -X DELETE "$API/storage/v1/object/product-images/$PHOTO" -H "apikey: $SERVICE" -H "authorization: Bearer $SERVICE" >/dev/null
bash "$B/sc-storage-backup.sh" 2>>"$LOG"
rclone lsf "r2crypt:storage/product-images/$(dirname "$PHOTO")" | grep -q "$(basename "$PHOTO")" && echo "deleted photo still on R2: ok" | log

step "11. what the owner sees on the admin Backups page"
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -XAtc "SELECT jsonb_pretty(app.backup_health() - 'latest')" | log
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -XAtc "SELECT kind || ' ' || status || ' ' || to_char(finished_at, 'HH24:MI:SS') FROM app.backup_job_status WHERE started_at > now() - interval '1 hour' AND status <> 'running' ORDER BY id" | log

step "DRILL COMPLETE — all steps passed"
