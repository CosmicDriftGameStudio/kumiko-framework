---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
---

New content editor format "document" for template bodies, built on the shared document schema

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: contentFormat "document" with a toolbar editor for mail and PDF templates
detail: ContentEditorFormat gains "document". template-resolver registers DocumentContentEditor for it (tiptap, lazy-loaded) and stores the body as html. The toolbar offers paragraph style, bold, italic, lists, links, placeholders and the blocks image, table, button, divider, repeat and page break; the blocks prop picks them (MAIL_DOCUMENT_BLOCKS, PDF_DOCUMENT_BLOCKS). Placeholders are inserted only as variable nodes (data-variable), never as {{name}} text. ContentPreview does not substitute example values for "document" content, because substituting a button or link href would make the schema drop that node. New exports from template-resolver/web: DocumentContentEditor, DocumentEditorProps, DocumentToolbarBlock, MAIL_DOCUMENT_BLOCKS, PDF_DOCUMENT_BLOCKS.
-->
