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

echo "[bundle-smoke] building via kumiko-build…"
(cd "$APP_DIR" && bun ../../../packages/dev-server/bin/kumiko-build.ts)

echo "[bundle-smoke] booting dist-server/server.js…"
KUMIKO_DRY_RUN_ENV=boot bun "$APP_DIR/dist-server/server.js"

echo "[bundle-smoke] OK"
