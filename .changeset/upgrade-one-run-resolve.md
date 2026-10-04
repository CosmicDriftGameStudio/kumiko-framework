---
"@cosmicdrift/kumiko-framework": minor
---

kumiko-upgrade: one --apply run advances, manual items are resolved with --resolve

`--apply` now moves the marker to the installed version in a single run. Breaking changes without a codemod stay in the marker as `pendingManual` with a stable id (`<version>:<8-char title hash>`) and are listed after every run; the upgrade guard no longer fails on them. `--resolve <id|version>[,...] --reason "<text>" [--not-applicable]` moves entries to `resolvedManual` (version must match exactly one open entry; unknown refs write nothing). Resolved ids do not come back. The plain report lists open entries, and `--json` carries them as `pendingManual`.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-upgrade advances in one --apply run, tracks open manual migrations with ids and resolves them via --resolve
migration: If you relied on a second --apply to acknowledge manual migrations, run kumiko-upgrade --resolve <id> --reason "<text>" instead.
-->
