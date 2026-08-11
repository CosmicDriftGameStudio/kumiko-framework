---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

**BREAKING:** `type:"date"` fields (`createDateField`) now back onto a real Postgres `DATE` column and round-trip as `Temporal.PlainDate`, fully decoupled from `Temporal.Instant`/`TIMESTAMPTZ` (kumiko-framework#1924). Previously `date` was silently aliased onto the same `instant()`/`TIMESTAMPTZ` column as `type:"timestamp"`: reads returned a full ISO instant (`"2026-03-15T00:00:00Z"`), writes expected a bare `"yyyy-mm-dd"` string that got bound to a timestamptz column through the session's TimeZone — so both directions were timezone-dependent for what is meant to be a pure calendar-day value (invoice date, lease term).

After this change:

- **Read shape**: a `date` field now serializes as `"2026-03-15"` (via `Temporal.PlainDate`'s own `toJSON()`), not `"2026-03-15T00:00:00Z"`. Any non-form client that Instant-parses a date field's JSON value (`Temporal.Instant.from(value)`) will throw — that parse requires a UTC designator/offset a PlainDate string doesn't have. A client that only reads the leading `"yyyy-mm-dd"` (string slice, or the existing form-fill path) is unaffected, since both old and new values share that prefix.
- **Write shape**: unchanged — `date` fields already took a bare `"yyyy-mm-dd"` string; that now binds directly to a real `DATE` column instead of drifting through the session TimeZone on the way into a `TIMESTAMPTZ` column.
- **Where-filters**: a filter value built as a `Temporal.Instant` against a `date` column (a leftover pattern from when `date` was an Instant alias) still works — `prepareValue` anchors it at UTC before binding — but new code should build `date` filters as plain `"yyyy-mm-dd"` strings or `Temporal.PlainDate`.

**Migration, per entity's table kind:**

- **Managed (event-sourced projection) tables**: the generator emits `DROP TABLE` + `CREATE TABLE` and replays from the event log — no manual SQL needed, but factor in the replay cost for entities with a large event history.
- **Unmanaged (`store_*`, direct-write) tables**: the generator emits an in-place `ALTER TABLE … ALTER COLUMN … TYPE date USING (col AT TIME ZONE 'UTC')::date` for exactly this `timestamptz → date` transition — anchored explicitly at UTC. A bare `ALTER COLUMN … TYPE date` (no `USING`) falls back to Postgres's implicit cast, which reads the *session* TimeZone and can migrate the same row to a different calendar day depending on who runs it; do not hand-write that fallback form.

No consumer-repo migration is included in this PR — solon has ~15 `type:"date"` fields on unmanaged tables and needs its own migration + existing-data audit as a follow-up.
