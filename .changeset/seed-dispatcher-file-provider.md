---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-framework": patch
---

Seeds can create fileRefs through handlers that use createFileRefFromBytes

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Seeds can create fileRefs through handlers that use createFileRefFromBytes
detail: The seed dispatcher built its handler context without the file provider resolver, so a write handler invoked via systemWriteAs failed with "createFileRefFromBytes: ctx.files is unavailable". The seed context now carries the same file provider as the HTTP path.
-->
