---
"@cosmicdrift/kumiko-bundled-features": patch
---

The anonymous text-block reads serve stored html bodies only after the document sanitizer and withhold rejected ones.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Text-block reads sanitize stored html
detail: by-slug and by-tenant returned the stored body as is, so an html text block written before the write gate existed or through a seed or import reached anonymous visitors unsanitized. Both queries now run a stored tenant html body through the same sanitizer as the write gate (cached per version) and return content null when it is rejected; by-tenant shows such a block as a stub. Markdown and plain bodies and system rows are returned unchanged.
-->
