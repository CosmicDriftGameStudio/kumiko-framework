# Boot check

Declare a feature's own mount-invariant with `r.bootCheck(...)` instead of
relying on framework-internal knowledge. The recipe reproduces the
prompt-store trap (kumiko-enterprise#229): a feature ships PII-annotated
fields but the companion feature that's supposed to govern user data was
never mounted, and nothing caught it — until now.

## What it shows

- **`r.bootCheck(fn)`** — a check function that runs once at boot with a
  ctx exposing every mounted feature. Throw to fail the boot with a clear,
  feature-prefixed message.
- **Conditional invariants `r.requires` can't express** — the check only
  fails when *this* feature's own shape demands it (has a PII field), not
  unconditionally. A plain `r.requires("user-data-hook")` would fail even
  for a prompt-store variant with no PII fields at all.
- **`validateBoot`** — the framework's boot-time validator, run directly
  against a feature list. `bootCheck` has no DB dependency, so this is the
  cheapest way to exercise it — no `setupTestStack` needed.

## Feature composition

```
prompt-store   → entity with a PII field, declares the bootCheck
user-data-hook → companion feature the check requires when PII is present
```

## Flow

1. `prompt-store` defines an entity with a `pii: true` field.
2. It registers `r.bootCheck(({ features }) => { ... })`, closing over its
   own field definitions to decide whether the invariant applies.
3. At boot, `validateBoot` runs every registered check. If `prompt-store` is
   mounted without `user-data-hook`, the check throws and boot fails with
   `[Feature prompt-store] r.bootCheck failed: ...`.
4. Mount `user-data-hook` alongside it, and the same check passes.

## When to reach for it

You're writing a feature whose validity depends on *another* feature being
mounted, but only under a condition your feature alone can evaluate (e.g.
"only if I have PII fields", "only if I expose more than N screens"). If the
requirement is unconditional, `r.requires`/`r.optionalRequires` is simpler
and already covered by the boot validator.

## Tests

```bash
bun test samples/recipes/boot-check/src/__tests__/feature.test.ts
```

Two cases: companion mounted → boot succeeds; companion missing → boot
fails with the feature-prefixed message.
