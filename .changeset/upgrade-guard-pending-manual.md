---
"@cosmicdrift/kumiko-guards": minor
---

The upgrade-state guard fails while manual upgrade steps are open

`kumiko-upgrade --apply` records breaking changes without a codemod as `pendingManual` in `.kumiko/upgrade-state.json`. The guard used to ignore them, so a repo could pass with an unhandled breaking change. It now reports one violation per open step, naming the step id and the command that closes it.

<!-- kumiko-changes
feature: guards
type: breaking
title: upgrade-state guard fails on open manual upgrade steps
detail: Every entry in the marker's pendingManual list now produces a guard violation until it is resolved.
migration: Run `kumiko-upgrade --resolve <id> --reason "<what you did>"` for each open step once you applied it, or add `--not-applicable` when it does not concern your repo. The guard passes when no manual step is left open.
-->
