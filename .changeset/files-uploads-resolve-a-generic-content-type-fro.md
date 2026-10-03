---
"@cosmicdrift/kumiko-bundled-features": minor
---

Uploads resolve a generic content type from the file content

POST /api/files now resolves application/octet-stream or a missing type from the bytes (PDF, XML, PNG, JPEG, GIF, WebP, ZIP) and falls back to the file extension. A concrete declared type is never overridden. The shared helper resolveContentType is exported from the files module.

<!-- kumiko-changes
feature: files
type: improvement
title: Uploads resolve a generic content type from the file content
-->
