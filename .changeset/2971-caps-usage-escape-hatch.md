---
"@cosmicdrift/kumiko-bundled-features": patch
---

`caps:usage` now declares its own `escapeHatch`, so app-owned `CapSpec.usage()` providers can reach `db.unsafeRaw()` again. fw#2971 un-exported `withUnsafeRawGrant`, which cap providers relied on transitively through `caps:usage`'s system-mode db — since then, any cap provider computing usage via raw SQL (e.g. a SUM aggregate `TenantDb.count()` can't express) was rejected with `access_denied`.

<!-- kumiko-changes
feature: cap-overview
type: fix
title: caps:usage declares escapeHatch again so raw-SQL cap providers work
detail: fw#2971 un-exported withUnsafeRawGrant, the mechanism app-owned CapSpec.usage() providers used (via caps:usage's system-mode db) to run raw SQL for aggregates TenantDb has no typed helper for (a SUM, unlike the COUNT(*)-only TenantDb.count() added in fw#2854). caps:usage's own defineQueryHandler(...) call now carries `escapeHatch: { reason: "..." }`, restoring the grant through the same mechanism every other handler-owned unsafeRaw use goes through. Cap providers that only need COUNT(*) should migrate to TenantDb.count(table, where) instead — it needs no escapeHatch at all.
-->
