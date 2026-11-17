---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-cli": patch
---

`listProjectionsWithState` and `kumiko project list` include the implicit entity projections; the `includeImplicit` option is removed.

<!-- kumiko-changes
feature: framework
type: breaking
title: Projection list shows implicit entity projections
detail: `listProjectionsWithState(db, registry)` used to hide the projection that `r.entity` registers for each entity (`<feature>:projection:<entity>-entity`) unless the caller passed `{ includeImplicit: true }`. An `r.projection` on an entity table rebuilds through that implicit projection, so hiding it left `kumiko project list` without the names an operator actually rebuilds. The function now always returns every registered single-stream projection and has no third parameter, and `kumiko project list` prints the implicit projections too.
migration: Drop the `{ includeImplicit: true }` argument from `listProjectionsWithState` calls. Code that relied on the old default and wants only explicit projections filters the result with `registry.getAllProjections().get(name)?.isImplicit !== true`.
affects: includeImplicit, listProjectionsWithState
-->
