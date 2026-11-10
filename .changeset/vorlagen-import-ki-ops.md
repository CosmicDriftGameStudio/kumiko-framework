---
"@cosmicdrift/kumiko-bundled-features": minor
---

An AI assistant can now rebuild a PDF template and its layout from structured blocks, the way a person does in the editor.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: patch-draft and create-layout let an agent rebuild PDF templates and layouts
detail: patch-draft and document-blocks accept inline runs (bold, italic, underline, font, size, color), block formatting, lists, tables with a repeat row, address and text frames, a replaceBody op and a formatBlock op, all checked against the editor's print ranges and fonts. They also take kind pdf-layout with a region (header, signature or footer). The new create-layout handler creates an empty PDF layout draft under the slug tenant-layout-<name>; a tenant may edit, publish and use such layouts as soon as it may edit any PDF template, and system layouts may not take that prefix (reserved_layout_slug). patch-draft is now an agent proposal with risk low; its new refusals use the patch error codes print_style_not_allowed, invalid_table, too_many_blocks and others.
-->
