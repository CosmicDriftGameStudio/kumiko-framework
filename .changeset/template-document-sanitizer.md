---
"@cosmicdrift/kumiko-bundled-features": minor
---

Template bodies of kind mail-html and document-pdf with contentFormat html are rebuilt through a shared document schema on every write

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: document-pdf templates require contentFormat html, and html bodies are sanitized on write
detail: upsertSystem, upsertTenant, the collection-set handlers and seedSystemTemplate rebuild html bodies of kind mail-html and document-pdf through the new document schema (template-resolver/document-schema). Script elements, inline event handlers, embedded content (iframe, frame, object, embed, applet, portal), links and url attributes (svg href, xlink:href, form action, base) outside https/http/mailto/tel/{{placeholder}}, external image sources, alt text containing < or >, and invalid or prototype-chain variable names are rejected with a validation_error (or a thrown Error in seedSystemTemplate); anything the schema cannot express is dropped silently, and links keep only href (no target, rel, class or title). New exports: documentExtensions, DocumentLink and the other Document* nodes, isAllowedDocumentLinkHref, isDocumentReferenceName, isDocumentResourceKey, isDocumentPlaceholderHref, sanitizeDocumentHtml, sanitizeTemplateBody. kind document-pdf with another contentFormat is rejected with document_requires_html_format.
migration: Store document-pdf bodies as html and reference images via data-resource instead of src. mail-html with markdown or mjml is unchanged.
-->
