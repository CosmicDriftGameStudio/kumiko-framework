# Derived fields (SQL)

A derived field is read-time only: no column, never in a write schema. A `sql` derived field is
computed inside the list SELECT as the viewer, so it can be sorted on the server and never
enters the entity cache. A viewer who cannot read a field the value depends on gets NULL.

## What it shows

- `coalesce`: the nickname when set, else the name.
- `related` + `count` with a `where`: open tickets per building.
- `related` + `first`: the title of the newest ticket.
- `related` + `first` on a money field with `valueType: "money"`: amount and currency come
  back in the shape of a stored money field (no key when the value is unset).
- `sortable: true` on a derived field and an `entityList` `defaultSort` on it.

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/derived-fields-sql
bun test
```

`src/__tests__/feature.integration.test.ts` runs the list query over HTTP.
