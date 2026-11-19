---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Forms save through their one Save button. A note typed into the notes section of an edit form is written with the form's Save. Resetting a config value to its inherited value marks the field and saves with the form. A failed footer action no longer leaves its values in the form. The layout editor blocks publishing and applying while the layout has unsaved changes. Actions on a projection detail ask before they discard input typed into a write form.

<!-- kumiko-changes
feature: renderer
type: fix
title: Forms save through their one Save button
detail: The notes section inside an edit form has no own add button any more; a typed note counts as unsaved input and is written by the form's Save (addNote), a standalone notes section keeps its button. On a config edit screen "Reset" sets the field to the inherited value and the reset is written with Save (config:write:reset), typing after a reset writes the typed value instead; a reset to a value equal to the current override changes nothing visible and is not saved. A footer action with a patch (for example "Save as urgent") sends its patch with this one submit only; when the write fails the patch is not kept in the form, so the next Save does not send it. The layout editor disables "Publish drafts" and "Apply to templates" while the layout has unsaved changes and says to save first (key documentDesigner.usedBy.saveFirst, de, es, fr, it translated). On a projection detail, an action that does not submit a write form asks "You have unsaved changes in this form…" while a write form section holds typed input, as entityEdit does; the action named in submitWith sends the input without the question. Nothing to do for apps.
-->
