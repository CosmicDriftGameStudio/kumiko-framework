#!/usr/bin/env bash
# Usage: pack-with-publish-config.sh <pkg_dir>
# Prints the tarball basename (created in <pkg_dir>) on stdout, everything else
# goes to stderr.
#
# `bun pm pack` ignores publishConfig.exports, so a package that ships compiled
# dist under publishConfig.exports (workspace exports stay on src) would
# publish its TS source. For such packages the tarball is unpacked, dist is
# rebuilt from tsconfig.build.json, checked under Node, and `exports` is
# swapped for publishConfig.exports before repacking. Packages without
# publishConfig.exports keep the untouched bun tarball.
set -euo pipefail

pkg_dir="$(cd "${1:?usage: pack-with-publish-config.sh <pkg_dir>}" && pwd)"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

# --quiet emits the tarball basename on stdout but with a leading blank line
# (bun 1.3.14) → filter the .tgz line.
tarball="$(cd "$pkg_dir" && bun pm pack --quiet | grep -E '\.tgz$' | tail -n1)"
[ -n "$tarball" ] || { echo "pack produced no tarball for $pkg_dir" >&2; exit 1; }

if [ "$(jq -r '.publishConfig.exports // empty | type' "$pkg_dir/package.json")" = "object" ]; then
  work="$(mktemp -d)"
  # A failed build must not leave the unpatched src tarball behind in pkg_dir.
  trap 'rc=$?; rm -rf "$work"; if [ "$rc" -ne 0 ]; then rm -f "$pkg_dir/$tarball"; fi' EXIT
  [ -f "$pkg_dir/tsconfig.build.json" ] || {
    echo "$pkg_dir has publishConfig.exports but no tsconfig.build.json" >&2
    exit 1
  }

  tar -xzf "$pkg_dir/$tarball" -C "$work"
  rm -rf "$work/package/dist"
  "$repo_root/node_modules/.bin/tsc" -p "$pkg_dir/tsconfig.build.json" --outDir "$work/package/dist" >&2
  node "$repo_root/scripts/check-dist-node-esm.mjs" "$work/package/dist" >&2

  jq --slurpfile source "$pkg_dir/package.json" '.exports = $source[0].publishConfig.exports' \
    "$work/package/package.json" >"$work/package.json.patched"
  mv "$work/package.json.patched" "$work/package/package.json"

  COPYFILE_DISABLE=1 tar -czf "$pkg_dir/$tarball" -C "$work" package
fi

echo "$tarball"
