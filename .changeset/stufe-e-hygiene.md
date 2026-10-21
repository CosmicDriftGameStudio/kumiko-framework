---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

selectMany can read the newest row per key with `distinctOn`, the renderer view-model inputs accept a narrower entity, and two new ratchets cap oversized files and legit casts.

<!-- kumiko-changes
feature: framework
type: improvement
title: selectMany distinctOn for newest-row-per-key reads
detail: SelectOptions.distinctOn takes field names and emits SELECT DISTINCT ON over them, keeping the first row per key by orderBy, so newest-row-per-key reads no longer need unsafeRaw. orderBy has to start with the distinctOn fields in the same order, otherwise selectMany throws; without orderBy it defaults to them ascending. Tenant scoping applies as for every selectMany. Error classification and driver detection drop the branches for the removed Bun.SQL driver (ERR_POSTGRES_* codes, SQLSTATE in errno, millisecond timeouts), which postgres-js never produces.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: SelectOptions.distinctOn and split screen types
detail: SelectOptions gains the optional distinctOn field. The screen type definitions are split into several files below 2000 lines; the import paths of the exported types are unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: View-model inputs take only the entity parts they read
detail: ComputeEditViewModelInput.entity and ComputeListViewModelInput.entity are typed as the Pick of EntityDefinition they actually read, so synthesized entities need no cast. Passing a full EntityDefinition keeps working. Renderer console output goes through one dev-console module.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: File Size guard and per-package ratchet for legit casts
detail: The File Size guard freezes production files above 2000 lines in `.kumiko-file-size-baseline.json` and fails when a file grows or a new one crosses the limit. The As-Casts Audit additionally caps legit-bridge and legit-boundary casts per package in `.kumiko-cast-legit-baseline.json`. Without the baseline files both only warn.
migration: Optional. Freeze both with `kumiko-guards guards --write-baseline --guard="File Size"` and `--guard="As-Casts Audit"`.
-->

<!-- kumiko-changes
feature: bundled-features
type: improvement
title: Comments describe postgres-js as the only driver
detail: Comments that referred to the removed Bun.SQL driver now name postgres-js. No behavior change.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Database wait ignores Bun.SQL error codes
detail: The transient connection error list no longer contains the ERR_POSTGRES_* codes of the removed Bun.SQL driver; postgres-js never raises them.
-->
