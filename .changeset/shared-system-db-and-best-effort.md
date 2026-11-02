---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

helpdesk and waitlist share their system-db, best-effort-send and verified-email helpers instead of keeping two copies. `acknowledgedSystemDb` is exported from `@cosmicdrift/kumiko-bundled-features/shared/acknowledged-system-db` for system-scoped app features.

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: acknowledgedSystemDb for system-scoped features
detail: `acknowledgedSystemDb(ctx, featureName, crossTenantReason)` returns `ctx.systemDb.acknowledgeCrossTenant(reason)` and throws an InternalError naming the feature when `r.systemScope()` is missing. helpdesk and waitlist use it, together with the shared `sendBestEffort` and `resolveVerifiedUserEmail`; behaviour and log texts are unchanged.
-->
