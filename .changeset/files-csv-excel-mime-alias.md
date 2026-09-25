---
"@cosmicdrift/kumiko-framework": minor
---

validateFile/resolveUploadMimeType accept .csv declared as application/vnd.ms-excel

<!-- kumiko-changes
feature: framework
type: improvement
title: validateFile/resolveUploadMimeType accept .csv declared as application/vnd.ms-excel
detail: |
  Windows derives a file's upload MIME type from its Explorer file-type
  association rather than its content — .csv is registered to Excel there,
  so a Windows browser can declare "application/vnd.ms-excel" for a
  plain-text CSV. validateFile now accepts that declared/extension
  combination for fields whose `accept` includes "csv" instead of rejecting
  it as a `mime_mismatch`. The built-in multipart upload route also calls the
  new `resolveUploadMimeType`, which rewrites an aliased declared mimeType to
  its canonical form ("text/csv") after checking the uploaded bytes against
  known binary signatures — a match (e.g. a real .xls/.xlsx renamed to .csv)
  is rejected with `content_mismatch` instead of being silently rewritten.
  Note: on Bun 1.4.0 (this repo's pinned engines/Dockerfile version, verified
  locally), `Request#formData()` derives a multipart file's `.type` from its
  filename extension rather than the part's declared Content-Type, so a
  browser's declared "application/vnd.ms-excel" for a `.csv` file does not
  currently reach the built-in route as such — callers that read a declared
  mimeType from elsewhere (e.g. a separate form field) are the ones this
  alias helps today. Aliases are declarative per extension; only
  csv → vnd.ms-excel is defined so far.
  `@cosmicdrift/kumiko-framework/files` now also exports `sniffMimeType(bytes:
  Uint8Array): string | null` (canonical MIME for a known binary signature,
  or null for text formats — every OLE Compound File returns
  "application/msword" and every ZIP returns the docx MIME, callers can't
  tell those apart by bytes alone) and `resolveUploadMimeType`.
-->
