/// <reference types="temporal-polyfill/global" preserve="true" />
// --- Derived (computed) fields ---
//
// A derived field is read-time only: never persisted, no DB column, never in a
// write schema. It lives in `EntityDefinition.derivedFields`, not in `fields`.
// JS `derive` fields run in the list handler after the SQL fetch and are
// display-only. `sql` fields are computed inside the list SELECT as correlated
// subqueries (identifiers come from registry-validated field names, values are
// always bound params) and can opt into `sortable`. Time-dependent values stay
// read-time; neither kind enters the entity cache.

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

export type JsDerivedFieldDef = {
  readonly valueType: DerivedValueType;
  /** Pure function of the stored row + clock. Returns the JSON-safe display
   *  value (e.g. integer minor units for a currency column, ISO string for a
   *  `date`). Runs after SQL derived values are on the row. */
  readonly derive: (row: Readonly<Record<string, unknown>>, ctx: DeriveContext) => unknown;
};

export type SqlDerivedFieldDef = {
  readonly valueType: DerivedValueType;
  readonly sortable?: boolean;
  readonly sql: DerivedSqlSpec;
};

export type DerivedFieldDef = JsDerivedFieldDef | SqlDerivedFieldDef;

export type DerivedSqlSpec =
  | { readonly kind: "coalesce"; readonly fields: readonly string[] }
  | {
      readonly kind: "related";
      /** Same convention as a reference field's `entity` ("feature:entity"). */
      readonly entity: string;
      /** related.<field> = outer.<outer ?? "id"> */
      readonly on: { readonly field: string; readonly outer?: string };
      readonly measure: DerivedRelatedMeasure;
      /** AND-ed. */
      readonly where?: readonly DerivedCondition[];
    };

export type DerivedRelatedMeasure =
  | { readonly kind: "count" }
  | { readonly kind: "countDistinct"; readonly field: string }
  | {
      readonly kind: "first";
      readonly field: string;
      readonly orderBy: string;
      readonly direction: "asc" | "desc";
      /** Only for a reference field with labelField: yields the referenced row's label. */
      readonly label?: boolean;
    };

export type DerivedConditionValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number)[]
  | { readonly today: true }
  | { readonly now: true };

export type DerivedCondition =
  | {
      readonly field: string;
      readonly op: "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
      readonly value: DerivedConditionValue;
    }
  /** from <= today AND (to IS NULL OR to >= today) */
  | { readonly activeOn: { readonly from: string; readonly to: string } };

export function isSqlDerivedField(def: DerivedFieldDef): def is SqlDerivedFieldDef {
  return "sql" in def;
}

export type DerivedFieldsMap = Readonly<Record<string, DerivedFieldDef>>;

/** Client-facing projection of DerivedFieldDef: `derive`/`sql` are server-only
 *  (not JSON-safe), so the browser schema only carries `valueType` and `sortable`. */
export type ClientDerivedFieldDef = {
  readonly valueType: DerivedValueType;
  readonly sortable?: true;
};
