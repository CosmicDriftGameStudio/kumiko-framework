---
"@cosmicdrift/kumiko-framework": minor
---

files: content verification is now keyed by filename extension, covering every signature-bearing type

<!-- kumiko-changes
feature: framework
type: breaking
title: files: content verification is now keyed by filename extension, covering every signature-bearing type
migration: |
  validateFileContent's signature changes from (mimeType: string, content: Uint8Array) to (fileName: string, content: Uint8Array): string | null. It now content-verifies every extension whose EXTENSION_MIME_WHITELIST entry overlaps MAGIC_BYTE_SIGNATURES (jpg/jpeg/png/gif/webp/pdf/doc/docx), not just doc/docx, and derives the check declaratively from the whitelist instead of a hardcoded per-format list. file-routes.ts now passes file.name instead of file.type (Bun derives File#type from the filename anyway, so the mimeType-keyed call was already comparing an extension-derived value to itself). A malicious extension shaped like a JS prototype property (constructor, __proto__, toString) resolves to "unknown extension" (no error) instead of crashing with a 500 — the same Object.hasOwn-guarded whitelist lookup is now shared by validateFile and validateFileContent. mime_mismatch remains a metadata-only pre-check; it is not real evidence of file content. Any test that uploads placeholder bytes (e.g. [1,2,3]) through the real upload route under one of the now-verified extensions must switch to real minimal signature bytes or a differently-named/unchecked extension.
-->
