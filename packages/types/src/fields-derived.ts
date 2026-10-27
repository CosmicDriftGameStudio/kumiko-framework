/// <reference types="temporal-polyfill/global" preserve="true" />
// --- Derived (computed) fields ---
//
// A derived field is read-time only: its value is computed from the stored row
// (and the clock) when an entityList query runs (676/2 — NOT detail; only the
// "list" case in entity-handlers.ts calls augmentDerivedFields), never
// persisted. It lives in
// `EntityDefinition.derivedFields` — deliberately NOT in `fields`, so it
// produces no DB column, never enters a write schema, and can't be the target
// of an entityEdit. A declarative `entityList` can name it like any column and
// the view-model renders the appended value.
//
// LIMIT: derived columns are DISPLAY ONLY. A declarative `entityList` loads its
// rows server-side and a column-header sort round-trips to the server, where
// `executor.list` sorts/filters/searches over real SQL columns — so a derived
// field (no column) silently no-ops. There is no client-side sort path. Need a
// derived value sortable/searchable? Materialize it as a stored field; it then
// rides the existing `searchable`/`sortable` machinery. Time-dependent values
// (as-of-today) can't be materialized without a daily re-index anyway.

/** Display type a derived value formats as — drives the column's renderer
 *  choice in the view-model, parallel to FieldDefinition["type"]. Single-column
 *  types only: `money` is excluded because it needs a `<name>Currency`
 *  companion column a derived field has no place to put — use `number`/
 *  `decimal` plus a `{ format: "currency" }` column renderer instead. */
export type DerivedValueType = "text" | "number" | "decimal" | "boolean" | "date" | "timestamp";

/** Clock injected into `derive` — never read `Temporal.Now`/`Date` inside a
 *  derive body (no-date-api guard + testability). The list-query handler passes
 *  the read-time instant; unit tests pass a fixed one. */
export type DeriveContext = {
  readonly asOf: Temporal.Instant;
};

export type DerivedFieldDef = {
  readonly valueType: DerivedValueType;
  /** Pure function of the stored row + clock. Returns the JSON-safe display
   *  value (e.g. integer minor units for a currency column, ISO string for a
   *  `date`). */
  readonly derive: (row: Readonly<Record<string, unknown>>, ctx: DeriveContext) => unknown;
};

export type DerivedFieldsMap = Readonly<Record<string, DerivedFieldDef>>;

/** Client-facing projection of DerivedFieldDef — `derive` is server-only and
 *  not JSON-safe (would trip the output-walk guard), so the browser schema
 *  only ever carries `valueType`. A real `Pick`, not a same-shape cast: TS
 *  itself proves `derive` isn't there instead of a `{ valueType } as
 *  DerivedFieldDef` cast lying about a field that's actually missing. */
export type ClientDerivedFieldDef = Pick<DerivedFieldDef, "valueType">;
