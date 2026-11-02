---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`JobContext` no longer declares the never-populated `_tenantId` field, `ANONYMOUS_ROLE` is defined once in `@cosmicdrift/kumiko-types`, and the `triggerName` doc names handler QNs as well as event QNs.

<!-- kumiko-changes
feature: framework
type: fix
title: JobContext drops the unused _tenantId, ANONYMOUS_ROLE has one definition
detail: The job runner never set `JobContext._tenantId`, so the `ctx.systemUser.tenantId ?? ctx._tenantId` fallbacks in the retention, soft-delete, workflow-resume and tenant-inactivity jobs were dead; they read `ctx.systemUser.tenantId` now and the field is gone from the type. `ANONYMOUS_ROLE` lives in `@cosmicdrift/kumiko-types` (the UI access predicates used a second copy) and the framework re-exports it. `JobContext.triggerName` is documented as the QN the `on` entry matched, a write/query-handler QN or an event QN.
-->
