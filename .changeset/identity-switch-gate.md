---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Breaking: `ctx.queryAs`/`ctx.writeAs` without a grant only accept the caller itself — same `id`, `tenantId`, `origin` and `claims`, with roles that are a subset of the caller's roles. Any other identity (a different user, a different tenant, extra roles, changed claims) now throws `AccessDeniedError` with `details.reason: "identity_switch_denied"`; SYSTEM targets keep `system_identity_switch_denied`. The grant is unchanged from fw#2859: an `r.systemScope()` feature, `escapeHatch: { reason }` on the write/query/stream handler, or the hook's own `r.hook(..., { escapeHatch })` — non-transitive, never inherited by hooks. `isSystemIdentitySwitchAllowed` is replaced by `isIdentitySwitchAllowed(caller, asUser, hasGrant)` and `createGatedIdentitySwitch` takes the caller as second argument. Jobs, top-level dispatcher calls, `ctx.queryAsMember` and `ctx.resolveActiveMembership` are unchanged. Migration: declare `escapeHatch` on handlers that act as another user or tenant, or move the call into a job / `r.systemScope()` feature (see `changes.json`, fw#2876).
