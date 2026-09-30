#!/usr/bin/env bash
# Verifies every package that publishes compiled dist (publishConfig.exports):
# packs it through the same script the release uses, inspects the tarball and
# installs it into a scratch consumer outside the repo, then imports every
# subpath under Node and Bun.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

scratch="$(mktemp -d)"
tarball_path=""
cleanup() {
  rm -rf "$scratch"
  if [ -n "$tarball_path" ]; then rm -f "$tarball_path"; fi
}
trap cleanup EXIT

fail() { echo "x $*" >&2; exit 1; }

checked=0
for pkg_json in packages/*/package.json; do
  [ "$(jq -r '.private // false' "$pkg_json")" = "true" ] && continue
  [ "$(jq -r '.publishConfig.exports // empty | type' "$pkg_json")" = "object" ] || continue

  pkg_dir="$(cd "$(dirname "$pkg_json")" && pwd)"
  name="$(jq -r .name "$pkg_json")"
  echo "== $name" >&2

  tarball="$(bash scripts/pack-with-publish-config.sh "$pkg_dir")"
  tarball_path="$pkg_dir/$tarball"

  listing="$(tar -tzf "$tarball_path")"
  if grep -q '__tests__' <<<"$listing"; then fail "$name: tarball contains __tests__"; fi
  stray_src="$(grep -E '^package/src/.' <<<"$listing" | grep -vxF 'package/src/changes.json' || true)"
  [ -z "$stray_src" ] || fail "$name: tarball contains source files: $(head -n3 <<<"$stray_src" | tr '\n' ' ')"

  packed_json="$(tar -xzOf "$tarball_path" package/package.json)"
  jq -e --slurpfile source "$pkg_json" '.exports == $source[0].publishConfig.exports' <<<"$packed_json" >/dev/null \
    || fail "$name: tarball exports differ from publishConfig.exports"

  while IFS= read -r target; do
    grep -qxF "package/${target#./}" <<<"$listing" || fail "$name: export target $target missing in tarball"
  done < <(jq -r '.exports | .. | strings' <<<"$packed_json" | sort -u)

  consumer="$scratch/consumer"
  rm -rf "$consumer"
  mkdir -p "$consumer"
  echo '{"type":"module","private":true}' >"$consumer/package.json"
  (cd "$consumer" && bun add --omit peer "$tarball_path" >&2)

  installed="$consumer/node_modules/$name"
  { [ -d "$installed" ] && [ ! -L "$installed" ]; } || fail "$name: installed package is not a real directory"
  jq -e --slurpfile source "$pkg_json" '.exports == $source[0].publishConfig.exports' "$installed/package.json" >/dev/null \
    || fail "$name: installed exports do not point at dist"

  # Lives inside the scratch consumer so resolution goes through node_modules,
  # never through the workspace symlink (which Node would resolve to TS source).
  cat >"$consumer/import-all.mjs" <<'EOF'
import { readFileSync } from "node:fs";
const [name] = process.argv.slice(2);
const { exports: exportMap } = JSON.parse(readFileSync(`./node_modules/${name}/package.json`, "utf8"));
let loaded = 0;
for (const key of Object.keys(exportMap)) {
  await import(key === "." ? name : `${name}/${key.slice(2)}`);
  loaded++;
}
console.log(`${loaded}/${Object.keys(exportMap).length}`);
EOF
  node_count="$(cd "$consumer" && node import-all.mjs "$name")"
  bun_count="$(cd "$consumer" && bun import-all.mjs "$name")"
  echo "OK $name: imported $node_count subpaths under node, $bun_count under bun" >&2

  rm -f "$tarball_path"
  tarball_path=""
  checked=$((checked + 1))
done

[ "$checked" -gt 0 ] || fail "no package with publishConfig.exports found"
echo "OK $checked package(s) verified" >&2
