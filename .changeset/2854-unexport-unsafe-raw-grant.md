---
"@cosmicdrift/kumiko-framework": minor
---

`withUnsafeRawGrant` is no longer exported from `@cosmicdrift/kumiko-framework/db`. It let a consumer self-issue the `unsafeRaw` escape hatch without the guard seeing it declared at registration. No app repo, platform, studio, or enterprise code imported the symbol; the framework's own internal users already import `withUnsafeRawGrant` directly from `./tenant-db`/`../db/tenant-db`, not through the barrel, so they are unaffected.

<!-- kumiko-changes
feature: framework
type: breaking
title: withUnsafeRawGrant is no longer exported from @cosmicdrift/kumiko-framework/db
migration: |
  A consumer that imported `withUnsafeRawGrant` from `@cosmicdrift/kumiko-framework/db` to grant itself `unsafeRaw` access declares `escapeHatch: { reason: "<why>" }` on the relevant registration (handler, hook, or `r.useExtension(...)`) instead, then fetches the runner with `ctx.db.unsafeRaw("<same reason>")`. No blast radius found outside the framework itself: no app repo, kumiko-platform, kumiko-studio, or kumiko-enterprise code used this symbol.
-->
