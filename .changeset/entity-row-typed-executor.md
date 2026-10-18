---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`executor.detail()` and `executor.list()` return the entity's row type

`createEntityExecutor(name, entity)` and `createEventStoreExecutor(table, entity, options)` now return `EventStoreExecutor<EntityRow<E>>`. `detail` resolves to `EntityRow<E> | null` and `list` to `CursorResult<EntityRow<E>>`, so `row.title` needs no cast or schema parse. `EntityRow<E>` is exported from `@cosmicdrift/kumiko-framework/db` and follows what the executor returns at runtime: money is one `{ amount, currency, amountScaled, amountMinor }` key, a located timestamp one `{ at, tz, utc }` key, `date` is a `Temporal.PlainDate`, `timestamp` and `insertedAt` are `Temporal.Instant`, soft-delete keys are required only when `softDelete` is the literal `true`, and bigInt and jsonb stay `unknown`. A wide `fields` map falls back to `Record<string, unknown>`. Create and update payloads stay untyped, and a typed executor is still assignable to the untyped `EventStoreExecutor`.

`createBooleanField` is now typed as non-null (`default: boolean`), matching what it stores.

Breaking: a `row as T` cast whose target the row type no longer overlaps becomes a compile error, and casts that still compile but are now redundant can go. Run the codemod first, then fix what it lists as manual.

<!-- kumiko-changes
feature: framework
type: breaking
title: executor.detail() and executor.list() return EntityRow<E>, derived from the entity definition
detail: Rows of createEntityExecutor / createEventStoreExecutor are typed per entity; wide entities keep Record<string, unknown>. createBooleanField is typed non-null. UserMfaRow in the bundled auth-mfa feature now declares enabledAt and lastUsedAt as Temporal.Instant, which is what the row always held.
migration: Remove the `row as T` casts on executor.detail() / executor.list() results with `bun kumiko-upgrade --apply` (codemod remove-engine-payload-casts). Casts to a type the row does not satisfy stay and are listed as manual; replace them with a field-level check or a narrower type.
codemod: scripts/codemod/remove-engine-payload-casts.ts
manualAfterCodemod: true
-->
