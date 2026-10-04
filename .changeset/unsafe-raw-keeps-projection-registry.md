---
"@cosmicdrift/kumiko-framework": patch
---

A TenantDb rebuilt from `unsafeRaw()` runs custom projections again

`ctx.db.unsafeRaw()` used to return the bare connection unless a public-intake gate was active. A `createTenantDb(ctx.db.unsafeRaw(), …)` inside a handler, hook or job therefore lost the projection registry, and its writes skipped custom projections. `unsafeRaw()` now returns a runner bound to the registry (and the gate, if any) whenever one is present. The file routes pass the app registry to their TenantDbs, so file events reach custom projections as well.

<!-- kumiko-changes
feature: framework
type: fix
title: TenantDbs built from unsafeRaw() and file routes run custom projections
migration: |
  `unsafeRaw()` on a dispatcher or job TenantDb now returns a proxy instead of the raw connection object. Code that compares the runner by identity with the raw connection must compare against the proxy instead. Standalone seeds that call createTenantDb on a raw connection still have no registry; seed through dispatcher.write. Code that re-ran custom projections by hand after such a write (on a reloaded event, not the returned one) must drop that call, or the projection applies twice. File upload and delete now run custom projections on fileRef events inside the same transaction, so a failing projection rolls the upload back like for any other entity.
-->
