---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

An entity can declare `lockedWhen: FieldCondition`, for example `lockedWhen: { field: "status", eq: "closed" }`. A stored row whose state meets the condition can no longer be changed or deleted by any write handler of the entity: generic create/update/delete, custom handlers that return a save or delete result, and nested `ctx.write` calls. The write answers 409 `record_locked` (`errors.recordLocked`) and the transaction rolls back, so no event is written. The check reads the state before the write, so the write that sets the lock still passes. A handler that unlocks on purpose sets `unsafeSkipLockGuard: true` (`defineWriteHandler` form). Boot rejects a condition on an unknown field and on a `personal` or `encrypted` field. An `entityEdit` screen without its own `readOnly` shows a locked record as a read-only view, so the condition is declared once; `screen.readOnly` adds a UI-only condition on top; either one shows the view. Handlers that write through `ctx.appendEvent` or a bare executor without returning a save or delete result are not seen by the guard.

<!-- kumiko-changes
feature: types
type: improvement
title: EntityDefinition.lockedWhen and WriteHandlerDef.unsafeSkipLockGuard
detail: lockedWhen is a FieldCondition evaluated against the stored row. unsafeSkipLockGuard opts a write handler out. EntityEditScreenDefinition.readOnly is combined with the entity's lockedWhen (either shows the view).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Locked records reject every write handler
detail: dispatch-write checks entity.lockedWhen against SaveContext.previous (updates) and DeleteContext.data (deletes) after the handler and before projections, and throws RecordLockedError (409, code record_locked, i18n key errors.recordLocked). The transaction rolls back with the event. Create and the write that sets the lock pass. validateBoot rejects a lockedWhen field that is unknown, personal or encrypted.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityEdit shows locked records as a view
detail: EntityEditUpdateForm shows the view when screen.readOnly or entity.lockedWhen matches. Adds the default string errors.recordLocked and removes the unused kumiko.field.file-upload.attached.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German string for locked records
detail: Adds errors.recordLocked. Removes the unused kumiko.field.file-upload.attached.
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: Spanish string for locked records
detail: Adds errors.recordLocked. Removes the unused kumiko.field.file-upload.attached.
-->
