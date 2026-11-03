---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

Review round 3 for files: anonymous uploads get their own body cap and per-IP rate limit, a visitor without a session no longer lands on "session ended", rebindFileRef no longer reveals unreadable files, and a document import repeats cleanly after the stream was archived.

<!-- kumiko-changes
feature: framework
type: breaking
title: anonymous uploads are capped, rate limited and answer sign_in_required
detail: An anonymous POST /files is limited to the largest opted-in `anonymousUpload` field (not the largest field of the app) and to 20 uploads per minute and client IP (bucket `files-upload-anon:<ip>`, 429 with Retry-After). A visitor who never had a session now gets 401 with code `sign_in_required`; `unauthenticated` (which shows the "session ended" banner) is kept for a visitor whose session cookie went stale. `FileRoutesOptions.metaBatchRateLimitResolver` is renamed to `rateLimitResolver` and gains a sibling `clientIpResolver`. `withUploadLedger` returns a new resolver instead of mutating the one passed in. The stale pending-upload sweep only reads uploads that name a target field. `rebindFileRef` answers "not-found" (instead of "moved" or "rebound", or an AccessDeniedError) for a file the caller may not read. `ctx.events.load` accepts `includeArchived`, which the documents import uses to recognise an archived document stream.
migration: Apps calling createFileRoutes themselves rename `metaBatchRateLimitResolver` to `rateLimitResolver` and pass `clientIpResolver`. Clients that matched a 401 `unauthenticated` from anonymous uploads treat `sign_in_required` as a plain upload error. Callers of rebindFileRef that expected AccessDeniedError for an unreadable file handle "not-found".
-->

<!-- kumiko-changes
feature: documents
type: fix
title: document import is a no-op after the document stream was archived
detail: A document whose stream the retention archived is recognised as already imported, so repeating the import changes nothing instead of failing with "belongs to another record".
-->
