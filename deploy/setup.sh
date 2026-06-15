#!/usr/bin/env bash
#
# Einmaliges Server-Setup für Burgspiel auf einem frischen Debian/Ubuntu-VPS,
# betrieben hinter Cloudflare (Proxy / "orange Wolke").
#
# Installiert Node 20 + nginx, baut Frontend + Backend, richtet den
# systemd-Service und die nginx-Site mit einem selbstsignierten Origin-Cert
# ein. Danach in Cloudflare den SSL/TLS-Modus auf "Full" stellen.
#
# Aufruf als root (oder via sudo), aus dem Repo-Verzeichnis:
#   sudo bash deploy/setup.sh
#
# Domain ist fest auf burg.paulbartsch.de eingestellt (Override: DOMAIN=...).
# DNS-A-Record der Domain muss auf diesen Server zeigen (Proxy darf an sein).

set -euo pipefail

DOMAIN="${DOMAIN:-burg.paulbartsch.de}"
APP_DIR="${APP_DIR:-/opt/burgspiel}"
CERT_DIR="/etc/ssl/burgspiel"

echo ">> Pakete installieren (Node 20, nginx, openssl)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx openssl
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo ">> App bauen…"
bash "$APP_DIR/deploy/build.sh"

echo ">> Origin-Cert erzeugen (selbstsigniert, für Cloudflare-Modus 'Full')…"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/origin.crt" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$CERT_DIR/origin.key" -out "$CERT_DIR/origin.crt" \
    -subj "/CN=$DOMAIN"
  chmod 600 "$CERT_DIR/origin.key"
fi

echo ">> systemd-Service einrichten…"
install -m 644 "$APP_DIR/deploy/burgspiel.service" /etc/systemd/system/burgspiel.service
mkdir -p "$APP_DIR/server-data"
systemctl daemon-reload
systemctl enable --now burgspiel

echo ">> nginx-Site einrichten…"
sed "s/burg\.paulbartsch\.de/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" \
  > /etc/nginx/sites-available/burgspiel
ln -sf /etc/nginx/sites-available/burgspiel /etc/nginx/sites-enabled/burgspiel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "Origin steht. Jetzt in Cloudflare:"
echo "  - SSL/TLS  ->  Overview  ->  Modus 'Full' wählen"
echo "  - (DNS-Record $DOMAIN bleibt 'Proxied' / orange)"
echo ""
echo "Danach:"
echo "  Spiel:            https://$DOMAIN"
echo "  Admin-Dashboard:  https://$DOMAIN/admin"
echo "  Backend-Status:   systemctl status burgspiel"
