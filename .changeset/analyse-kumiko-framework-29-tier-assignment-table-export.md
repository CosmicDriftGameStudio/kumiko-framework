---
"@cosmicdrift/kumiko-bundled-features": patch
---

tier-engine exports the built tierAssignmentTable.

<!-- kumiko-changes
feature: tier-engine
type: improvement
title: tierAssignmentTable is exported from tier-engine
detail: `@cosmicdrift/kumiko-bundled-features/tier-engine` now exports `tierAssignmentTable`, the table built once from `tierAssignmentEntity`. Apps that call `buildEntityTable("tier-assignment", tierAssignmentEntity)` themselves can import it instead. The `tierAssignmentTable` returned by `createTierResolver` is now this same table.
-->
