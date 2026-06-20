#!/usr/bin/env bash
# changesets/action runs the `version:` input as a split argv (no shell), so
# `changeset version && bun install` passed `&& bun install` as extra args to
# changeset ("Too many arguments"). Wrap the two steps in a real shell here.
# bun install after the bump refreshes bun.lock so the published tarballs pin
# the freshly bumped internal @cosmicdrift/* versions (see #520), not stale ones.
set -euo pipefail

bunx changeset version
bun install
