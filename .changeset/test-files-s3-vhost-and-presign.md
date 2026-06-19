---
"@cosmicdrift/kumiko-framework": patch
---

Harden the `files-provider-s3` test coverage flagged in review. The
`virtualHostedStyle` value `createS3Provider` passes to `Bun.S3Client` is the
inverse of the (already tested) `resolveForcePathStyle` — the lone untested
`!` seam that silently picks the wrong URL style for Minio/R2 if it drifts. It
is now extracted as the exported `resolveVirtualHostedStyle` and covered by a
truth-table test asserting it stays the strict inverse. A second test proves
`getSignedUrl` actually signs `contentDisposition` into the presigned URL as the
`response-content-disposition` query param (presign is a local HMAC op, so this
is hermetic) — otherwise downloads would silently serve the UUID key instead of
the file name. Test-only plus the small extraction.
