---
"@cosmicdrift/kumiko-framework": patch
---

File downloads stream from storage instead of loading the whole file into memory.

<!-- kumiko-changes
feature: framework
type: improvement
title: File downloads stream from storage
detail: `GET /files/:id` reads through the provider's `readStream` and sniffs the served Content-Type from the first 12 bytes, so a download no longer holds the whole file plus a second `Buffer` copy in memory. `GET /files/:id/variant/:name` streams the rendered variant the same way. A storage object that is missing still fails before the response starts. Uploads are unchanged: the multipart body is parsed in memory and content validation needs all bytes.
-->
