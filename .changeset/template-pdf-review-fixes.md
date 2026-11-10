---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-it": patch
---

PDF templates: saving a body with a frame that reaches past the largest paper is refused, the address sender line is flattened on the parsed document instead of by regex, and the tenant default PDF layout is resolved once per render.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: A frame past the paper edge is refused on save
detail: A document-pdf body whose frame reaches past 297 mm (x + width or y + height, the long edge of the largest supported paper) is refused with frame_outside_page instead of printing blank pages before the text. The sender line of an address frame is now flattened on the parsed document, so a line break next to a tag or attribute can no longer corrupt the markup. The configured default PDF layout is looked up once per render and preview.
-->
