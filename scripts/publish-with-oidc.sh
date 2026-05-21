#!/usr/bin/env bash
# Custom publish-script für Changesets-Action mit OIDC Trusted Publishing.
#
# Warum nicht `yarn changeset publish`?
#   - Yarn-Berry unterstützt kein OIDC. Es nutzt token-Auth und kann den
#     GitHub-Actions-OIDC-Token nicht gegen einen npm-Auth-Token tauschen.
#   - npm-CLI macht das automatisch wenn id-token:write gesetzt ist UND
#     der Package-Owner einen Trusted Publisher auf npmjs.com konfiguriert
#     hat.
#
# Wie funktioniert's:
#   1. Iteriere alle `packages/*/package.json` mit Scope `@cosmicdrift/*`.
#   2. Lies lokale Version vs. published-version aus der Registry.
#   3. Wenn unterschiedlich → `npm publish --provenance --access public`.
#      npm-CLI erkennt GH-Actions-Env, holt OIDC-Token, tauscht gegen
#      kurzlebigen npm-Auth-Token, published mit Provenance-Statement.
#
# Fallback ohne Trusted-Publisher-Config: wenn NPM_TOKEN gesetzt ist nutzt
# npm den als Auth — funktioniert mit oder ohne OIDC-Setup.
#
# Fail-fast: pipefail + termination-log, sonst maskieren publish-failures
# in nachfolgenden packages den root-cause.

#
# Output-Contract für changesets/action@v1:
#   - stdout: pro publisheter package EINE Zeile `New tag: <name>@<version>`
#     (matched action-source-Regex /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/
#     — identisch zu dem was `yarn changeset publish` selbst emitted).
#   - stdout (zusätzlich, optional): JSON-Summary für eigene downstream-tools.
#   - stderr: alle Logs.
# Ohne die "New tag:"-Marker erstellt changesets/action KEINE git-tags +
# GitHub-Releases, auch wenn die packages erfolgreich auf npm landen
# (Drift-Problem 0.2.1..0.2.3 + 0.4.0..0.7.0 — letzteres weil ein früherer
# Fix-Versuch nur die JSON-Summary emitted hat, was die Action nicht parst).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

published=0
skipped=0
failed=()
published_json="[]"

for pkg_json in packages/*/package.json; do
  pkg_dir="$(dirname "$pkg_json")"
  name="$(jq -r .name "$pkg_json")"
  version="$(jq -r .version "$pkg_json")"

  # Nur eigene Scope-Pakete — fremde Workspaces (falls vorhanden) skippen.
  case "$name" in
    @cosmicdrift/*) ;;
    *) echo "[skip] $name (foreign scope)" >&2; continue ;;
  esac

  # Privates Workspace? Nicht publishen.
  if [ "$(jq -r '.private // false' "$pkg_json")" = "true" ]; then
    echo "[skip] $name@$version (private)" >&2
    skipped=$((skipped + 1))
    continue
  fi

  registry_version="$(npm view "$name" version 2>/dev/null || echo "")"

  if [ "$version" = "$registry_version" ]; then
    echo "[skip] $name@$version (already on registry)" >&2
    skipped=$((skipped + 1))
    continue
  fi

  echo "[publish] $name@$version (registry has '${registry_version:-<none>}')" >&2
  # Wir packen via `yarn pack` (rewrited workspace:* → echte Versionen)
  # und publishen die Tarball via `npm publish` (für OIDC + provenance).
  # Direkt `npm publish` würde workspace:* in registry schreiben → Konsumenten
  # bekommen "Workspace not found" beim install. Direkt `yarn npm publish`
  # rewrited richtig, unterstützt aber kein OIDC.
  TARBALL="$(mktemp -t cdgs-pack-XXXXXX.tgz)"
  if (cd "$pkg_dir" && yarn pack -o "$TARBALL" >&2) \
     && npm publish "$TARBALL" --provenance --access public >&2; then
    published=$((published + 1))
    published_json="$(jq -c \
      --arg name "$name" --arg version "$version" \
      '. + [{name: $name, version: $version}]' <<<"$published_json")"
    # changesets/action@v1 parsed pro-package eine "New tag: <name>@<version>"-
    # Zeile aus stdout (Regex: /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/) und
    # erstellt darauf basierend git-tags + GitHub-Releases. Die später emittierte
    # JSON-Summary ist als Trace gedacht, NICHT als action-Input. Ohne diese
    # Marker-Lines (release 0.4.0..0.7.0) gab es zwar npm-publish, aber keine
    # Tags/Releases. Pattern matched 1:1 was `yarn changeset publish` selbst
    # emitted (action source: packages/action-utils/src/run.ts).
    echo "New tag: $name@$version"
  else
    failed+=("$name@$version")
  fi
  rm -f "$TARBALL"
done

echo "" >&2
echo "Summary: $published published, $skipped skipped, ${#failed[@]} failed" >&2

if [ "${#failed[@]}" -gt 0 ]; then
  printf '  failed: %s\n' "${failed[@]}" >&2
  exit 1
fi

# stdout: das einzige strukturierte Output für changesets/action.
echo "$published_json"
