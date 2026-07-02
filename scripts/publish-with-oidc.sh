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

# @cosmicdrift/* package → its release version (this run's package.json set). The
# pin-drift guard validates each internal pin against the ACTUAL version of that
# dependency, not the depending package's own version: cli runs an independent
# version line (0.2.x) yet correctly pins dev-server@0.67.x.
workspace_versions="$(jq -s 'map({(.name): .version}) | add' packages/*/package.json)"

for pkg_json in packages/*/package.json; do
  pkg_dir="$(dirname "$pkg_json")"
  name="$(jq -r .name "$pkg_json")"
  version="$(jq -r .version "$pkg_json")"

  # Publishable: own scope OR the explicit unscoped bun-create wrapper(s).
  # `bun create kumiko-app` resolves to bunx create-kumiko-app, which forces
  # an unscoped npm name (create-kumiko-app); the @cosmicdrift/* allowlist
  # alone would silently skip it. Fallback name `create-kumiko` is included
  # so the rename path stays one bash edit, not a re-publish-script ripple.
  case "$name" in
    @cosmicdrift/* | create-kumiko-app | create-kumiko) ;;
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
  # Wir packen via `bun pm pack` (rewrited workspace:* → echte Versionen) und
  # publishen die Tarball via `npm publish` (für OIDC + provenance). Direkt
  # `npm publish` würde workspace:* in die registry schreiben → Konsumenten
  # bekommen "Workspace not found" beim install. `bun publish` rewrited richtig,
  # unterstützt aber kein OIDC-Trusted-Publishing.
  # --quiet emittet den Tarball-Basename auf stdout (im pkg_dir erzeugt), aber
  # mit führender Leerzeile (bun 1.3.14) → .tgz-Zeile rausfiltern. Die pack-
  # Substitution bleibt in der if-Condition, damit `set -e` einen Pack-Fehler
  # nicht zum Script-Abbruch macht (er soll nur dieses Paket als failed zählen).
  TARBALL=""
  pin_drift=""
  if TARBALL="$(cd "$pkg_dir" && bun pm pack --quiet | grep -E '\.tgz$' | tail -n1)" \
     && [ -n "$TARBALL" ]; then
    # Guard (#410): the packed manifest must pin every internal @cosmicdrift/*
    # dependency to that dependency's release version. workspace:* is substituted
    # from bun.lock at pack time — a lock left stale by `changeset version` ships a
    # lagging pin (e.g. renderer@0.64 → framework@0.57) that breaks consumers
    # without full `overrides`. Each pin is checked against the dependency's actual
    # version ($workspace_versions), not $version — cli has an independent 0.2.x
    # line but pins dev-server@0.67.x correctly. Refuse to publish on drift.
    pin_drift="$(tar -xzOf "$pkg_dir/$TARBALL" package/package.json \
      | jq -r --argjson expected "$workspace_versions" -f "$REPO_ROOT/scripts/pin-drift.jq")"
  fi

  if [ -z "$TARBALL" ]; then
    echo "[fail] $name@$version: pack produced no tarball" >&2
    failed+=("$name@$version")
  elif [ -n "$pin_drift" ]; then
    echo "[fail] $name@$version: internal pin(s) drift from the release version — $pin_drift." >&2
    echo "[fail] bun.lock is stale; the version step must run 'changeset version && bun install'." >&2
    failed+=("$name@$version (pin drift)")
  # npm refuses to IMPLICITLY move the `latest` dist-tag backward when a higher
  # version already sits on the registry (the accidental 1.0.0 misfire is stranded
  # above the 0.10x line until the real 1.0.1 milestone ships — publishing 0.10x
  # then errors "Cannot implicitly apply the latest tag ..."). Publishing under a
  # throwaway tag never trips that guard; we then force `latest` to this release
  # via dist-tag (a manual dist-tag moves latest to ANY published version, unlike
  # the implicit path). For a normal monotonic release the end state is identical:
  # latest = the just-published version, throwaway tag removed. dist-tag auths via
  # NODE_AUTH_TOKEN (set in the release job).
  elif npm publish "$pkg_dir/$TARBALL" --provenance --access public --tag kumiko-tmp >&2 \
       && npm dist-tag add "$name@$version" latest >&2; then
    npm dist-tag rm "$name" kumiko-tmp >&2 2>/dev/null || true
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
    #
    # Lokales git-tag selbst erstellen, sonst failed der nachgelagerte
    # `git push origin <tag>` der action mit "src refspec does not match any":
    # bei `yarn changeset publish`-default-flow erstellt yarn die tags, bei
    # unserem custom-script müssen wir das selber tun. Resultat sonst:
    # release-Job rot trotz erfolgreichem npm publish.
    # Lightweight (kein -a/-m) → keine user.email/name config nötig.
    # changesets/action selbst nutzt auch lightweight-tags.
    git tag "$name@$version" >&2 || \
      echo "[warn] git tag $name@$version failed (may already exist)" >&2
    echo "New tag: $name@$version"
  else
    failed+=("$name@$version")
  fi
  if [ -n "$TARBALL" ]; then rm -f "$pkg_dir/$TARBALL"; fi
done

echo "" >&2
echo "Summary: $published published, $skipped skipped, ${#failed[@]} failed" >&2

if [ "${#failed[@]}" -gt 0 ]; then
  printf '  failed: %s\n' "${failed[@]}" >&2
  exit 1
fi

# stdout: das einzige strukturierte Output für changesets/action.
echo "$published_json"
