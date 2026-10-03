#!/usr/bin/env bash
# Packs @cosmicdrift/kumiko-samples through the release pack script, checks the
# tarball for files that must never ship, and verifies that the few-shot corpus
# built from the unpacked package equals the repo corpus.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
pkg_dir="$repo_root/packages/samples"

scratch="$(mktemp -d)"
cleanup() {
  rm -rf "${scratch:?}"
  rm -rf "${pkg_dir:?}/samples" "${pkg_dir:?}/packages"
  rm -f "${pkg_dir:?}"/*.tgz
}
trap cleanup EXIT

tarball="$(bash scripts/pack-with-publish-config.sh packages/samples)"
mv "$pkg_dir/$tarball" "$scratch/samples.tgz"
tar -xzf "$scratch/samples.tgz" -C "$scratch"

listing="$scratch/listing.txt"
tar -tzf "$scratch/samples.tgz" >"$listing"

fail=0
if bad="$(grep -E '(^|/)(node_modules|__tests__|test-results|coverage)(/|$)|/\.|\.test\.ts' "$listing")"; then
  echo "samples tarball contains forbidden paths:" >&2
  echo "$bad" | head -20 >&2
  fail=1
fi
grep -Eq '^package/samples/recipes/[^/]+/package\.json$' "$listing" || { echo "no samples/recipes/*/package.json in tarball" >&2; fail=1; }
grep -Eq '^package/samples/apps/[^/]+/' "$listing" || { echo "no samples/apps/* in tarball" >&2; fail=1; }
grep -Eq '^package/packages/bundled-features/src/[^/]+/feature\.ts$' "$listing" || { echo "no bundled-features/src/*/feature.ts in tarball" >&2; fail=1; }
[ "$fail" -eq 0 ] || exit 1

bun scripts/verify-samples-package-corpus.ts "$scratch/package"

if [ -e "$pkg_dir/samples" ] || [ -e "$pkg_dir/packages" ] || ls "$pkg_dir"/*.tgz >/dev/null 2>&1; then
  echo "staging leftovers in packages/samples" >&2
  exit 1
fi
echo "samples package OK"
