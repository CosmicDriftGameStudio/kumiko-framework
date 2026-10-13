---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

An entity can declare `lockedWhen: FieldCondition`, for example `lockedWhen: { field: "status", eq: "closed" }`. The event-store executor refuses `update` and `delete` on a stored row whose state meets the condition, so generic CRUD, custom handlers (whatever they return), nested `ctx.write` and jobs running as a regular user are all covered. The write answers 409 `record_locked` (`errors.recordLocked`) and the transaction rolls back, so no event is written. The check reads the state before the write, so the write that sets the lock still passes. A row that lacks the condition field counts as locked. The check runs after the entity and field ownership checks and before the event append, so a caller without write rights sees `ownership_denied`, not 409. `forget` (Art. 17) never checks the lock. A write by the framework system user skips it only when the executor call names a `writePurpose` (`WritePurposes.retention` or `WritePurposes.erasure`, exported from `@cosmicdrift/kumiko-framework/db`); retention cleanup, the user-data erasure hooks and tenant destroy set it, so statutory deletion and anonymisation reach locked rows. A system-user write without a purpose is rejected like any other. A server-code call site that must change a locked row on purpose passes `{ unsafeSkipLockGuard: true }` as an executor option; neither it nor `writePurpose` is ever read from a request payload. Boot rejects a condition on an unknown field, on a `personal` or `encrypted` field, and on any type other than text, longText, select, boolean, number or reference. An `entityEdit` screen without its own `readOnly` shows a locked record as a read-only view, so the condition is declared once; a record that lacks the lock field (for example no read right on it) is always shown as a view, like the server treats it; `screen.readOnly` adds a UI-only condition on top; either one shows the view. A parent delete with `onDelete: cascade` or `setNull` answers 409 for the parent when a child row is locked, instead of removing or detaching it with the parent; this check runs in the dispatch delete lifecycle, so a write handler that returns the result of a parent `forget` is held back by a locked cascade child too. Remaining limits: `restore` is not guarded (it brings back unchanged data), and a custom projection that reacts to a domain event from `ctx.appendEvent` can still change a locked row, because that bypasses the executor. An app-written erasure hook should use `forget`; one that deletes or anonymises a locked row with `delete` or `update` needs `writePurpose: WritePurposes.erasure` as the system user, or `unsafeSkipLockGuard` as a regular user.

<!-- kumiko-changes
feature: types
type: improvement
title: EntityDefinition.lockedWhen and the executor options unsafeSkipLockGuard and writePurpose
detail: lockedWhen is a FieldCondition evaluated against the stored row. update and delete on the EventStoreExecutor take unsafeSkipLockGuard to opt one call out, and writePurpose (WritePurposes.retention or erasure) lets the framework system user through. EntityEditScreenDefinition.readOnly is combined with the entity's lockedWhen (either shows the view).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Locked records reject executor writes
detail: The event-store executor checks entity.lockedWhen against the loaded row in update and delete and fails with RecordLockedError (409, code record_locked, i18n key errors.recordLocked); a missing condition field counts as locked. Create, restore, forget, framework-system-user writes that name a writePurpose and the write that sets the lock pass. validateBoot rejects a lockedWhen field that is unknown, personal, encrypted or not a plain scalar type.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityEdit shows locked records as a view
detail: EntityEditUpdateForm shows the view when screen.readOnly matches or entity.lockedWhen matches or its field is missing from the record. Adds the default string errors.recordLocked.
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
