# Timezones

Every time-aware field type on one entity, plus the `ctx.tz` handler API. The
recipe ships a `delivery` entity that carries four different kinds of time and
two feature-level queries that reach for `ctx.tz` directly.

Dates are the field type people get wrong most often — "10:00" means nothing
without a zone, a birthday has no time at all, and "now" is a single instant
seen differently around the world. The framework gives each of those its own
field type so the ambiguity is gone at the schema, not patched in handlers.

## What it shows

- **Four time field types**, each for a distinct shape of time:
  - `createLocatedTimestampField()` — a **wall-clock time at a place**
    (`pickup`). One schema field becomes two columns (`pickup_utc` +
    `pickup_tz`) and three read fields (`{ at, tz, utc }`). Write `{ at, tz }`
    and the framework computes the UTC instant; read it back and you get the
    original wall-clock, the zone, **and** the UTC instant.
  - `createDateField()` — a **calendar date** with no time and no zone
    (`dropoffOn`). A birthday, a due date.
  - `createTimestampField()` — a **UTC instant**, a single point on the
    timeline (`bookedAt`). When something happened.
  - `createTzField()` — a bare **IANA zone name** (`homeZone`), e.g.
    `"Europe/Berlin"`.
- **IANA validation at the write boundary** — an invalid zone name (in a `tz`
  field or in a located field's `tz`) is rejected with a `validation_error`
  before it ever reaches the database, via `Intl.supportedValuesOf`.
- **`ctx.tz` in handlers** — the time API feature code uses instead of
  `new Date()`:
  - `ctx.tz.todayRange(zone)` / `ctx.tz.today(zone)` — the `day-window` query
    returns today's UTC range for a zone, ready to drop into a `BETWEEN` over
    the `pickup_utc` column. It crosses DST and the date line correctly.
  - `ctx.tz.fromCoordinates(coords)` — the `zone-at` query resolves lat/lng to
    an IANA zone through an injected `GeoTzProvider`.

## The located field, end to end

```
write   { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" }
stored  pickup_utc = 2026-04-15T09:00:00Z   pickup_tz = "Europe/Lisbon"
read    { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-15T09:00:00Z" }
```

Lisbon is on summer time (UTC+1) on that date, so 10:00 local is 09:00 UTC —
and the recipe's integration test pins exactly that, proving the conversion is
DST-aware rather than a fixed offset. The wall-clock you wrote comes back
unchanged; the `utc` field is there when you need to sort or range-query.

The renderer pairs this field with a date-time + zone picker out of the box, so
a form binding to `pickup` gets the combined control with no extra wiring — see
the `use-all-bundled` sample app for the live picker.

## The GeoTzProvider seam

`ctx.tz.fromCoordinates` / `ctx.tz.fromAddress` delegate to an optional
provider you inject via the app context — there is no built-in geocoder, so v1
ships nothing that phones home:

```ts illustration
runProdApp({ /* … */, extraContext: { geoTzProvider: myProvider } })
// or buildServer({ context: { geoTzProvider: myProvider } })
```

`fromCoordinates` is the primary method because offline geo-tz libraries
resolve **lat/lng**, not postal addresses; `fromAddress` is optional, for
geocoding-API providers. With no provider configured, both throw a clear,
actionable error. The recipe's test injects a tiny fake provider to exercise
the seam end to end.

## Flow

1. Define the entity with `createEntity({ fields: { … } })` mixing the four
   time field types.
2. Register CRUD via `defineEntity*Handler` — create/update accept the located
   field as `{ at, tz }`; the write boundary computes UTC.
3. Add feature-level queries with `r.queryHandler` that call `ctx.tz` —
   `day-window` (todayRange) and `zone-at` (fromCoordinates). Their names carry
   no entity prefix, so they return their own shape instead of being filtered
   against the entity's fields.

## Tests

```bash
bun kumiko test integration samples/timezones
```

Integration tests under `src/__tests__/` prove the located round-trip with
DST-aware UTC, all four field types preserved, IANA rejection at the write
boundary, the `todayRange` day-window, and the `fromCoordinates` provider seam.

## Related samples

- [basic-entity](/en/samples/recipes-basic-entity/) — the CRUD baseline these
  time fields sit on top of.
- [custom-handlers](/en/samples/recipes-custom-handlers/) — more on
  `r.writeHandler` / `r.queryHandler` with business logic.
