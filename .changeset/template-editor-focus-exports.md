---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

The template overview query filters by slug, and the document-designer web barrel exports the template title helpers and the editor screen ids, so an app can name the template open in an editor without copying the framework's logic.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Overview query filters by slug
detail: `template-resolver:query:overview` accepts `slug` as a filter field next to kindGroup, kind, origin and status, so a client can fetch the one row of an open template instead of paging through its kind.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Template title helpers and editor screen ids exported
detail: `@cosmicdrift/kumiko-document-designer/web` exports `templateTitle`, `templateTitleText`, `DOCUMENT_DESIGNER_FEATURE`, `MAIL_EDITOR_SCREEN_ID`, `PDF_TEMPLATE_EDITOR_SCREEN_ID`, `TEMPLATE_EDITOR_SCREENS` and the type `TemplateEditorKind`. An app that reads the `slug` search parameter of an editor route can resolve the shown title the same way the overview does.
-->
