---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

Entities declare named update verbs, and the executor reads an entity's history and its rows as of an instant.

<!-- kumiko-changes
feature: framework
type: breaking
title: Named entity verbs, executor history and listAsOf
detail: An entity declares named update events in `verbs`, optionally with a transition (`{ archived: { transition: { field: "status", from: ["open"], to: "archived" } } }`). `executor.update(payload, user, db, { verb })` appends `<entity>.<verb>` with the `{ changes, previous }` payload of `updated`; a verb with a transition sets its field and fails with `invalid_transition` (422) when the current state is not in `from`. The implicit projection, rebuild, entity upcasters, job triggers, projection apply keys, derived webhook contracts and the audit filter treat a declared verb like `updated`. Boot rejects lifecycle names, names with dots, transitions on non-select fields, unknown options and pairs that `entity.transitions` does not allow. `EventStoreExecutor` has `history({ id })`, which returns the lifecycle and verb events of one entity as `{ version, at, by, verb, changes }`, upcast and decrypted, without fields the caller may not read, and `listAsOf({ asOf })`, which folds the entity's events up to an instant into rows and refuses entities with parentRef, readGate or a row read ownership.
migration: Hand-built `EventStoreExecutor` objects add `history` and `listAsOf`. A status change written as its own `r.defineEvent` plus an `extendEntityProjection` or `setFields` apply can become a verb in the entity's `verbs` and an `executor.update(..., { verb })`; the projection apply and the hand-written transition check go away. Code that reads `kumiko_events` to show an entity's changes or to fold it to a past instant switches to `executor.history` or `executor.listAsOf`.
affects: EventStoreExecutor, parseAutoVerb
-->
