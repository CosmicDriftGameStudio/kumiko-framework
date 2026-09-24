---
"@cosmicdrift/kumiko-types": minor
---

EditFieldsSection/EditExtensionSection/EditRelatedListSection/EditWriteFormSection gain actions; EditRelatedListSection gains emptyState; number fields gain grouping (fw#3234)

All four Edit*Section spec types accept an optional `actions?: readonly RowAction[]`, resolved and rendered in that section's own title row. EditRelatedListSection additionally accepts `emptyState?: { title, description?, action? }` for its zero-rows state. A number field spec accepts `grouping?: boolean` (default true) — false renders without thousands separators. Every projectionDetail/entityEdit-tabs screen/section/emptyState action must resolve an icon (declared `icon`, or the framework's id-derived default via resolveActionIcon) — checked by the boot validator (see @cosmicdrift/kumiko-framework's changes.json).

<!-- kumiko-changes
feature: types
type: improvement
title: EditFieldsSection/EditExtensionSection/EditRelatedListSection/EditWriteFormSection gain actions; EditRelatedListSection gains emptyState; number fields gain grouping (fw#3234)
migration: |
  Additive — every field is optional. An existing screen/section/emptyState action on a projectionDetail (or entityEdit's section-level actions) whose id resolves no icon and declares none itself now fails boot; give it an explicit `icon` or an id the shared action-icon map already resolves.
-->
