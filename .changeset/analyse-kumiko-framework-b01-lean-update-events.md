---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

Update events store only the old values of the changed keys, and the executor writes many rows with one append.

<!-- kumiko-changes
feature: event-store
type: breaking
title: Lean update events and executor createMany/updateMany
detail: The `<entity>.updated` event now carries `previous` with the old values of exactly the keys in `changes` (owner-transition rekeys included) instead of the whole pre-update row. Delete, restore and forget still carry the whole row, and the update WriteResult still returns the whole previous row. The search index reads the live row on update, the access invalidation of `tenant-membership.updated` reads the user id from the changes or the membership row, and the derived webhook contract of `updated` no longer has `id` inside `previous`. `EventStoreExecutor` has `createMany` and `updateMany`: every row runs the checks of create and update, all events go into the log with one statement and one optimistic check per stream, and the batch commits or fails as a whole. Append and projection of a single create or update share one savepoint. `createAccessInvalidationEventConsumer` takes the registry as second argument. A forgotten file reference now lowers the tenant storage usage.
migration: Code that reads `payload.previous` of an `updated` event for a key the event did not change reads the projection row instead. Webhook receivers of `<entity>.updated` take the id from the top level. Hand-built `EventStoreExecutor` objects add `createMany` and `updateMany`. A loop of `executor.create` or `executor.update` over many rows in one handler can switch to `createMany` or `updateMany`.
affects: payload.previous, payload["previous"], createAccessInvalidationEventConsumer, EventStoreExecutor
-->
