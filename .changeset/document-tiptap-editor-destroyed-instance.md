---
"@cosmicdrift/kumiko-bundled-features": patch
---

The document editor no longer blanks the page when it rebuilds while the stored text arrives

<!-- kumiko-changes
feature: template-resolver
type: fix
title: No blank page when the document editor rebuilds while its content loads
detail: The tiptap editor in the document and mail editors is rebuilt when placeholders or branding previews load. If the stored text arrived in the same render, the value sync read the destroyed instance, threw, and unmounted the whole app. Destroyed instances are now skipped and the rebuilt editor shows the stored text.
-->
