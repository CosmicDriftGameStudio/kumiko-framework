---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Erasure jobs delete the bytes of files that a tenant handover moved into the tenant

<!-- kumiko-changes
feature: framework
type: fix
title: Soft-delete cleanup and hardDelete retention delete the bytes of handed-over files
detail: A tenant handover moves a fileRef row to the new tenant, but its storageKey keeps the previous tenant's prefix. The soft-delete cleanup and the data-retention hardDelete went through `ctx.files.ref()` and `ctx.files.list()`, which reject keys outside the job's tenant, so the bytes and derivatives of such files were never deleted and the soft-delete cleanup kept the row forever. Both now delete through the new `deleteFileRefBytes(files, row, context)` from `@cosmicdrift/kumiko-framework/derivatives`, built on the new `FileContext.listFromFileRef(row)` (the row's key plus its derivatives, under the same trust as `refFromFileRef`). Form-draft discard deletes draft files through `refFromFileRef` as well.
-->
