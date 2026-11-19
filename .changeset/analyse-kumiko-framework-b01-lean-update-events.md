---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

Update events store only the old values of the changed keys, delete and forget events only plaintext columns, and the executor writes many rows with one append.

<!-- kumiko-changes
feature: framework
type: breaking
title: Lean update, delete and forget events and executor createMany/updateMany
detail: The `<entity>.updated` event now carries `previous` with the old values of exactly the keys in `changes` (owner-transition rekeys included) instead of the whole pre-update row. `<entity>.deleted` and `<entity>.forgotten` carry `previous` without personal, encrypted and sensitive fields, in plaintext and without a KMS call, so the erasure event no longer holds a copy of the erased values and a delete without a KMS no longer writes personal fields in plaintext to the log. A delete of a row whose subject key is already erased now succeeds without an erasure purpose; restoring that row stays refused. Restore still carries the whole row, and the update and delete WriteResults still return the whole row. The search index reads the live row on update, the access invalidation of `tenant-membership.updated` reads the user id from the changes or the membership row, and the derived webhook contract of `updated` no longer has `id` inside `previous`; the `deleted` webhook no longer passes tenant-key ciphertext of non-personal tenant-owned fields. `EventStoreExecutor` has `createMany` and `updateMany`: every row runs the checks of create and update, all events go into the log with one statement and one optimistic check per stream, and the batch commits or fails as a whole. Append and projection of a single create or update share one savepoint. `createAccessInvalidationEventConsumer` takes the registry as second argument. A forgotten file reference now lowers the tenant storage usage.
migration: Code that reads `payload.previous` of an `updated` event for a key the event did not change reads the projection row instead. Code that reads a personal, encrypted or sensitive field from `payload.previous` of a `deleted` or `forgotten` event reads it from the `created` and `updated` events or the projection row before the delete; events written before this release still carry the whole row. Webhook receivers of `<entity>.updated` take the id from the top level. Hand-built `EventStoreExecutor` objects add `createMany` and `updateMany`. A loop of `executor.create` or `executor.update` over many rows in one handler can switch to `createMany` or `updateMany`.
affects: payload.previous, payload["previous"], createAccessInvalidationEventConsumer, EventStoreExecutor
-->
