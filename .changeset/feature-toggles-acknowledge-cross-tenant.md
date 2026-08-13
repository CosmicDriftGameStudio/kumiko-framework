---
"@cosmicdrift/kumiko-bundled-features": patch
---

`feature-toggles`'s `set`/`list`/`registered` handlers now read and write `globalFeatureStateTable` through `ctx.systemDb.acknowledgeCrossTenant(...)` instead of `ctx.db` directly, matching the fw#2069 pattern for `r.systemScope()` handlers. The table has no tenant column and was never tenant-filtered — this is pattern consistency, not a behavior or security change.
