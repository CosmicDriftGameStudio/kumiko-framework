---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

A projectionDetail in a drawer gets a pinned footer, disabled and outlined-icon actions, field actions, a second header badge and an opt-in Cancel on drawer forms.

A drawer row action can name `headingFields`: row fields that fill `{name}` placeholders in its title and subtitle without being prefilled or sent.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Detail drawer polish, field actions, disabled actions, secondaryStatus, cancelInDrawer
detail: `RowActionDrawer.headingFields` lists row fields that only fill `{name}` placeholders in title and subtitle, never the form values or payload; a prefill param of the same name wins, a missing value is empty text, boot checks the names against the row. `RowAction.disabled` shows an action but blocks the click while its `FieldCondition` holds. `display: "icon"` with `style: "secondary"` is an outlined icon button. `header.secondaryStatus` renders a second status badge, text and tone resolved like `status` (it shares `statusTones`). `EditFieldSpec.actions` puts buttons beside the value of a projectionDetail fields-section field, also when it is empty; boot rejects them on other screens and validates the actions. A file field with actions shows an outlined Download button. In a drawer only the record content scrolls and the footer writeForm stays pinned; the footer variant shows the fields, then a bordered row of right-aligned buttons. actionForm `cancelInDrawer: true` adds a Cancel button to its drawer that closes with the unsaved-input prompt. An unprocessable error with an untranslated `details.reason` now shows a non-empty `details.message`.
-->

An entityList can drop its automatic Edit action, a relatedList tones rows with a rule list and hides its row actions by parent record, row action buttons can show a pressed state, and a drawer action can show a back arrow.

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityList allowEdit
detail: `EntityListScreenDefinition.allowEdit: false` suppresses the automatically added "Edit" row action; declared `rowActions` are unaffected. Default `true`.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: relatedList rowTone rule list
detail: `EditRelatedListSection.rowTone` also accepts an array of rules; the first matching rule decides the row tone. `fill: true` on a rule adds a light background in the tone color (`DataTableProps.rowFill`, table rows and cards; pinned cells carry the tint too) next to the left stripe. Boot checks the fields of every rule against the section's row query.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Row action active state
detail: `active: { when, style? }` on writeHandler and drawer row actions draws an inline button (display button or icon) pressed while the row matches `when`: `aria-pressed="true"`, accent tint, or with `style: "danger"` filled destructive. A pressed and disabled button keeps its full colour but stays unclickable. `aria-pressed` only exists when `active` is declared. Boot checks the `when` field against the row fields.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: relatedList rowActionsWhen
detail: `EditRelatedListSection.rowActionsWhen` is a condition on the parent record, like `visibleWhen`. While it does not match, the list draws no row-action column, no bulk actions and no inline cell editing. Boot checks the field against the detail query's outputSchema.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Drawer row action back arrow
detail: `RowActionDrawer.back: true` shows a back arrow left of the drawer title instead of the close cross on the right; it closes only this drawer and returns to the one underneath. With `width: "wide"` the stacked drawer covers a wide detail drawer completely. `DrawerProps.back` is the matching primitive prop. Field labels in forms and detail views no longer clip descenders.
-->

A projectionDetail writeForm file field uploads through a host entity, a stale action error banner clears, and a danger footer action is outlined.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail writeForm file upload via uploadEntity, action error banner, outlined danger footer action
detail: A file, image, files or images field in a projectionDetail writeForm section (tab section or footer) now needs `uploadEntity`: the entity whose file field of the same name the upload is stored as (`entityType` + `fieldName`, no record id), so a write handler that saves the file through that entity's executor (`executor.update({ id, version, changes: { attachment } })`) binds it and other record readers can download it. Boot rejects a form file field without `uploadEntity`, an unknown entity, and an entity without a file field of that name (`projection-detail/write-form-upload-entity-invalid`). Such a field always failed with 400 `unresolvable_field` before, so no working screen breaks. The detail's action error banner clears on the next successful write of that detail (footer or header action, related-list row action, inline cell edit). A footer action with `style: "danger"` is an outlined button with destructive text; its confirm rule is unchanged.
-->

A projectionDetail opened from a list row can fill a large popup, edit in place and show its file field as a box.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Popup drawer, flat detail header, in-place edit, file box, fill tint
detail: `RowActionDrawer.width` and `ToolbarAction` drawer width take `"popup"`: the panel keeps 24px to every window edge, fills the rest (no 85vw cap), is rounded with the card colour; `"wide"` and the phone full screen stay. A drawer that hosts a projectionDetail with a `header` (and no `slots.header`) has no title bar: the detail shows its title, badges, subtitle and metrics as one flat block without a card (metrics left-aligned under the title), the tab strip below it with a full-width underline, header actions on the right next to the close cross, the tab content scrolls with 24px padding; summary, guidance, breadcrumb and the action error banner stay. The action error banner now also shows when the header has no card. The full page is unchanged. A drawer row or header action with `back: true` inside such a detail shows its form in place of the tab content (back button with outlined chevron, title and subtitle beside it, Cancel and Submit pinned below, fields side by side) instead of a second drawer; the tabs and the footer form stay mounted, so an unsent footer note survives. Back, Cancel, Escape and a tab click ask the same "discard unsaved input?" question when the form has input; Escape closes only the form, the cross closes the popup (with that question when the form is dirty); focus moves to the back button and returns to the trigger. Outside such a detail `back` still opens a drawer. The pinned footer form has 24px padding and the card colour in a drawer, no separator above its field row, and its buttons show an icon only when the action declares one (an id-derived icon, e.g. a chevron, no longer appears). A file field with field actions and a file shows as a bordered box (file icon, bold name, outlined Download and the actions on the right, wrapping on phones); without a file it shows a dash beside the action. A row tone rule with `fill: true` tints the row 4 % of the tone into the card colour and draws no stripe; a native select in a bad or critical filled row takes the tone as border, text and light background; the row hover colour now also covers the sticky actions cell.
-->

Typed footer input of a projectionDetail survives a tab switch and travels with a footer drawer action.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Footer drawer action carries the footer input, tab switch keeps it, icon optional on footer and field actions
detail: A `kind: "drawer"` action of the detail's footer writeForm opens with the current footer input on top of its own prefill values, asks no "discard unsaved input?" question for that input, and after its submit the footer form takes the reloaded record as its new base. Switching tabs no longer asks that question for unsent footer input, because the footer form stays mounted; leaving the record and an in-place edit form still ask. Boot no longer requires an `icon` on footer and field actions, they render as labelled buttons. A default form inside a popup detail sits flush in the drawer body instead of adding its own card padding. Boot applies the footer rules to drawer actions too (`projection-detail/footer-write-form-invalid`): the id must differ from the screen's actions, `params` keys must not equal a footer field, and the target actionForm needs no `load`, must list every footer field in its layout (`visible: false` is enough) and must not mark one sensitive or password, since the submit stands for sending the footer input. A bad field reference in a field action now names the field and the action.
-->
