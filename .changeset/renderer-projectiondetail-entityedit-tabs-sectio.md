---
"@cosmicdrift/kumiko-renderer": minor
---

projectionDetail/entityEdit-tabs sections render through one Card frame, get section-level actions and a relatedList emptyState (fw#3234)

Every section kind in a tabs-mode layout (fields, extension, relatedList, writeForm) now renders inside exactly one card — extension and writeForm sections previously fell back to a borderless divider there because Section always flattens when rendered inside RenderEdit's own <Form>, so their content (and, for writeForm, its submit button) had no card chrome. EditFieldsSection, EditExtensionSection, EditRelatedListSection and EditWriteFormSection all gain an optional `actions?: readonly RowAction[]`, rendered as buttons in that section's own title row (never a footer). EditRelatedListSection also gains an optional `emptyState?: { title, description?, action? }`, forwarded to the related list's DataTable when it has zero rows. RenderEdit gains a `buildSectionActions` prop the caller uses to resolve a section's RowAction[] against the record being viewed/edited — kumiko-screen.tsx wires this via a new shared `buildRecordActions` helper (row-actions.ts), replacing what used to be two separately maintained header-actions builders.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail/entityEdit-tabs sections render through one Card frame, get section-level actions and a relatedList emptyState (fw#3234)
migration: |
  Additive: existing screens are unaffected. A projectionDetail/entityEdit-tabs screen with an extension or writeForm section previously relying on the flattened (no card) look in tabs mode now sees that section framed like every other section kind.
-->
