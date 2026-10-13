---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

An entity can declare `lockedWhen: FieldCondition`, for example `lockedWhen: { field: "status", eq: "closed" }`. The event-store executor refuses `update`, `delete` and `forget` on a stored row whose state meets the condition, so generic CRUD, custom handlers (whatever they return), nested `ctx.write`, jobs and system writes are all covered. The write answers 409 `record_locked` (`errors.recordLocked`) and the transaction rolls back, so no event is written. The check reads the state before the write, so the write that sets the lock still passes. A row that lacks the condition field counts as locked. A call site that must change a locked row on purpose passes `{ unsafeSkipLockGuard: true }` as an executor option; data-retention cleanup does this, so retention deletion and anonymisation still reach locked rows. Boot rejects a condition on an unknown field, on a `personal` or `encrypted` field, and on any type other than text, longText, select, boolean, number or reference. An `entityEdit` screen without its own `readOnly` shows a locked record as a read-only view, so the condition is declared once; `screen.readOnly` adds a UI-only condition on top; either one shows the view. A cascading parent delete (`onDelete: cascade`) answers 409 when a child row is locked, instead of removing it with the parent. Remaining limits: `restore` is not guarded (it brings back unchanged data), and a custom projection that reacts to a domain event from `ctx.appendEvent` can still change a locked row, because that bypasses the executor. App-written erasure hooks for entities with `lockedWhen` must pass the option too.

<!-- kumiko-changes
feature: types
type: improvement
title: EntityDefinition.lockedWhen and the executor option unsafeSkipLockGuard
detail: lockedWhen is a FieldCondition evaluated against the stored row. update, delete and forget on the EventStoreExecutor take unsafeSkipLockGuard to opt one call out. EntityEditScreenDefinition.readOnly is combined with the entity's lockedWhen (either shows the view).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Locked records reject executor writes
detail: The event-store executor checks entity.lockedWhen against the loaded row in update, delete and forget and fails with RecordLockedError (409, code record_locked, i18n key errors.recordLocked); a missing condition field counts as locked. Create, restore and the write that sets the lock pass; data-retention cleanup opts out per call. validateBoot rejects a lockedWhen field that is unknown, personal, encrypted or not a plain scalar type.
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
