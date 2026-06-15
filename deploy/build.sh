#!/usr/bin/env bash
#
# Baut Frontend (dist/) und Backend (server/dist/). Wird von setup.sh und
# deploy.sh aufgerufen, kann aber auch direkt laufen.

set -euo pipefail
APP_DIR="${APP_DIR:-/opt/burgspiel}"
cd "$APP_DIR"

echo ">> npm install…"
npm ci || npm install

echo ">> Frontend bauen (dist/)…"
npm run build

echo ">> Backend bauen (server/dist/)…"
npm run server:build

echo ">> Build fertig."
