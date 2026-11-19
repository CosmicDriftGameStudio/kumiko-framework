---
"@cosmicdrift/kumiko-bundled-features": patch
---

Extracted document text becomes unreadable as soon as its file is deleted or forgotten.

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: documentExtract.pages is record-owned and shredded with its fileRef
detail: `pages` was tenant-subject ciphertext, so after a fileRef delete or forget the full document text stayed readable in the extract's events until the whole tenant was destroyed. It is now `personal: { of: "id" }`, and every path that forgets an extract (fileRef deleted or forgotten, orphaned extract, tenant destroy) erases the extract's record key right after the forget. Existing tenant-subject ciphertext still decrypts. Without a mounted KMS nothing changes.
-->
