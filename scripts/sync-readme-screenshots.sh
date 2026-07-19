#!/usr/bin/env bash
# Copy Show Pony README preview PNGs from the docs screenshot tree.
#
# Upstream pipeline (docs.kumiko.rocks):
#   1. cd show-pony && bun run screenshots
#      → show-pony/docs/screenshots/<scenario>/en/default-light/desktop.png
#   2. rsync that tree into kumiko-platform:
#        rsync -a show-pony/docs/screenshots/ \\
#          kumiko-platform/apps/docs/public/screenshots/show-pony/
#   3. Run this script (or package.json shortcut) to refresh the GitHub README assets.
#
# Override source root: DOCS_SCREENSHOTS=/path/to/show-pony/docs/screenshots

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${DOCS_SCREENSHOTS:-$ROOT/../kumiko-platform/apps/docs/public/screenshots/show-pony}"
DEST="$ROOT/docs/readme"

if [ ! -d "$SRC" ]; then
  echo "Missing screenshot source: $SRC" >&2
  echo "Regenerate in show-pony (bun run screenshots) and sync to kumiko-platform first." >&2
  exit 1
fi

mkdir -p "$DEST"

copy() {
  local scenario="$1"
  local dest_name="$2"
  local from="$SRC/$scenario/en/default-light/desktop.png"
  if [ ! -f "$from" ]; then
    echo "Missing $from" >&2
    exit 1
  fi
  cp "$from" "$DEST/$dest_name"
  echo "$dest_name ← $scenario/en/default-light/desktop.png"
}

copy public-event show-pony-public-rsvp.png
copy host-events show-pony-host-events.png
copy platform-overview show-pony-platform.png
