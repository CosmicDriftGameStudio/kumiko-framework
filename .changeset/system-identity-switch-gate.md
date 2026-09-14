---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`ctx.queryAs`/`ctx.writeAs` with a SYSTEM identity now throws `access_denied` unless the calling handler belongs to an `r.systemScope()` feature or declares `escapeHatch: { reason }` (now also accepted on query handlers and as `r.hook(..., { escapeHatch })`); jobs stay ungated, hooks no longer inherit their handler's grant, and grants never propagate to nested handlers. Bundled auth, MFA, user-profile and user-data-rights handlers declare their SYSTEM lookups via `escapeHatch`.
