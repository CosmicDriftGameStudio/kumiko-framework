---
"@cosmicdrift/kumiko-bundled-features": patch
---

A revalidation of a public media variant answers 304 without reading the file from storage.

<!-- kumiko-changes
feature: file-derivatives
type: improvement
title: Public media route skips the storage read on 304
detail: `GET {basePath}/:fileRefId/:variant` read the full variant from storage and base64-encoded it on every request, even when the client's `If-None-Match` matched and the answer was a 304. The route now forwards `If-None-Match` to the `public-variant` query as `ifNoneMatch`; the query still runs the tenant, `isPublic` and rate-limit checks, computes the ETag from tenant, fileRef, variant and the storage key, and returns `{ notModified: true }` without bytes when it matches. A 200 result carries `notModified: false` next to `dataBase64`, `mimeType` and `revision`. The ETag value changes once, so cached clients revalidate one more time after the update.
-->
