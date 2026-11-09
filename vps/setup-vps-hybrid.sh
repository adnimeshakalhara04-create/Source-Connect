#!/usr/bin/env bash
# One-time setup of the VPS for the Supabase hybrid design (Ubuntu 24.04). Run as root:
#   ADMIN_USER=sc ADMIN_SSH_KEY="ssh-ed25519 AAAA..." bash vps/setup-vps-hybrid.sh
# The VPS serves NO website traffic in this design: only SSH is open. It runs the worker and the backups.
# Safe to re-run. It creates NO secrets you must type into chat; it prints what the owner fills in afterwards.
set -euo pipefail
: "${ADMIN_USER:?set ADMIN_USER}" "${ADMIN_SSH_KEY:?set ADMIN_SSH_KEY (your public key)}"
REPO=$(cd "$(dirname "$0")/.." && pwd)
export DEBIAN_FRONTEND=noninteractive
. /etc/os-release

echo "== packages (PostgreSQL 17 client from the official PGDG repo, Node 22, Docker for restore drills)"
apt-get update -q
apt-get install -yq ufw fail2ban unattended-upgrades curl ca-certificates gnupg age rclone jq python3
install -m 0755 -d /etc/apt/keyrings
[ -f /etc/apt/keyrings/pgdg.asc ] || curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /etc/apt/keyrings/pgdg.asc
echo "deb [signed-by=/etc/apt/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" > /etc/apt/sources.list.d/pgdg.list
[ -f /etc/apt/keyrings/docker.gpg ] || curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
[ -f /etc/apt/keyrings/nodesource.gpg ] || curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update -q
apt-get install -yq postgresql-client-17 nodejs docker-ce docker-ce-cli containerd.io

echo "== admin user with SSH key; SSH keys only, no root login"
id "$ADMIN_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$ADMIN_USER"
usermod -aG sudo "$ADMIN_USER"
install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
grep -qxF "$ADMIN_SSH_KEY" "/home/$ADMIN_USER/.ssh/authorized_keys" 2>/dev/null || echo "$ADMIN_SSH_KEY" >> "/home/$ADMIN_USER/.ssh/authorized_keys"
chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"; chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
cat > /etc/ssh/sshd_config.d/10-source-connect.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
AllowUsers $ADMIN_USER
CONF
sshd -t && systemctl reload ssh

echo "== firewall: SSH only (nothing on this server is reachable from the internet)"
ufw default deny incoming; ufw default allow outgoing; ufw allow OpenSSH; ufw --force enable
printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.d/sshd.local
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
if ! swapon --show | grep -q /swapfile; then fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/size.conf && systemctl restart systemd-journald

echo "== code, users, folders"
id sc-worker >/dev/null 2>&1 || useradd --system --home /var/lib/source-connect --shell /usr/sbin/nologin sc-worker
install -d -m 755 /opt/source-connect
if [ "$REPO" != /opt/source-connect ]; then cp -a "$REPO/." /opt/source-connect/; fi
(cd /opt/source-connect/vps/worker && npm ci --omit=dev)
install -d -m 750 -o sc-worker -g sc-worker /var/lib/source-connect /var/lib/source-connect/catalog /var/lib/source-connect/outbox
install -d -m 700 /var/backups/source-connect /etc/source-connect
chmod 755 /etc/source-connect      # the folder can be listed; every file in it is 0600/0640
chmod +x /opt/source-connect/vps/backup/*.sh /opt/source-connect/infra/backup/alert.sh

echo "== encryption keys for backups (the drill key is made here; the owner's offline key is made on the owner's own computer)"
if [ ! -f /etc/source-connect/drill-age.key ]; then
  age-keygen -o /etc/source-connect/drill-age.key 2>/dev/null; chmod 600 /etc/source-connect/drill-age.key
  age-keygen -y /etc/source-connect/drill-age.key > /etc/source-connect/backup-recipients.txt; chmod 644 /etc/source-connect/backup-recipients.txt
fi
docker pull -q "$(grep -oP '^SCRATCH_IMAGE=\K.*' /opt/source-connect/vps/backup/backup.env.example)" >/dev/null

echo "== systemd units (installed, NOT started until the settings files exist)"
cp /opt/source-connect/vps/systemd/*.service /opt/source-connect/vps/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload

cat <<NEXT

Done. The owner fills these in ON THE SERVER (never in chat):
  1. /etc/source-connect/worker.env   from vps/worker/worker.env.example   (chown root:sc-worker, chmod 640)
  2. /etc/source-connect/backup.env   from vps/backup/backup.env.example   (chmod 600)
  3. /etc/source-connect/rclone.conf  with remotes r2, r2crypt, supabase  (chmod 600; see docs/hybrid/vps-runbook.md)
  4. Add the OWNER'S OFFLINE public key as a 2nd line in /etc/source-connect/backup-recipients.txt
  5. Test, then switch on:
       sudo /opt/source-connect/vps/backup/sc-db-backup.sh && sudo /opt/source-connect/vps/backup/sc-restore-drill.sh
       sudo systemctl enable --now sc-worker sc-db-backup.timer sc-storage-backup.timer sc-restore-drill.timer
NEXT
