---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Anonymous visitors can upload again into file fields that opt in with `anonymousUpload: true`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Opt-in anonymous uploads per file field
detail: Since the upload route rejects anonymous callers, `POST /api/files` answered 401 for every anonymous visitor. A file, image, files or images field with `anonymousUpload: true` now accepts a pending upload from an anonymous visitor (entityType and fieldName, no entityId, no actionForm); the app binds the file itself. Everything else stays 401 for anonymous callers.
-->
