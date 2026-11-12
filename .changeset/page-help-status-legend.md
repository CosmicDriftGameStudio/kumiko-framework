---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

An entityList or a projectionDetail can mount a general page help: `pageHelp: { sections }`, each section either `{ kind: "status", field, entity? }` (explains every option of a select field with its badge and the sentence from the i18n key `<option label key>:help`; `entity` is bare or `<feature>:<entity>`) or `{ kind: "text", title, text }` (i18n keys). A button labelled "Explanations" (key `kumiko.pageHelp.buttonLabel`, soft primary tint, icon only below `sm`) in the shell header, left of the assistant button, opens a drawer with one card per section; a status card is headed with its optional `title` key, else the tab title of a relatedList section, else the screen title. relatedList sections take `pageHelp` too but render no button: their sections join the help of the projectionDetail around them, after its own, so a page with several tabs gets one help. The boot rules `page-help/status-field-invalid` and `page-help/option-help-missing` check every status section, and `page-help/unsupported-site` rejects pageHelp on a relatedList of an entityEdit, where nothing shows it; text keys join the required surface keys. `PageHeader` takes a `help` node that sits at the end of the header actions. `Button` takes `collapseLabel` (icon only below `sm`, the label stays the accessible name), a `legend` `Grid` takes `ruled` (fixed term column and hairlines between rows), `Dialog` takes `hideCancel`, and the icon key `help-circle` joins the icon vocabulary.

<!-- kumiko-changes
feature: renderer
type: improvement
title: General page help
detail: Set `pageHelp: { sections: [{ kind: "status", field: "status" }] }` on an entityList or a projectionDetail (with `entity` on the detail) and the page gets an "Explanations" button in the shell header. Its drawer shows each option of the select field with the same badge as the list and a sentence from the i18n key `<option label key>:help`; `{ kind: "text", title, text }` adds free text. relatedList sections contribute their sections to the page's help instead of rendering a button. Boot fails when a status field is not a select field or an option has no help text in a locale its label has. New `PageHeader.help`, `Dialog.hideCancel` and icon key `help-circle`.
-->
