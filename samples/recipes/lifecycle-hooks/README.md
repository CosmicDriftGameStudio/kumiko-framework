# Lifecycle hooks

Attach behaviour to the four entity lifecycle moments: validation
(reject bad input), postSave (log every change), preDelete (block delete
when an invariant says no), postDelete (log after commit). This recipe
ships an `article` entity with hooks at each phase.

Hooks are how a feature inserts cross-cutting logic without the handler
body knowing about it. They run in the same transaction as the write
unless explicitly opted out, so a thrown hook rolls the whole change
back.

## What it shows

- **`r.hook("validation", handlerRef, fn)`** — runs before the
  handler body executes. Returns either `null` (pass) or an array of
  `{ field, error }` objects (fail). Used here to reject titles
  containing the word "spam" and titles longer than 200 characters.
- **`r.entityHook("postSave", entityRef, fn)`** — fires after every
  successful save (create or update) in the same transaction.
  `result.isNew` distinguishes create from update; `result.changes`
  carries the changed fields only.
- **`r.entityHook("preDelete", entityRef, fn)`** — fires inside the
  delete transaction. Throws on invariant violations (here: "published
  articles cannot be deleted") to roll the delete back. The handler
  receives the full row snapshot — no extra load needed.
- **`r.entityHook("postDelete", entityRef, fn)`** — fires after commit.
  External side effects (logs, notifications) belong here because
  failures cannot roll the delete back.

## When to reach for it

You want logic that runs alongside writes — auditing, notification
emails, denormalised counter updates — without modifying the handler
body. The split between in-transaction and after-commit phases lets you
pick the right rollback semantics for each side effect.

## Source

The whole feature lives in `src/feature.ts` (~100 lines). Integration
tests exercise each of the four hook phases plus the rollback path on
preDelete violation.

```bash
yarn kumiko test integration samples/lifecycle-hooks
```
