---
"@cosmicdrift/kumiko-framework": patch
---

Fix the boot-validator action-field allowlist so it accepts every row-meta column,
not just `id`/`version`. `buildBaseColumns` materializes `tenantId`, `insertedAt`,
`modifiedAt`, `insertedById`, `modifiedById` (plus `isDeleted`/`deletedAt`/`deletedById`
on softDelete entities) on every entity row, yet `validateActionFieldRefs` only
exempted `id`/`version` for `pick`/`map` sources and exempted nothing on `visible.field`.
A legitimate `pick: ["id", "version", "tenantId"]` or `visible: { field: "id" }` therefore
crashed the boot — the same CrashLoop class the validator is meant to fix, one meta-field
over. The allowlist is now derived from `buildBaseColumns` via the new
`rowMetaFieldNames(softDelete)` and applied to both the extractor-source and
`visible.field` checks; softDelete-only columns stay unknown for non-softDelete entities,
so picking on them there is still rejected.
