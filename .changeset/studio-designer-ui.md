---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Opt-in renderer variants and two projection fixes; today's look is the default everywhere.

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail renders no empty header band
detail: A projectionDetail whose `header.subtitle` field is empty and that has no metrics no longer renders an empty subtitle row or an empty metrics band (extra padding and height). Applies to all apps.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Qualified listScreenId and navigate targets survive role projection
detail: `projectAppSchemaForRoles` looked up `listScreenId` and navigate `screen` by the raw value, so a `<feature>:screen:<id>` reference never matched and the breadcrumb parent was dropped. Both now resolve through `screenShortId` (the original value stays in the projected schema), as does the boot check of `listScreenId`. Applies to all apps.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Heading variant "group"
detail: `Heading variant="group"` renders a 16px semibold sub-title in the foreground color, normal case. The default `page` is unchanged.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: DetailList valueWeight and sidebar layout
detail: `DetailList valueWeight="normal"` drops the value emphasis (default `"medium"`). `layout="sidebar"` puts a narrow label column and the right-aligned value on one row for side columns (default `"default"`).
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: TextareaField placeholder, Composer widget
detail: `TextareaField` takes a `placeholder`. New `Composer` chat input: label-less textarea with the send button inside the field frame, bottom right, docked to the bottom of its column. Props `value`, `onChange`, `onSubmit`, `placeholder`, `disabled`, `submitLabel` (aria label of the send button), `rows`.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: ModeSwitch option disabled and tone
detail: A `ModeSwitch` option can be `disabled` (not selectable, `aria-disabled`, muted) and carry `tone: "warning"` (warning frame) to flag an open question.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Banner icon and structured parts
detail: `Banner` takes an optional leading `icon` (a nav icon key such as `"alert-triangle"`) and `parts: [{ text, strong? }]` rendered after `children`; `children` is now optional. No markup strings.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: List table option compactHeader
detail: `table: { compactHeader: true }` on an entityList, projectionList or relatedList renders the header row in 12px semibold. Wired through the boot validator, `useListTable` and `DataTable` (`compactHeader` prop). Default unchanged.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Edit layout hideRequiredMarker
detail: `layout: { hideRequiredMarker: true }` on an entityEdit, actionForm or projectionDetail hides the asterisk after required field labels. Default shown.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: projectionDetail header actions per tab
detail: A projectionDetail header action takes `showOnTabs: ["<tab id>"]` and is shown only while one of those tabs is active (needs `layout.mode: "tabs"`). The boot validator rejects empty lists, unknown tab ids and a missing tabs mode.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: SectionNavLayout widget
detail: `SectionNavLayout` wraps custom or extension sections in a column with the "On this page" list (`FormSectionNav`). Props `items`, `children`, `width`, `testId`. Stacked forms already render the list themselves.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Wizard step rail texts and up-next card
detail: Wizard steps in the rail show the section `subtitle`, else its `description`; a completed step shows the value of the new optional `summaryField`. `wizard.aside.finishDescription` adds a finish card with description on the last step. The up-next card shows the next step's `subtitle` or `description`.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Wizard intro follows the current step
detail: The intro text beside the wizard rail now follows the description of the current step and falls back to `formSubtitle`; the description is no longer printed a second time above the fields. Applies to every app that uses a wizard with a step rail.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Wizard footer options
detail: `layout.wizard.saveAndCloseOnCreate` shows "Save and close" in create mode. `layout.wizard.submitDisabledWhen` is a field condition that disables the submit buttons and blocks the submit. After a create, extension sections are saved with the id of the new entity. The boot validator rejects these options outside wizard mode and unknown fields.
-->
