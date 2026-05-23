#!/bin/sh
# C1 M3 — postgres-smoke. Erwartet DATABASE_URL + REDIS_URL gegen
# laufende Services. Spawnt `bun bin/main.ts` im Hintergrund, ruft
# /health, killed den Server, exit 0 wenn 200 zurückkam.
#
# Lokal: postgres + redis via `docker run` oder eigener stack. CI:
# service-containers in ci.yml (use-all-bundled-postgres-smoke job).
#
# Usage:
#   DATABASE_URL=postgres://... REDIS_URL=redis://... \
#   JWT_SECRET=... KUMIKO_SECRETS_MASTER_KEY_V1=... \
#   bash samples/apps/use-all-bundled/scripts/smoke-postgres.sh

set -eu

: "${DATABASE_URL:?required}"
: "${REDIS_URL:?required}"
: "${JWT_SECRET:?required}"
: "${KUMIKO_SECRETS_MASTER_KEY_V1:?required}"

PORT="${PORT:-3000}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[smoke] applying drizzle migrations…"
(cd "$APP_DIR" && bunx drizzle-kit migrate)

echo "[smoke] spawning bun bin/main.ts on :${PORT}…"
(cd "$APP_DIR" && PORT="$PORT" bun bin/main.ts) &
BUN_PID=$!
# shellcheck disable=SC2064
trap "kill ${BUN_PID} 2>/dev/null || true; wait ${BUN_PID} 2>/dev/null || true" EXIT INT TERM

# Wait for /health up to ~30s (3s × 10).
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "[smoke] /health 200 — OK"
    exit 0
  fi
  sleep 3
done

echo "[smoke] /health never returned 200 within 30s" >&2
exit 1
