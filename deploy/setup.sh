#!/usr/bin/env bash
#
# Einmaliges Server-Setup für Burgspiel auf einem frischen Debian/Ubuntu-VPS.
# Installiert Node 20, nginx und certbot, richtet den systemd-Service und die
# nginx-Site mit HTTPS (Let's Encrypt) ein.
#
# Aufruf als root (oder via sudo):
#   DOMAIN=spiel.example.com EMAIL=du@example.com bash deploy/setup.sh
#
# Voraussetzung: Das Repo liegt bereits unter /opt/burgspiel und die DNS
# A/AAAA-Records der Domain zeigen auf diesen Server.

set -euo pipefail

DOMAIN="${DOMAIN:?Bitte DOMAIN=... setzen}"
EMAIL="${EMAIL:?Bitte EMAIL=... (fuer Let's Encrypt) setzen}"
APP_DIR="${APP_DIR:-/opt/burgspiel}"

echo ">> Pakete installieren (Node 20, nginx, certbot)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y certbot python3-certbot-nginx

echo ">> App bauen…"
bash "$APP_DIR/deploy/build.sh"

echo ">> systemd-Service einrichten…"
install -m 644 "$APP_DIR/deploy/burgspiel.service" /etc/systemd/system/burgspiel.service
mkdir -p "$APP_DIR/server-data"
systemctl daemon-reload
systemctl enable --now burgspiel

echo ">> nginx-Site einrichten…"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/burgspiel
ln -sf /etc/nginx/sites-available/burgspiel /etc/nginx/sites-enabled/burgspiel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ">> HTTPS via Let's Encrypt…"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo ""
echo "Fertig. Spiel:           https://$DOMAIN"
echo "Admin-Dashboard:         https://$DOMAIN/admin"
echo "Backend-Status:          systemctl status burgspiel"
