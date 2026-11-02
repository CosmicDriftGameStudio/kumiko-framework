---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Content editors share one edit/preview workbench and a preview registry. The renderer ships the shell (`EditorWorkbench`, `EditorFrame`, `EditorFooter`, rails) and a `contentPreviews` registry keyed by `pdf | mail | web | text`; managed pages, text blocks and collection entries open in it, with a Desktop/Mobil preview for pages.

<!-- kumiko-changes
feature: renderer
type: improvement
title: editor workbench shell and a contentPreviews registry for editor previews
detail: `@cosmicdrift/kumiko-renderer/web` exports `EditorWorkbench`, `EditorFrame`, `EditorInfoBar`, `EditorBody`, `EditorHeader`, `EditorFooter`, `EditorModeSwitch`, `EditorLocaleSwitch` and the rail parts `RailSection`, `RailField`, `RailRow`, `RailHint`; the shell moved out of document-designer. `ClientFeatureDefinition.contentPreviews` registers a `PreviewRenderer` per preview target (`pdf`, `mail`, `web`, `text`), merged last-wins in createKumikoApp with a warning on a collision. `PreviewPane` mounts the renderer for a target; a target without one previews as text (`TextPreviewRenderer`). `HtmlMailFrame`, `useDebouncedValue` and `dispatcherErrorTextWithFieldIssues` are exported. New locale keys `kumiko.editor.*` are in all locale packages.
-->

<!-- kumiko-changes
feature: managed-pages
type: improvement
title: page mask on the editor workbench with a live preview of the unsaved body
detail: `managedPagesClient()` registers the page mask and the shared `web` preview renderer from template-resolver (Desktop and 375 px Mobil), so the page preview works without `textBlocksClient`; the preview query lives in template-resolver. The `page-edit` screen is now a custom screen under the same id: settings in the right rail, body editor with the lossy-Markdown warning, one submit for both (create via `managed-pages:write:page:create`, update with only the changed fields). The page list has `createScreen: "page-edit"`. The extension section `managed-pages:page-body` and `PAGE_BODY_EXTENSION_NAME` are removed; an app that replaced `page-edit` with its own screen is not affected. New keys `managed-pages:editor.*` in all locale packages.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: text-block and collection-entry masks on the editor workbench, the preview toggle under the field is gone
detail: The text-block editor and the collection-entry create form open on `EditorWorkbench` with an edit and a preview mode and the placeholder example values in the right rail. `previewTargetOfKind` and `previewTargetOfCollectionKind` map a template kind to its preview target: text-block previews as `web`, snippet and ai-prompt as `text`. New query `template-resolver:query:body-preview` (TenantAdmin, SystemAdmin) renders an unsaved body (`body`, optional `bodyFormat` markdown or document) to the HTML the public page serves, without saving; a document body the write rules reject answers with the field errors of a save. `WebPreviewRenderer` is exported from `template-resolver/web` and registered as `contentPreviews.web`; `contentPreviews.text` renders document-format entries with the example values filled in (escaped, sanitized), other formats stay plain text. Legal text previews work in apps that mount legal-pages without managed-pages. A text without placeholders shows no example-values section. `ContentField` and its inline Vorschau toggle are removed. New keys `template-resolver.editor.{infoEdit,infoPreview,localeLabel,rail*}` in all locale packages.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: mail and PDF previews register in the preview registry
detail: `documentDesignerClient()` registers `contentPreviews.mail` and `contentPreviews.pdf`; the mail, PDF and layout editors keep their look and mount their preview through `PreviewPane`. Their shell parts are adapters over the renderer's editor shell. Apps that mount the editors through `documentDesignerClient()` need no change; tests that render the editors without `createKumikoApp` wrap them in `ContentPreviewsProvider` with `documentDesignerClient().contentPreviews`.
-->
