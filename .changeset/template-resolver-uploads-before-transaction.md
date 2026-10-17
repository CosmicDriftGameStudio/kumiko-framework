---
"@cosmicdrift/kumiko-bundled-features": patch
---

resource-upload, import-bundle and import-bundle-system move their storage I/O in front of the transaction

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: resource-upload, import-bundle and import-bundle-system upload in a beforeTransaction phase and can no longer run as nested writes
detail: The three handlers now validate and upload their files before the write transaction opens and only create the fileRef and template rows inside it, so no database connection sits idle in a transaction during storage I/O. A rolled-back transaction releases the uploaded bytes. Because they now have a pre-transaction phase, the dispatcher rejects a nested ctx.write, ctx.writeAs or handler-to-handler call of them ("has a pre-transaction phase"). The exported storeTemplateResource is replaced by prepareTemplateResourceBeforeTransaction (beforeTransaction half) and storePreparedTemplateResource (in-transaction half).
migration: Dispatch resource-upload, import-bundle and import-bundle-system as top-level commands, or from a perCommand handler via ctx.write. A handler that called them nested moves that call into a client or job, or becomes a perCommand handler. Code that called storeTemplateResource calls prepareTemplateResourceBeforeTransaction in a beforeTransaction phase and passes the result to storePreparedTemplateResource in the handler.
-->
