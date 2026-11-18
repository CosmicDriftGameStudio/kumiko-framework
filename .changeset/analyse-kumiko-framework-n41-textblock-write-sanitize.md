---
"@cosmicdrift/kumiko-bundled-features": minor
---

`template-resolver:write:set` runs html text-block and snippet bodies of every scope, the system scope included, through the document sanitizer and refuses bodies it rejects.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Text-block writes reject external images and embeds
detail: `TemplateResolverHandlers.set` stored html text blocks and snippets as written. It now checks them with the same document sanitizer as document templates, for tenant and system scope alike, and answers a rejected body with `validation_error`. The field issues carry the sanitizer codes, among them `script_element`, `event_handler_attribute`, `disallowed_link_href`, `external_image_source` (an `<img>` with `src` or `srcset`), `image_without_resource` (an `<img>` without `data-resource`) and `embedded_content` (`<iframe>`, `<object>`, `<embed>`). A text block cannot carry an image at all, because `set` stores no linked resources. Markdown and plain bodies are unchanged.
migration: Remove external images, images and embeds from html text blocks and snippets before you save them again: an existing block that still contains them fails with `validation_error` on its next `set` (the anonymous reads already withhold such a tenant block and serve a system block unchanged). Seeds and imports that write such bodies through `set` fail the same way. Link to an image or video instead of embedding it, or move the content into a document template that carries the image as a linked resource.
-->
