---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

An entityList, a projectionDetail or a relatedList section can mount a page help in the page header: `pageHelp: { statusField }` (plus `entity` on a projectionDetail; on a relatedList section the button sits next to the title and `entity` defaults to the section entity) adds a "Statuses explained" button that opens a dialog with the badge and a sentence for every option of that select field. `entity` may be `<feature>:<entity>` to explain a status of another feature, whose translations are then used. The sentences are the i18n keys `<option label key>:help`; the boot rules `page-help/status-field-invalid` and `page-help/option-help-missing` check the field and the texts in every locale of the option labels. `Dialog` takes `hideCancel`, and the icon key `help-circle` joins the icon vocabulary.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Status help in the page header
detail: Set `pageHelp: { statusField: "status" }` on an entityList or a relatedList section (or `{ entity, statusField }` on a projectionDetail) and the page header gets a "Statuses explained" button. Its dialog shows each option of the select field with the same badge as the list and a sentence from the i18n key `<option label key>:help`. Boot fails when the field is not a select field or an option has no help text in a locale its label has. New `Dialog.hideCancel` and icon key `help-circle`.
-->
