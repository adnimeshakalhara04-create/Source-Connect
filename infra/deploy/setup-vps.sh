#!/usr/bin/env bash
# One-time hardening + install for a fresh Ubuntu 24.04 VPS (2 vCPU / 4 GB). Run as root:
#   ADMIN_USER=sc ADMIN_SSH_KEY="ssh-ed25519 AAAA..." API_DOMAIN=api.example.lk ACME_EMAIL=you@example.lk bash setup-vps.sh
# Safe to re-run. It does NOT open the database to the internet, and it will refuse to lock SSH
# before a working key is installed for the admin user.
set -euo pipefail
: "${ADMIN_USER:?}" "${ADMIN_SSH_KEY:?}" "${API_DOMAIN:?}" "${ACME_EMAIL:?}"
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get install -yq ufw fail2ban unattended-upgrades curl ca-certificates gnupg postgresql-16 pgbackrest rclone \
  debian-keyring debian-archive-keyring apt-transport-https jq
# Docker Engine (official repo) and Caddy (official repo)
install -m 0755 -d /etc/apt/keyrings
[ -f /etc/apt/keyrings/docker.gpg ] || curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release; echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
[ -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ] || curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q && apt-get install -yq docker-ce docker-ce-cli containerd.io docker-compose-plugin caddy

echo "== admin user with SSH key"
id "$ADMIN_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$ADMIN_USER"
usermod -aG sudo,docker "$ADMIN_USER"
install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
grep -qxF "$ADMIN_SSH_KEY" "/home/$ADMIN_USER/.ssh/authorized_keys" 2>/dev/null || echo "$ADMIN_SSH_KEY" >> "/home/$ADMIN_USER/.ssh/authorized_keys"
chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"; chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"

echo "== SSH: keys only, no root login"
cat > /etc/ssh/sshd_config.d/10-source-connect.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
AllowUsers $ADMIN_USER
CONF
sshd -t && systemctl reload ssh

echo "== firewall: only SSH, HTTP, HTTPS"
ufw default deny incoming; ufw default allow outgoing
ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp
ufw --force enable
cat > /etc/fail2ban/jail.d/sshd.local <<CONF
[sshd]
enabled = true
maxretry = 5
bantime = 1h
CONF
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== swap (2 GB) so a memory spike does not kill PostgreSQL"
if ! swapon --show | grep -q /swapfile; then fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/90-swappiness.conf

echo "== PostgreSQL 16: localhost only, sized for 4 GB shared with the API"
cat > /etc/postgresql/16/main/conf.d/source-connect.conf <<CONF
listen_addresses = 'localhost'
max_connections = 60
shared_buffers = 768MB
effective_cache_size = 2GB
work_mem = 8MB
maintenance_work_mem = 128MB
wal_compression = on
max_wal_size = 2GB
checkpoint_completion_target = 0.9
random_page_cost = 1.1
log_min_duration_statement = 500
log_lock_waits = on
idle_in_transaction_session_timeout = 60s
CONF
systemctl restart postgresql
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='sc_app'" | grep -q 1; then
  DBPW=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)
  sudo -u postgres psql -qc "CREATE ROLE sc_app LOGIN PASSWORD '$DBPW'"
  sudo -u postgres psql -qc "CREATE DATABASE source_connect OWNER sc_app"
  install -d -m 750 /etc/source-connect
  echo "DATABASE_URL=postgres://sc_app:$DBPW@127.0.0.1:5432/source_connect" > /etc/source-connect/db.env; chmod 600 /etc/source-connect/db.env
  echo "Database password saved in /etc/source-connect/db.env (copy it into your password manager)."
fi

echo "== folders"
install -d -m 755 /srv/source-connect/uploads /opt/source-connect /var/log/pgbackrest /var/spool/pgbackrest
chown 999:999 /srv/source-connect/uploads      # the API container user
chown postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest

echo "== Caddy (HTTPS for $API_DOMAIN)"
install -d /var/log/caddy && chown caddy:caddy /var/log/caddy
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=API_DOMAIN=%s\nEnvironment=ACME_EMAIL=%s\n' "$API_DOMAIN" "$ACME_EMAIL" > /etc/systemd/system/caddy.service.d/env.conf
cp "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload && systemctl restart caddy

echo "== log rotation"
cat > /etc/logrotate.d/pgbackrest <<CONF
/var/log/pgbackrest/*.log { weekly rotate 8 compress missingok notifempty copytruncate }
CONF
mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/size.conf && systemctl restart systemd-journald

echo
echo "Done. Next: copy the repo to /opt/source-connect, create /etc/source-connect/api.env from server/.env.example"
echo "(DATABASE_URL from /etc/source-connect/db.env), then run infra/deploy/deploy.sh. Backups: docs/backup-restore-runbook.md §2."
echo "Before logging out, open a SECOND terminal and check you can still SSH in as $ADMIN_USER with your key."
