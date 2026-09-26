---
"@cosmicdrift/kumiko-framework": minor
---

files: a valid upload (png/jpeg/gif/webp/pdf/doc/docx) under the wrong extension is normalized to its real type instead of rejected, when that type is in the field's accept list or the upload has no accept restriction at all

A real PNG or WebP saved with a .jpg extension (a common case for renamed screenshots or messenger downloads) was rejected with `content_mismatch` even when the field's `accept` explicitly allows png/webp, or when the upload is unattached and has no `accept` restriction at all — #3287 made byte-content verification strict for every signature-bearing extension, and this closed the remaining false-positives on a harmless renamed file. `validateFileContent` now also accepts the field's `accept` list; when the sniffed byte signature doesn't match the declared extension but the sniffed type's own extension is in `accept`, the upload proceeds under the sniffed mimeType with a storage key built from the corrected extension, and the response reports the corrected mimeType. When there is no `accept` restriction at all (an unattached upload, or a field without `accept`), any recognized signature normalizes the same way, since there is no declared list to widen. The original filename is kept as the display name. A sniffed type whose extension is not in a non-empty `accept` is still rejected with `content_mismatch` — this is a normalization within the field's own declared formats (or, absent a field, within the same closed set of recognized binary signatures: png, jpeg, gif, webp, pdf, doc, docx), never a general spoofing exemption. Bytes that don't sniff as one of those known-safe signatures are rejected exactly as before.

<!-- kumiko-changes
feature: framework
type: breaking
title: "files: a valid upload (png/jpeg/gif/webp/pdf/doc/docx) under the wrong extension is normalized to its real type instead of rejected, when that type is in the field's accept list or the upload has no accept restriction at all"
detail: |
  A real PNG or WebP saved with a .jpg extension (a common case for renamed
  screenshots or messenger downloads) was rejected with content_mismatch
  even when the field's accept explicitly allows png/webp, or when the upload
  is unattached and has no accept restriction at all. validateFileContent now
  also accepts the field's accept list; when the sniffed byte signature
  doesn't match the declared extension but the sniffed type's own extension is
  in accept, the upload proceeds under the sniffed mimeType with a storage key
  built from the corrected extension, and the response reports the corrected
  mimeType. When there is no accept restriction at all, any recognized
  signature (png, jpeg, gif, webp, pdf, doc, docx) normalizes the same way.
  The original filename is kept as the display name. A sniffed type whose
  extension is not in a non-empty accept is still rejected with
  content_mismatch.
migration: |
  validateFileContent's signature changes from (fileName: string, content: Uint8Array): string | null to (fileName: string, content: Uint8Array, accept?: readonly string[]): FileContentValidationResult ({kind:"ok"} | {kind:"normalized", extension, mimeType} | {kind:"rejected", error}). A direct caller that checked "if (result)" for an error must switch to checking result.kind === "rejected" and reading result.error — every branch of the new return type is a truthy object, so an unmigrated truthy check would now reject every upload. No caller besides the built-in POST /api/files route calls this function directly today (checked across kumiko-framework, kumiko-enterprise, kumiko-platform, kumiko-studio and every app consumer). buildStorageKey gains an optional trailing extensionOverride parameter; existing calls without it are unaffected.
-->
