---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

tenant-handover follows reference edges and nested levels, not just one level of parentRef

`resolveChildCandidates` knew exactly one edge kind: an entity's `parentRef`. An app whose graph hangs together through ordinary `{ type: "reference" }` fields got a silent partial handover — the root row moved and its children stayed in the source tenant. `parentRef` is also one level deep by construction, so even declaring it could not express a root → child → grandchild chain. Both together are the data loss kumiko-framework#3035 warns about, reachable without doing anything wrong.

The graph now resolves level by level. An entity is reached when it declares a `parentRef` naming a type already in the graph, or a single-valued `reference` field pointing at one. Each level's moved row ids become the next level's parents, edges are de-duplicated by (entity, parent, field) so an entity referencing two types in the graph contributes both, and the root is never collected as its own descendant, which bounds a reference cycle. `transferable: true` remains the only gate on what actually moves.

<!-- kumiko-changes
feature: tenant-handover
type: improvement
title: Transfer graph follows reference edges and nested levels (fw#3088)
migration: |
  A handover now moves rows it previously left behind. An entity with `transferable: true` that points at the handover root through a plain `reference` field was silently skipped before and travels with the root from this version on, and so does anything hanging off that entity, up to five levels. The walk reaches each entity at the first depth it appears at; an entity that a second, longer reference path also leads to is not re-visited at that greater depth, so rows hanging below it on that longer path stay behind. Check every entity declaring `transferable: true` and confirm it should move with its host — an entity that should NOT travel needs `transferable` removed, which is also what the existing named `entity_not_transferable` error reports at claim time. Two new boot errors, both scoped to `transferable: true` entities only: a `multiple` reference on such an entity is rejected (its jsonb array cannot be matched by the mover, so its rows would be left behind), and a transferable reference chain deeper than five levels is rejected with the offending path. The boot check measures transferable reference chains only, so for the shapes it cannot see the mover carries the same guarantee at claim time: a graph that reaches past five levels and actually has rows down there fails with `transfer_graph_too_deep` and rolls the whole handover back, rather than moving part of it.
-->
