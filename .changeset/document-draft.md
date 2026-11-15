---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-puppeteer-client": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"create-kumiko-app": patch
---

A PDF document can be edited per object before it is printed: the new `document-draft` bundle keeps one draft per object (for example a lease contract), created from a PDF template or one of its variants, changed with the same structured operations as `patch-draft` and finalized to a stored PDF. The template stays unchanged. The shared editor workbench stacks its rail under the editor below the `md` breakpoint and its footer wraps the message above the buttons on narrow widths; the document editor's toolbar rows scroll sideways instead of wrapping there.

<!-- kumiko-changes
feature: document-draft
type: improvement
title: document-draft bundle for per-object PDF drafts
detail: `createDocumentDraftFeature({ subjectTypes, pdf: { render, store }, retention?, access?, authorizeSubject?, unscopedRoles?, subjectScreens? })` adds the entity `documentDraft` (table `read_document_drafts`, so apps that mount it need a schema migration) and the handlers `create`, `patch`, `save`, `finalize`, `revise`, `discard` and the queries `blocks` and `by-subject`. `create` copies a template or one of its variants (placeholders stay in the body) and freezes the `variables`; `patch` takes the ops of `template-resolver:write:patch-draft` except `setVariable`, `setMeta` and `setResource` (`op_not_allowed`); `finalize` prints the draft body and stores the PDF. `{ render: renderPdfBeforeTransaction, store: storeRenderedPdf }` from renderer-puppeteer-client fits `pdf` without an adapter. Body, variables and last change are personal data of the draft row; `forgetDocumentDraftsOfSubject(ctx, subject)` purges the drafts of an erased object and erases their keys. The bundle requires `user-data-rights`. The editor is the dormant custom screen `document-draft:screen:document-draft-editor`, mounted with `documentDraftClient()` from `@cosmicdrift/kumiko-bundled-features/document-draft/web`: it opens with the draft id, edits the text, lists the deviations from the template, saves, finalizes or discards (then opens `subjectScreens[subjectType]` with the subject id) and reopens a finalized draft. The subject scope (`createSubjectScope`) moved from signature to the shared barrel and is used by both bundles.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: document ops, sanitizer and block diff are exported
detail: The barrel exports `applyDocumentOps`, `documentOpsSchema`, `documentBlocksOf`, `allowedBlocksFor`, `parseDocumentJson`, `serializeDocumentJson`, `diffTemplateBlocks`, `splitTemplateBlocks` and `VARIANT_UNKNOWN_REASON`, so a bundle that keeps its own copy of a document can edit it with the same operations.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: improvement
title: renderPdfBeforeTransaction and renderPdfBytes print a stored draft body
detail: `RenderPdfArgs` and the args of `renderPdfBytes` have `draft?: DocumentPdfDraft` (`{ content, meta, variableSchema? }`). It is printed instead of the stored template; the stored template of the slug still supplies images, layout and variable schema. Used by the document-draft bundle's `finalize`.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: form-field document editor keeps tables in frame, scrolls its toolbar and leaves room for the repeat strip
detail: Under md the toolbar rows of the form-field editor are one line that swipes sideways instead of wrapping. Wide tables scroll inside their wrapper instead of leaving the editor frame, and a table with a repeat strip gets a line of room above it so the strip no longer covers the previous paragraph. The document-draft editor shows the template's variable label (or the company-data name) on a placeholder chip that has no value yet.
-->

<!-- kumiko-changes
feature: document-designer
type: breaking
title: system placeholder labels moved to the template-resolver namespace
detail: The labels of the system placeholders (tenantName, company data, page, imprint and so on) are now `template-resolver.systemPlaceholder.<name>` instead of `documentDesigner.placeholder.<name>`. The locale packages are already updated.
migration: An app that overrides a `documentDesigner.placeholder.<name>` translation renames the key to `template-resolver.systemPlaceholder.<name>`.
-->
