# Field-level access

Restrict individual fields by role — separate read and write rules per
field, no `if` branches in the handler. This recipe ships an `employee`
entity where `salary` is visible to Admin and Accounting (only Admin
writes) and `internalNotes` is Admin-only on both sides.

The framework strips fields the caller cannot read on the way out and
rejects writes that touch fields the caller cannot write. Your handler
never sees a forbidden field on input, never produces one on output.

## What it shows

- **`access: { read, write }` on a field factory** — two independent
  rules per field, both expressed as role lists.
- **Read-side filtering** — querying as `Employee` returns the row
  without the `salary` and `internalNotes` keys; querying as
  `Accounting` returns `salary` but not `internalNotes`.
- **Write-side enforcement** — a write payload that includes
  `internalNotes` from a non-Admin role fails with
  `field_access_denied` and the offending field path.
- **No handler-level branching** — the same `r.queryHandler` body
  serves all three roles; the framework filters output per call.

## When to reach for it

Sensitive columns that a feature still needs to expose — phone numbers,
salary figures, internal compliance notes. The whole row stays usable
for everyone; specific fields disappear for callers without the
right role.

## Source

The whole feature lives in `src/feature.ts` (~40 lines). Integration
tests cover all three roles reading + writing the entity, including the
expected `field_access_denied` response shape.

```bash
yarn kumiko test integration samples/field-access
```
