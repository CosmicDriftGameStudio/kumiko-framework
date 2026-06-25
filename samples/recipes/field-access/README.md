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

## Feature composition

```
hr → employee entity with field-level access on salary + internalNotes
```

Single feature, no bundled dependencies — field access is declared on
the field factories inside `createEntity`.

## Flow

1. Admin creates an employee with all fields populated.
2. Accounting reads detail → sees `salary`, not `internalNotes`.
3. Employee reads detail → sees `name`/`email` only.
4. Accounting tries to write `salary` → `field_access_denied` (read-only).
5. Employee updates `name` → succeeds (unrestricted field).

## When to reach for it

Sensitive columns that a feature still needs to expose — phone numbers,
salary figures, internal compliance notes. The whole row stays usable
for everyone; specific fields disappear for callers without the
right role.

## Tests

```bash
bun kumiko test integration samples/field-access
```

Or from the recipe directory:

```bash
bun test src/__tests__/feature.integration.test.ts
```

Covers all three roles reading and writing, including the expected
`field_access_denied` response shape.

## Related samples

- [basic-entity](/en/samples/recipes-basic-entity/) — start here if you
  need standard CRUD before adding field rules.
- [custom-handlers](/en/samples/recipes-custom-handlers/) — explicit
  handlers when generated CRUD is not enough.
