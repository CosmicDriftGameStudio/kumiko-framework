---
"@cosmicdrift/kumiko-dev-server": minor
---

Deploy Dockerfile template: NPM_AUTH_TOKEN registry auth, manifest-first or full-tree install by detected layout, BUILD_VERSION/BUILD_TIME in the runtime stage, TZ=UTC; new `kumiko-init-deploy` bin with --force and a --check drift check.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Deploy Dockerfile template: NPM_AUTH_TOKEN registry auth, manifest-first or full-tree install by detected layout, BUILD_VERSION/BUILD_TIME in the runtime stage, TZ=UTC; new kumiko-init-deploy bin with --force and a --check drift check
migration: |
  The scaffolded `deploy/Dockerfile` now declares `ARG NPM_AUTH_TOKEN`
  (global + re-declared in the build stage) instead of `ARG GITHUB_TOKEN`,
  and exports `ENV GITHUB_TOKEN=${NPM_AUTH_TOKEN}` in the build stage —
  bunfig.toml/.npmrc still read `$GITHUB_TOKEN`, only the build-arg name
  passed by CI changes. Apps that already generated `deploy/Dockerfile`
  from an older template keep working unchanged; re-run
  `kumiko-init-deploy --force` (or `kumiko init-deploy --force` from the
  monorepo) to pick up the new wiring, the runtime stage's
  `ARG BUILD_VERSION=dev`/`ARG BUILD_TIME=unknown` re-declaration (without
  it the runtime `ENV BUILD_VERSION`/`ENV BUILD_TIME` stayed empty despite
  a correct `--build-arg`), and `ENV TZ=UTC`.

  The install step now copies manifests first (`package.json`, `bun.lock`,
  and whichever of `bunfig.toml`/`.npmrc` exist) before `bun install`,
  unless the app's `package.json` has a `workspaces` field or a
  `file:`/`workspace:`/`link:` dependency spec, in which case it still
  does `COPY . .` first (bun needs the whole tree to resolve the
  lockfile).

  `scaffoldDeploy`/`ScaffoldDeployOptions`/`ScaffoldDeployResult` keep
  their existing shape and behavior. New: `renderDeployFiles` (pure,
  no writes) and `checkDeployDrift` (read-only, reports missing/differing
  files) are exported alongside `scaffoldDeploy`, which now calls
  `renderDeployFiles` internally. `ScaffoldDeployDetected` gained
  `installFromFullTree` and `registryConfigFiles`.

  New `kumiko-init-deploy` bin (and `runInitDeployCli` export) — same
  flags as `kumiko init-deploy` (`--app`, `--port`, `--github-org`,
  `--out`, `--force`), plus `--check` (drift check, exit 1 on any
  missing/differing file, does not write) and defaulting `--app` from
  `package.json`'s `name` (scope stripped) when omitted. `--check` and
  `--force` are mutually exclusive (exit 2). The monorepo's
  `kumiko init-deploy` command now delegates to `runInitDeployCli`
  instead of duplicating the CLI logic.
-->
