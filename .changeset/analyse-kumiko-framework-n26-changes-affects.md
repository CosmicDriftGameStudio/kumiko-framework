---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-cli": minor
---

Breaking changes now name what they affect, so `kumiko-upgrade --apply` skips the ones an app never touches.

<!-- kumiko-changes
feature: framework
type: breaking
title: Breaking changesets declare affects
detail: A `kumiko-changes` block of type breaking without a codemod (or with `manualAfterCodemod`) must carry `affects: <symbol or path>, …` or `affects: all`; parsing fails otherwise. `kumiko changes add` takes `--affects`. `kumiko-upgrade --apply` runs `git grep -F` for these strings in the app after the codemods and records an entry as resolved not-applicable only when nothing matches; any match, a non-git directory or an error leaves it pending.
migration: Add `affects:` to every pending breaking changeset that needs manual work in your repo, or pass `--affects` to `kumiko changes add`.
affects: kumiko-changes
-->
