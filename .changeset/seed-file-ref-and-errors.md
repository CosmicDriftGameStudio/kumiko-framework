---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": patch
---

Seeds can store files and see why a write failed

<!-- kumiko-changes
feature: framework
type: improvement
title: Seeds can store files and see why a write failed
detail: ProdSeedFn deps now carry createFileRef(tenantId, input), which stores bytes as a fileRef with the same validation and storage layout as POST /files, without a helper write handler. A seed write that fails with internal_error now names the handler and the cause message instead of a bare "internal error". The seed dispatcher gets the app's dispatcherOptions (and the job runner in all-in-one mode), like the HTTP dispatcher. The "ctx.files is unavailable" message of createFileRefFromBytes names the real cause: the dispatcher context has no file-provider resolver.
-->
