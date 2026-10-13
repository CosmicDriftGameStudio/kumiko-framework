---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

An entity can declare `lockedWhen: FieldCondition`, for example `lockedWhen: { field: "status", eq: "closed" }`. The event-store executor refuses `update` and `delete` on a stored row whose state meets the condition, so generic CRUD, custom handlers (whatever they return), nested `ctx.write` and jobs running as a regular user are all covered. The write answers 409 `record_locked` (`errors.recordLocked`) and the transaction rolls back, so no event is written. The check reads the state before the write, so the write that sets the lock still passes. A row that lacks the condition field counts as locked. The check runs after the entity and field ownership checks and before the event append, so a caller without write rights sees `ownership_denied`, not 409. `forget` (Art. 17) never checks the lock, and writes by the framework system user (retention cleanup, erasure jobs) skip it, so statutory deletion and anonymisation reach locked rows without any flag. A server-code call site that must change a locked row on purpose passes `{ unsafeSkipLockGuard: true }` as an executor option; it is never read from a request payload. Boot rejects a condition on an unknown field, on a `personal` or `encrypted` field, and on any type other than text, longText, select, boolean, number or reference. An `entityEdit` screen without its own `readOnly` shows a locked record as a read-only view, so the condition is declared once; `screen.readOnly` adds a UI-only condition on top; either one shows the view. A parent delete with `onDelete: cascade` or `setNull` answers 409 for the parent when a child row is locked, instead of removing or detaching it with the parent; this check runs in the dispatch delete lifecycle, so a write handler that returns the result of a parent `forget` is held back by a locked cascade child too. Remaining limits: any write as the framework system user is not guarded; `restore` is not guarded (it brings back unchanged data), and a custom projection that reacts to a domain event from `ctx.appendEvent` can still change a locked row, because that bypasses the executor. An app-written erasure hook should use `forget`; one that deletes or anonymises a locked row with `delete` or `update` as a regular user still needs the option.

<!-- kumiko-changes
feature: types
type: improvement
title: EntityDefinition.lockedWhen and the executor option unsafeSkipLockGuard
detail: lockedWhen is a FieldCondition evaluated against the stored row. update and delete on the EventStoreExecutor take unsafeSkipLockGuard to opt one call out. EntityEditScreenDefinition.readOnly is combined with the entity's lockedWhen (either shows the view).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Locked records reject executor writes
detail: The event-store executor checks entity.lockedWhen against the loaded row in update and delete and fails with RecordLockedError (409, code record_locked, i18n key errors.recordLocked); a missing condition field counts as locked. Create, restore, forget, framework-system-user writes and the write that sets the lock pass. validateBoot rejects a lockedWhen field that is unknown, personal, encrypted or not a plain scalar type.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityEdit shows locked records as a view
detail: EntityEditUpdateForm shows the view when screen.readOnly or entity.lockedWhen matches. Adds the default string errors.recordLocked.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: German string for locked records
detail: Adds errors.recordLocked.
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: Spanish string for locked records
detail: Adds errors.recordLocked.
-->
