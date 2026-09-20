---
"@cosmicdrift/kumiko-cli": minor
---

New `kumiko check`: boot validation plus the guard suites in one command, step list derived from kumiko.json

Until now every consumer repo assembled the same chain by hand — `kumiko-schema validate` plus `kumiko-guards guards|ui|checks` in package.json, CI YAML or check-wt.sh, in four different shapes, each with its own hand-written presence gate (`|| true`, `::error::`, `bun add --no-save`). `kumiko check` derives the step list declaratively from the kumiko.json manifest instead: `kind: "app"` adds boot validation (validateBoot over the composed FEATURES in kumiko/schema.ts), any kind other than "tooling" adds the AST guards and the repo checks, declared uiRoots add the UI guards, and a "tooling" repo says out loud that it has nothing to check. `--explain` prints the resolved step list with the reason for each step and passes through to the guards own --explain without running a suite. When @cosmicdrift/kumiko-guards cannot be loaded the command fails with an install hint instead of skipping silently.

<!-- kumiko-changes
feature: cli
type: improvement
title: New `kumiko check`: boot validation plus the guard suites in one command, step list derived from kumiko.json
migration: |
  No action required — additive. A repo that today calls `kumiko-schema validate` and `kumiko-guards guards|ui|checks` separately in package.json, CI YAML or check-wt.sh replaces that chain with `bun kumiko check`; the step list then follows from kumiko.json (kind, uiRoots) instead of from the script. Private bins without a public counterpart (kumiko-guard-comment-lang, kumiko-guard-ui) stay as their own step next to it for now.
-->
