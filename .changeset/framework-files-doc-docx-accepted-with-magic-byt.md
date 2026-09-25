---
"@cosmicdrift/kumiko-framework": minor
---

files: doc/docx accepted, with magic-byte content verification

EXTENSION_MIME_WHITELIST and MAGIC_BYTE_SIGNATURES now cover .doc (application/msword, OLE signature) and .docx (application/vnd.openxmlformats-officedocument.wordprocessingml.document, ZIP signature). New exported validateFileContent(mimeType, content) checks, for doc/docx only, the declared mimeType against the file's magic bytes independent of options.accept — validateFile's own signature is unchanged (metadata-only); file-routes.ts calls validateFile first, then validateFileContent once after reading the upload body. normalizeMimeType is exported from files/types.ts as the single case/parameter-normalization helper (derivatives-context.ts's local copy was removed in favor of it).

<!-- kumiko-changes
feature: framework
type: improvement
title: files: doc/docx accepted, with magic-byte content verification
-->
