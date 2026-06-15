#!/usr/bin/env bash
#
# Update-Deploy: neuen Stand ziehen, neu bauen, Dienste neu laden.
# Für Updates NACH dem einmaligen setup.sh.
#
#   bash deploy/deploy.sh            # nutzt aktuellen Branch
#   BRANCH=main bash deploy/deploy.sh

set -euo pipefail
APP_DIR="${APP_DIR:-/opt/burgspiel}"
BRANCH="${BRANCH:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"
cd "$APP_DIR"

echo ">> Code aktualisieren ($BRANCH)…"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

bash "$APP_DIR/deploy/build.sh"

echo ">> Dienste neu laden…"
systemctl restart burgspiel
systemctl reload nginx

echo ">> Deploy fertig."
