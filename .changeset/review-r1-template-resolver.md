---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes for the template resolver: stored documents keep rendering, images variables accept captions.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Template resolver review fixes
detail: The frame-outside-page check now applies only to write gates (`sanitizeTemplateWriteBody`, collection writes, `rejectFramesOutsidePage`), so a body stored before it keeps rendering instead of silently falling back to the system template. The sender line joins spans separated by a whitespace-only line break. Signature PNGs with a two-tone background are no longer accepted as empty. A variant looks for its base in the fallback locale too. `images` template variables validate `{ fileRefId, caption? }` entries (preview, notifications). A stored-template preview with the PDF plugin no longer prints a draft-only letterhead (`DocumentPreviewRequest.working`). The overview groups variants with one map lookup, and the README describes the table page-break rule correctly.
-->
