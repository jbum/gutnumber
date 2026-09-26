#!/usr/bin/env bash
# Build locally, ship dist/ to the server, install runtime deps, restart both services.
# Usage: deploy/deploy.sh <ssh-host>        (first-time setup: see DEPLOY.md)
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh <ssh-host>}"
cd "$(dirname "$0")/.."

echo "== typecheck + tests"
npm run typecheck
npm test --silent

echo "== build"
npm run build

echo "== ship"
rsync -az --delete --exclude '*.map' dist/ "$HOST:gutnumber/dist/"
rsync -az package.json package-lock.json "$HOST:gutnumber/"

echo "== install runtime deps + restart"
ssh "$HOST" 'set -e; cd ~/gutnumber
  PUPPETEER_CACHE_DIR=$HOME/gutnumber-data/chromium npm ci --omit=dev --no-audit --no-fund --loglevel=error
  sudo systemctl restart gutnumber-web gutnumber-daemon
  sleep 3
  systemctl --no-pager --lines=0 status gutnumber-web gutnumber-daemon | grep -E "Active:|●"
  curl -fsS http://127.0.0.1:${PORT:-3100}/api/v1/health; echo'
