---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Event-store and PII review fixes: abandoned step dispatches are closed, legacy billing headers are scrubbed, subject forgets can follow a delete safely, helpdesk keeps the contact settings.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: A sweeper closes dispatch streams that never got an outcome
detail: The hourly job `step-dispatcher:job:sweep-abandoned` finds `step-dispatch` streams older than 24 hours that have neither a dispatched nor a failed event (a lost deliver job, a worker that died after the request was written), appends `step-dispatch.failed` with the error `dispatch abandoned without a recorded outcome` and erases the stream's PII key, so the personal data of a request nobody delivers no longer stays readable forever. A stream that already has an outcome only gets its key erased. A late deliver job for a swept stream sends nothing. The job declares an `escapeHatch` for the cross-tenant read of open streams. Framework: `selectOpenStreamsStartedBefore` (event-store) lists open streams of one aggregate type across tenants.
-->

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: The legacy rawPayload header is removed from subscription and invoice events at boot
detail: Earlier billing events carried the provider webhook body in the event header `rawPayload`, outside the PII-encrypted payload. The new boot job `billing-foundation:job:scrub-raw-payload-headers` (`runOnBoot`, idempotent) removes that header from the subscription created/updated/canceled and invoice paid/payment-failed events via `scrubEventHeaderKeys`; events without it are untouched and a second run changes nothing. The job declares an `escapeHatch` because the scrub spans every tenant. Framework: `scrubEventHeaderKeys` accepts any `DbRunner`.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: scrubEventPayloadFields needs a maintenance window
detail: The JSDoc of `scrubEventPayloadFields` now states that it pages by bigserial id and that ids are handed out before commit, so an event appended in parallel with a lower id than the current cursor can be skipped. Run it in a maintenance window without running writes on the affected event types, or repeat the scrub afterwards; the header scrub (`scrubEventHeaderKeys`) is not affected because it is one statement.
-->

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: subjectForgetAfterDeleteHook erases a deleted row's subjects only after the delete is accepted
detail: `subjectForgetAfterDeleteHook({ target, subjectsOf, reason })` returns a `postDelete` hook (in the delete's transaction) that runs `crypto-shredding:write:forget-subject` as the system identity for the subjects of the row just deleted, in the tenant of the deleted row's event. Because preDelete hooks run after the delete handler returns and a key erase cannot be rolled back, forgetting inside the delete handler erased the key even when a preDelete hook then rejected the delete; the hook runs after all of them, and a failed forget throws and rolls the delete back. Register it with `r.hook(subjectForgetAfterDeleteHook({ target: { allOf: entity }, ... }))`; it declares the narrow `systemIdentity` grant itself.
-->

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-subject called from another write handler no longer blocks on the caller's stream
detail: The audit event and the user login-door close of `forget-subject` were written on the outside-transaction connection with the subject id as aggregate id. When the caller's transaction had already written an event for that id (a delete of the very row), the outside append waited for the uncommitted version and the request hung. Called from another write handler, `forget-subject` now writes both inside the caller's transaction; direct calls (HTTP, agents) are unchanged.
-->

<!-- kumiko-changes
feature: helpdesk
type: fix
title: Notification preferences and config values of the former contact feature are carried over
detail: The helpdesk notifications declare `renamedFrom: ["contact:notify:<name>"]`, so stored preferences and address opt-outs under the former names keep applying (a helpdesk-name row wins). The boot job `helpdesk:job:legacy-contact-config` (`runOnBoot`, idempotent) writes `contact:config:reply-to` and `contact:config:telegram-chat` to `helpdesk:config:reply-to` and `helpdesk:config:telegram-chat` through `config:write:set` as SystemAdmin, only when the helpdesk key has no value yet; the old rows stay untouched. The job declares an `escapeHatch` (crossTenantReads, systemIdentity). This replaces the "not carried over" hint of the 0.413.0 migration note for these settings.
-->
