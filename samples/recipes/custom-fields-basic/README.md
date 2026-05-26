# Custom fields

Let a tenant add their own fields to your entity at runtime — without
writing a migration, without rebuilding your handler, without a code
change. The recipe wires a `property` entity into the `custom-fields`
bundle and drives a full *define → set → read* roundtrip.

The result: the tenant defines `internalNumber: text`, sets it on a
property, and reads it back flattened onto the row — looking exactly
like a first-class column.

## What it shows

- **`customFieldsField()`** — a jsonb column factory that holds the
  per-row custom field values. Add it to any entity you want
  custom-field-capable.
- **`wireCustomFieldsFor(r, entityName, table)`** — wires the
  bundle's projection: a multi-stream projection consumes
  `customField.set` / `.cleared` events and writes them into the
  jsonb column, and an entity-postQuery hook flattens the jsonb onto
  the row at read-time.
- **No migrations at runtime** — the schema for custom fields lives
  in two bundled tables (`field-definition` for the spec, jsonb on
  the host row for the values). Defining a field is a write, not a
  DDL.
- **Stammfeld-look on the response** — reads return `{ id, name,
  internalNumber: "X-2042" }`. The consumer can't tell which fields
  are first-class and which are custom.

## Feature composition

```
custom-fields          → core bundle: events + write-handlers + MSP +
                         field-definition entity
property-management    → our feature: opts the `property` entity into
                         custom-fields via wireCustomFieldsFor
```

The `property-management` feature `r.requires("custom-fields")` — the
bundle is non-optional for this recipe because the wired entity would
otherwise have an empty jsonb column and no way to write into it.

## Flow

1. Tenant admin calls `custom-fields:write:define-tenant-field` to
   declare `internalNumber: text` on `property`.
2. App code creates a `property` row via
   `property-management:write:property:create`.
3. Tenant admin calls `custom-fields:write:set-custom-field` with the
   `entityId`, `fieldKey: "internalNumber"`, `value: "X-2042"`.
4. The bundle's MSP consumes the `customField.set` event and writes
   the value into the property row's `customFields` jsonb column.
5. The next `property-management:query:property:list` returns the row
   with `internalNumber: "X-2042"` flattened onto the response — the
   entity-postQuery hook merges the jsonb keys onto the row root.

## When to reach for it

You ship a SaaS where every tenant wants one or two of their own
columns — internal IDs, vendor names, custom flags — and you don't
want to either ship them all as `extraFields1..extraFields5` or push
the tenant to a request-a-feature queue. Custom fields cover the
single-or-handful-of-extra-fields case without engineering
involvement.

If you need the field to drive business logic (`if vipFlag then ...`),
make it a first-class field instead — see [`basic-entity`](../basic-entity/).

## Tests

The integration test under `src/__tests__/` walks two scenarios:

- Tenant defines a text field, sets a value, reads it back flat.
- Tenant defines a number field, sets it, reads it back with the
  number type preserved.

```bash
bun kumiko test integration samples/custom-fields-basic
```

## Source

The feature is ~30 lines (`src/feature.ts`). The integration test is
~80 lines (`src/__tests__/feature.integration.ts`).
