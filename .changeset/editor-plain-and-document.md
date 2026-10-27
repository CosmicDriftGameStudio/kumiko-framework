---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-feature-ast": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Content collections have two editor formats, plain and document.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: Content collections edit in plain or document format; rich and markdown are gone
detail: ContentEditorFormat is "plain" | "document". RichContentEditor and the old tiptap editor are removed from @cosmicdrift/kumiko-renderer/web; the document editor is DocumentContentEditor from @cosmicdrift/kumiko-bundled-features/template-resolver/web. A collection's storage format comes from its declaration on the server (plain stores plain, document stores html sanitized with sanitizeDocumentHtml for every collection kind) and the collection write no longer takes contentFormat. Saved content with {{name}} as text opens with variable nodes. Every collection gets a create form behind a "+" in its nav (unless it declares its own createAction); the collection write takes createOnly and answers an existing slug with the field error slug_exists. The text block editor and the secrets edit screen use FormScreenLayout, which takes an optional unsavedCount. useDispatchTarget is exported from @cosmicdrift/kumiko-renderer/web.
migration: Run bun kumiko-upgrade --apply. It rewrites contentFormat "rich" and "markdown" in collection declarations to "document". Replace imports of RichContentEditor with DocumentContentEditor from @cosmicdrift/kumiko-bundled-features/template-resolver/web, and drop contentFormat from collection write payloads.
codemod: scripts/codemod/content-collection-format.ts
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Server field errors without a field on the form show in the form banner
detail: An entityEdit save that fails with a field error whose path is not a rendered field (for example a field an extension section writes) now shows the message in the form error banner instead of losing it.
-->
