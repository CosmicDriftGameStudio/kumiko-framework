#!/usr/bin/env bash
# Verifies every package that publishes compiled dist (publishConfig.exports):
# packs all of them through the same script the release uses, inspects each
# tarball, installs all tarballs into ONE scratch consumer outside the repo
# (internal @cosmicdrift deps forced onto the local tarballs), then imports
# every subpath under Node and Bun. Subpaths listed in `kumiko.bunOnlyExports`
# are the only ones allowed to fail under Node.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fail() { echo "x $*" >&2; exit 1; }

has_publish_exports() {
  [ "$(jq -r '.private // false' "$1")" != "true" ] &&
    [ "$(jq -r '.publishConfig.exports // empty | type' "$1")" = "object" ]
}

names=()
dirs=()
tarballs=()
for pkg_json in packages/*/package.json; do
  has_publish_exports "$pkg_json" || continue
  pkg_dir="$(cd "$(dirname "$pkg_json")" && pwd)"
  name="$(jq -r .name "$pkg_json")"
  echo "== pack $name" >&2

  tarball="$(bash scripts/pack-with-publish-config.sh "$pkg_dir")"
  tarball_path="$scratch/$tarball"
  mv "$pkg_dir/$tarball" "$tarball_path"

  listing="$(tar -tzf "$tarball_path")"
  if grep -q '__tests__' <<<"$listing"; then fail "$name: tarball contains __tests__"; fi

  # A `files` entry under src/ (exact file or directory prefix) is intentionally shipped as source.
  allowed_src="$(jq -r '.files[] | select(startswith("src/"))' "$pkg_json")"
  stray_src=""
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    allowed=0
    while IFS= read -r prefix; do
      [ -n "$prefix" ] || continue
      if [ "$entry" = "package/$prefix" ] || [[ "$entry" == "package/${prefix%/}/"* ]]; then allowed=1; break; fi
    done <<<"$allowed_src"
    [ "$allowed" -eq 1 ] || stray_src+="$entry"$'\n'
  done < <(grep -E '^package/src/.*[^/]$' <<<"$listing" | grep -vxF 'package/src/changes.json' || true)
  [ -z "$stray_src" ] || fail "$name: tarball contains source files: $(head -n3 <<<"$stray_src" | tr '\n' ' ')"

  packed_json="$(tar -xzOf "$tarball_path" package/package.json)"
  jq -e --slurpfile source "$pkg_json" '.exports == $source[0].publishConfig.exports' <<<"$packed_json" >/dev/null \
    || fail "$name: tarball exports differ from publishConfig.exports"

  while IFS= read -r target; do
    grep -qxF "package/${target#./}" <<<"$listing" || fail "$name: export target $target missing in tarball"
  done < <(jq -r '.exports | .. | strings' <<<"$packed_json" | sort -u)

  names+=("$name")
  dirs+=("$pkg_dir")
  tarballs+=("$tarball_path")
done

[ "${#names[@]}" -gt 0 ] || fail "no package with publishConfig.exports found"

consumer="$scratch/consumer"
mkdir -p "$consumer"
deps='{}'
for i in "${!names[@]}"; do
  deps="$(jq --arg n "${names[$i]}" --arg t "file:${tarballs[$i]}" '.[$n] = $t' <<<"$deps")"
done
jq -n --argjson deps "$deps" '{type: "module", private: true, dependencies: $deps, overrides: $deps}' >"$consumer/package.json"
(cd "$consumer" && bun install --omit peer >&2)

for i in "${!names[@]}"; do
  name="${names[$i]}"
  installed="$consumer/node_modules/$name"
  { [ -d "$installed" ] && [ ! -L "$installed" ]; } || fail "$name: installed package is not a real directory"
done

# A registry copy nested under another package means the tarball override did not win.
nested="$(find "$consumer/node_modules/@cosmicdrift" -mindepth 3 -maxdepth 3 -path '*/node_modules/@cosmicdrift' 2>/dev/null || true)"
[ -z "$nested" ] || fail "nested @cosmicdrift copies inside installed packages: $nested"

# Every installed @cosmicdrift package that publishes dist locally must have its dist exports installed.
for installed in "$consumer"/node_modules/@cosmicdrift/*; do
  installed_name="$(jq -r .name "$installed/package.json")"
  for local_json in packages/*/package.json; do
    [ "$(jq -r .name "$local_json")" = "$installed_name" ] || continue
    has_publish_exports "$local_json" || continue
    jq -e --slurpfile source "$local_json" '.exports == $source[0].publishConfig.exports' "$installed/package.json" >/dev/null \
      || fail "$installed_name: installed exports differ from publishConfig.exports"
  done
done

# Lives inside the scratch consumer so resolution goes through node_modules,
# never through the workspace symlink (which Node would resolve to TS source).
cat >"$consumer/import-all.mjs" <<'JS'
import { readFileSync } from "node:fs";
const [name] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(`./node_modules/${name}/package.json`, "utf8"));
const bunOnly = new Set(manifest.kumiko?.bunOnlyExports ?? []);
const isBun = typeof Bun !== "undefined";
const isJsTarget = (target) => typeof target === "object" && String(target.default).endsWith(".js");
const keys = Object.keys(manifest.exports).filter((key) => isJsTarget(manifest.exports[key]));
const failed = [];
let loaded = 0;
let bunOnlyFailedAsExpected = 0;
for (const key of keys) {
  const specifier = key === "." ? name : `${name}/${key.slice(2)}`;
  try {
    await import(specifier);
    loaded++;
    if (!isBun && bunOnly.has(key)) failed.push(`${key}: listed in bunOnlyExports but loads under Node`);
  } catch (error) {
    if (!isBun && bunOnly.has(key)) bunOnlyFailedAsExpected++;
    else failed.push(`${key}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
}
console.log(JSON.stringify({ total: keys.length, loaded, bunOnly: bunOnlyFailedAsExpected, failed }));
JS

report() {
  local runtime="$1" name="$2" result
  result="$(cd "$consumer" && "$runtime" import-all.mjs "$name")"
  failed_count="$(jq '.failed | length' <<<"$result")"
  if [ "$failed_count" -gt 0 ]; then
    jq -r '.failed[]' <<<"$result" >&2
    fail "$name: subpath imports failed under $runtime"
  fi
  echo "$result"
}

for name in "${names[@]}"; do
  node_result="$(report node "$name")"
  bun_result="$(report bun "$name")"
  echo "OK $name: node $(jq -r '"\(.loaded)/\(.total)"' <<<"$node_result") (bun-only $(jq -r .bunOnly <<<"$node_result")), bun $(jq -r '"\(.loaded)/\(.total)"' <<<"$bun_result")" >&2
done

echo "OK ${#names[@]} package(s) verified" >&2
