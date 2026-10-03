---
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-dev-server": minor
---

`kumiko check` fails a kind "app" without uiRoots

A repo with `kind: "app"` and no `uiRoots` used to skip the UI guards silently. `kumiko check` (also with `--explain`) now prints an error and exits 1 before any step runs. Declare `uiRoots`, or set `uiRoots: []` for an app without UI; the step list then shows that the UI guards are skipped on purpose. A repo that relies on the derived manifest also gets the hint to add a `kumiko.json`. Other kinds are unchanged. `kumiko new app` now writes a `kumiko.json` with `uiRoots: ["src/features/*/web"]`.

<!-- kumiko-changes
feature: cli
type: breaking
title: kumiko check requires uiRoots for kind "app"
migration: |
  Add `uiRoots` to the `kumiko.json` of every `kind: "app"` repo, for example `["src/app", "src/features/*/web"]`, or `[]` for an app without UI. A repo without a `kumiko.json` needs one first, since the derived manifest cannot declare uiRoots.
  Workspace state at release: kumiko-platform, offlot-app, phronexsis and show-pony declare `kind: "app"` without `uiRoots`.
-->
