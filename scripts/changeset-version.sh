#!/usr/bin/env bash
# changesets/action runs the `version:` input as a split argv (no shell), so
# `changeset version && bun install` passed `&& bun install` as extra args to
# changeset ("Too many arguments"). Wrap the steps in a real shell here.
set -euo pipefail

bump_status=.changeset-status.json
trap 'rm -f "$bump_status"' EXIT

bunx changeset status --output="$bump_status"
bun bin/kumiko.ts changes fold --status "$bump_status"
# The canary passes `--snapshot next`; the fold still labels entries with the
# release version (0.425.0), so a canary ships the notes of the release it previews.
bunx changeset version "$@"
# Block accidental major≥1 bumps (stay on 0.x until explicitly approved).
bun scripts/guard-no-major-gt-zero.ts
# CI verifies this file is generated, so the bump must regenerate it here.
bun scripts/gen-migration-guide.ts
bun install --ignore-scripts
# bun install does NOT refresh the workspace "version" fields in bun.lock after
# the bump (only `rm bun.lock && bun install` does, which drifts every floating
# dep). bun pm pack reads those fields to substitute workspace:* at publish, so
# stale fields = stale internal @cosmicdrift/* pins = the publish pin-drift guard
# fails (this broke the 0.67.0 release). Sync them surgically.
bun scripts/sync-lock-workspace-versions.ts
