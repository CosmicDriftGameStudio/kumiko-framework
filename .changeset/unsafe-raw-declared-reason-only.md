---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`ctx.db.unsafeRaw()` no longer takes a reason argument. The reason was never audited anyway: the `unsafe-raw` audit entry always carried the reason declared in `escapeHatch: { reason }` on the handler, hook or job (or the step reason for engine-forwarded steps). Dropping the parameter removes a second, unused reason string from every call site. `ctx.systemDb.unsafeRaw(reason)` is unchanged.

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.db.unsafeRaw() takes no reason; the audit uses the declared escapeHatch reason
detail: |
  `TenantDb.unsafeRaw` is now `unsafeRaw(): DbRunner`. The `unsafe-raw` audit entry carries the reason from the `escapeHatch` declaration, as before. Calls without a matching declaration are still rejected with an `AccessDeniedError`.
migration: |
  Replace `ctx.db.unsafeRaw("...")` with `ctx.db.unsafeRaw()`. The reason lives only in `escapeHatch: { reason }` on the handler, hook or job; TypeScript flags old calls. `ctx.systemDb.unsafeRaw(reason)` is unchanged.
-->
