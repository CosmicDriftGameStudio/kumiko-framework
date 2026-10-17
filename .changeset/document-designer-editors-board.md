---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-document-designer": minor
---

Document designer editors follow the approved board

Mail-layout templates accept appearance meta (width, font, outer background, accent line, button style) that the mail renderer applies, and the layout-source query returns it. The layout editor uses the shared editor shell with one paper and one shared toolbar (`DocumentContentEditor` gains `toolbarHost`). Mail and PDF editors share frame, info bar, rails and footer.

The unused `sender` key of mail template meta is gone from the editor; stored rows that still carry it are read without it, so they stay editable.

Invalid template meta now reports per-field messages (`templateResolver.errors.template.meta.<field>.required|invalid`) instead of the parser text; the editors show them at the field. The `tenant-overrides` query additionally returns one row per customising tenant (name, status, version, changed at/by) and, with `diffTenantId`, the diff to the system version. A language without a version shows an empty state in the mail editor instead of a disabled editor.

The `compileDocumentBody` option `resourceImageMaxWidthPx` caps resource images in mails (180 px). The `send-test` command takes `prefixSubject` (default true) to skip the `[TEST]` subject prefix, the template preview returns `mailLayout` (slug, scope, version of the layout used), and `RenderedMail` carries the layout ref.

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Document designer editors follow the approved board
-->
