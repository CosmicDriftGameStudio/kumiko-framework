---
"@cosmicdrift/kumiko-framework": patch
---

`validateEntityIndexes` allows UNIQUE constraints on single-column `tenantId`.

Previously any single-column index on `tenantId` was rejected as redundant — `buildDrizzleTable` auto-creates an index on tenantId for query-performance. But that auto-index is **not** a UNIQUE constraint; entities that need a 1:1 relation to the tenant (e.g. `tenant-compliance-profile`) declared `{ unique: true, columns: ["tenantId"] }` explicitly and the validator rejected them, breaking boot.

Now: `{ unique: true, columns: ["tenantId"] }` passes (semantic UNIQUE constraint, not a duplicate performance-hint). The original block stays in place for `{ unique: false, columns: ["tenantId"] }` (still redundant).

Surfaced when studio.kumiko.so booted in production-bundle and the bundled-features `compliance-profiles` entity hit the validator.
