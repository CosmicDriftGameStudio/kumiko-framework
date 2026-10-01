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

problems=()
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

  # A `files` entry under src/ (exact file, directory prefix or `*` glob) is intentionally shipped as source.
  allowed_src="$(jq -r '.files[] | select(startswith("src/"))' "$pkg_json")"
  stray_src=""
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    allowed=0
    while IFS= read -r prefix; do
      [ -n "$prefix" ] || continue
      if [ "$entry" = "package/$prefix" ] || [[ "$entry" == "package/${prefix%/}/"* ]] || [[ "$entry" == package/$prefix ]]; then allowed=1; break; fi
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

  if jq -e '(.files // []) | index("README.md")' "$pkg_json" >/dev/null && ! grep -qxF 'package/README.md' <<<"$listing"; then
    problems+=("$name: lists README.md in files but the tarball has none")
  fi

  # Resolved or dynamically imported at runtime, so a missing declaration only breaks consumers; a consumer install hoists everything and hides it here.
  unpacked="$(mktemp -d "$scratch/scan.XXXXXX")"
  tar -xzf "$tarball_path" -C "$unpacked"
  while IFS= read -r used; do
    [ "$used" != "$name" ] || continue
    jq -e --arg d "$used" '[.dependencies, .peerDependencies, .optionalDependencies] | map(. // {} | has($d)) | any' <<<"$packed_json" >/dev/null \
      || problems+=("$name: dist resolves $used at runtime but does not declare it")
  done < <(grep -rhoE --include='*.js' "(resolveSync|require\.resolve|import)\([\"']@cosmicdrift/kumiko-[a-z0-9-]+" "$unpacked/package/dist" 2>/dev/null | grep -oE '@cosmicdrift/kumiko-[a-z0-9-]+' | sort -u || true)

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
# A real consumer installs the required peers itself (e.g. tailwindcss for renderer-web/theme-plugin) and @types/react for its own JSX.
peers='{}'
for pkg_dir in "${dirs[@]}"; do
  peers="$(jq --argjson peers "$peers" '$peers + ((.peerDependencies // {}) as $p | (.peerDependenciesMeta // {}) as $m | $p | with_entries(select($m[.key].optional != true)))' "$pkg_dir/package.json")"
done
jq -n --argjson deps "$deps" --argjson peers "$peers" '{type: "module", private: true, dependencies: ({"@types/react": "^19.2.14", "@types/react-dom": "^19.2.3", "@types/node": "^24"} + $peers + $deps), overrides: $deps}' >"$consumer/package.json"
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

# server-runtime resolves renderer-web's stylesheet from its own location; this must work from the installed layout.
if [ -d "$consumer/node_modules/@cosmicdrift/kumiko-server-runtime" ] && [ -d "$consumer/node_modules/@cosmicdrift/kumiko-renderer-web" ]; then
  (cd "$consumer" && bun -e 'import { existsSync } from "node:fs"; const p = Bun.resolveSync("@cosmicdrift/kumiko-renderer-web/styles.css", "./node_modules/@cosmicdrift/kumiko-server-runtime"); if (!existsSync(p)) process.exit(1)') \
    || problems+=("server-runtime: @cosmicdrift/kumiko-renderer-web/styles.css does not resolve from the installed package")
fi

# Consumer-shaped typecheck: no bun-types (only @types/node, as any Node consumer has), skipLibCheck off, so an ambient Bun/Temporal reference in any shipped .d.ts surfaces.
{
  for i in "${!names[@]}"; do
    while IFS= read -r key; do
      specifier="${names[$i]}"
      [ "$key" = "." ] || specifier="$specifier/${key#./}"
      echo "export * as m${i}_$(tr -c 'a-zA-Z0-9\n' '_' <<<"$key") from \"$specifier\";"
    done < <(jq -r '.exports | to_entries[] | select((.value | type) == "object" and ((.value.types // "") | endswith(".d.ts"))) | .key' "$consumer/node_modules/${names[$i]}/package.json")
  done
} >"$consumer/typecheck-entry.ts"
echo "== consumer typecheck ($(wc -l <"$consumer/typecheck-entry.ts" | tr -d ' ') entry points)" >&2
cat >"$consumer/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "skipLibCheck": false,
    "noEmit": true,
    "types": ["node"]
  },
  "files": ["typecheck-entry.ts"]
}
JSON
# skipLibCheck stays off so our .d.ts are really checked; third-party declaration errors (bun-types under the current tsc) are not ours to fix.
typecheck_output="$(cd "$consumer" && "$repo_root/node_modules/.bin/tsc" -p tsconfig.json 2>&1 || true)"
own_errors="$(grep -E 'node_modules/@cosmicdrift/[^(]*\([0-9]+,[0-9]+\): error TS' <<<"$typecheck_output" || true)"
if [ -n "$own_errors" ]; then
  sed -n "1,40p" <<<"$own_errors" | sed -E 's#^.*node_modules/##' >&2
  problems+=("consumer-shaped tsc --noEmit: $(wc -l <<<"$own_errors" | tr -d ' ') errors in shipped @cosmicdrift .d.ts")
fi

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

if [ "${#problems[@]}" -gt 0 ]; then
  printf 'x %s\n' "${problems[@]}" >&2
  exit 1
fi

echo "OK ${#names[@]} package(s) verified" >&2
