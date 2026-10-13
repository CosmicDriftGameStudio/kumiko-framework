---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

An `entityEdit` screen can show an existing record as a read-only view. `readOnly: { field: "acknowledged", eq: true }` (any `FieldCondition`) is evaluated against the loaded record only and never applies to the create form. While it holds, every field including file upload and embedded-list row actions is disabled, and the screen has no save, discard or delete button and no unsaved-changes footer; record actions and cancel stay. The title resolves `screen:<id>.view.title` first and falls back to `screen:<id>.title`. This is UI only: write protection still comes from access rules and handlers on the server.

<!-- kumiko-changes
feature: types
type: improvement
title: entityEdit screens accept a readOnly condition
detail: EntityEditScreenDefinition.readOnly is a FieldCondition evaluated against the loaded record. UI only, the server is not affected.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot check for the entityEdit readOnly condition
detail: validateBoot rejects a screen readOnly condition whose field is not a field of the screen's entity.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Read-only view mode for entityEdit
detail: RenderEdit takes viewMode, which disables all fields and removes submit, discard, delete and the dirty footer while keeping record actions and cancel. The update body sets it when screen.readOnly holds for the record and resolves screen:<id>.view.title before screen:<id>.title.
-->
