---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

Boot validation reports bootCheck crashes, unknown screen types and column widths more precisely, and `kumiko-schema validate --json` matches its exit code.

<!-- kumiko-changes
feature: framework
type: fix
title: boot validator and schema CLI report crashes, unknown screen types and drift correctly
detail: A runtime crash (TypeError and the like) inside `r.bootCheck` now surfaces as itself instead of a `boot-check/failed` finding, and a nested `BootValidationError` keeps its own violations. An unknown screen `type` is reported as such before the nav check can mask it. entityList rowActions share the list-action target validation, so navigate resolution lives in one place. Column `width` and `minWidth` above `LIST_COLUMN_MAX_WIDTH_PX` (2000, now in kumiko-types and shared with the renderer clamp) are rejected at boot. SQL derived fields reject `bigInt` fields, which a number valueType would round above 2^53. `kumiko-schema validate --json` adds a top-level `ok` plus `schemaDrift`, `migrations` and `rowLevelSecurity` results next to `boot`, and flags `boot.importAborted` when a runtime crash stopped the schema.ts import after violations were collected (human output warns too). The definition collector treats a crash as a follow-up only when the same feature already has a violation. `findEntity` ignores Object.prototype member names. `toEntityWebhookPayload` throws on a contract without a verb and covers all three verbs. `WEBHOOK_ENTITY_VERBS` is exported. The personal-access-token scope check names the actual reason (no opt-in, unknown entity, internal event) in its error.
-->
