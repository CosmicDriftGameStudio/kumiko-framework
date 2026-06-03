#!/bin/sh
# Empfehlung 4 (bundle-smoke). Bundles use-all-bundled via kumiko-build
# und bootet das dist-server-Output mit KUMIKO_DRY_RUN_ENV=boot. Catches
# bundling-only-bugs (Object.entries(undefined) in minified, dynamic-
# require-resolution, tree-shake-quirks) die der direct-source boot
# nicht sieht.
#
# Erwartet (set in CI env): DATABASE_URL, REDIS_URL, JWT_SECRET,
# KUMIKO_SECRETS_MASTER_KEY_V1, STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET,
# MOLLIE_API_KEY.
#
# Usage:
#   bash samples/apps/use-all-bundled/scripts/bundle-smoke.sh

set -eu

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[bundle-smoke] building via package.json build-script…"
(cd "$APP_DIR" && bun run build)

# Boot from the ISOLATED dist-server/ folder with its own `bun install
# --production`. Booting via `bun run boot:bundled` (cwd = APP_DIR) resolves
# imports from the monorepo node_modules, where the externalized drivers
# (@libsql/client, mysql2, @neondatabase/serverless, …) + drizzle-kit are
# installed — so a stray runtime `import "@libsql/client"` would stay green
# here while crashing the real Alpine container (only the pinned
# dist-server/package.json#dependencies present). Installing + booting inside
# dist-server/ validates the self-sufficiency of that pinned dependency set.
echo "[bundle-smoke] installing pinned dist-server deps (isolated)…"
(cd "$APP_DIR/dist-server" && bun install --production)

echo "[bundle-smoke] booting dist-server/server.js from isolated dist-server/…"
(cd "$APP_DIR/dist-server" && KUMIKO_DRY_RUN_ENV=boot bun server.js)

echo "[bundle-smoke] OK"
