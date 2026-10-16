---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Write handlers can run external calls before the transaction

<!-- kumiko-changes
feature: framework
type: improvement
title: Write handlers can declare a beforeTransaction phase, and file bytes can be uploaded before the transaction
detail: defineWriteHandler accepts beforeTransaction(event, ctx), which the dispatcher runs after the pre-handler gates and any reserveBeforeTransaction and before the transaction opens, so a slow external call holds no pool connection. Its data reaches the handler as event.prepared; a failure result or throw rejects the write, and its release runs whenever the transaction does not commit. ctx.write, appendEvent, notify and the other write surfaces throw inside the phase, and a handler with the phase cannot run as a nested ctx.write. uploadFileBytesBeforeTransaction writes the bytes in that phase and createFileRefFromUploadedBytes creates the fileRef row in the handler; the release keeps the bytes when the row exists. Original files whose row never committed stay in storage, no job sweeps them.
-->
