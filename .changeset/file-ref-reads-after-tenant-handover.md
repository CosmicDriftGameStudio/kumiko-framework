---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

FileContext.refFromFileRef reads files whose fileRef moved to another tenant

<!-- kumiko-changes
feature: framework
type: fix
title: FileContext.refFromFileRef reads files whose fileRef moved to another tenant
detail: A tenant handover moves the fileRef row but not the bytes, so the storageKey keeps the previous tenant's prefix and the tenant-bound `ctx.files.ref(key)` rejected it. FileContext gains `refFromFileRef({ storageKey })` for keys read from a fileRef row the caller has already tenant-checked: it skips the tenant-prefix check and still rejects unsafe keys. The variant route and ctx.derivatives.variant use it, so variants of handed-over files render again. `ref(key)` keeps the prefix check for freely supplied keys.
-->
