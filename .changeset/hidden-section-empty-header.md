---
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

An `entityEdit` section whose fields are all hidden by a field-level `visible` condition no longer renders its empty box (title + divider with nothing inside). `EditFieldsSectionViewModel` gained a `visible` field computed from its fields' visibility; the section stays in the view-model array (so titleless sibling sections keep stable React keys), the renderer just skips drawing it. `hasEditableSection` now also respects section-level `visible`, so a form whose only editable section is fully hidden no longer shows a Save button over zero visible fields.
