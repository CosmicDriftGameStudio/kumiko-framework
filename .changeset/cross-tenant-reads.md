---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Jobs whose `escapeHatch` grants `unsafeRaw` get `ctx.crossTenantReads` with `selectMany`, `fetchOne` and `count` across all tenants, read-only. Each call is reported as the new escape-hatch kind `cross-tenant-read`; system crons audit it once per process and the metric `kumiko_escape_hatch_uses_total` counts every call. `EscapeHatchKind` and the `escape-hatch-used` audit schema gain `cross-tenant-read`.

`tenant-lifecycle:job:run-tenant-destruction` checks through `ctx.crossTenantReads` whether a tenant is due and only then calls `ctx.db.unsafeRaw()`, so idle minutes no longer write an `unsafe-raw` audit event.

<!-- kumiko-changes
feature: jobs
type: improvement
title: ctx.crossTenantReads for read-only cross-tenant job reads
-->
