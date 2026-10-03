// WhereValue: primitive for eq, array for IN, null for IS NULL, or an
// operator-object for range/comparisons. Deliberately NOT `unknown |
// WhereOperator` — that union collapses to `unknown` and erases the
// operator form at every call site (a typo like `{ gtee: x }` would
// type-check, then bind as eq at runtime).
export type JsonTextMatch = {
  /** Top-level keys, tried in order; the first non-null text value is compared (COALESCE). */
  readonly keys: readonly [string, ...string[]];
  readonly eq: string;
};
export type WhereOperator = {
  readonly gt?: unknown;
  readonly gte?: unknown;
  readonly lt?: unknown;
  readonly lte?: unknown;
  readonly ne?: unknown;
  readonly in?: readonly unknown[];
  readonly like?: string;
  /** jsonb columns only; cannot be combined with other operators in the same object. */
  readonly jsonText?: JsonTextMatch | readonly JsonTextMatch[];
};
export type WherePrimitive = string | number | boolean | bigint | Date | null | undefined;
export type WhereValue = WherePrimitive | readonly WherePrimitive[] | WhereOperator;
// Wider index so dynamic Record<string, unknown> builders still typecheck;
// annotate literals as WhereValue / satisfies WhereValue to catch typos.
export type WhereObject = Record<string, WhereValue | unknown>;

export type OrderByClause = {
  readonly col: string;
  readonly direction?: "asc" | "desc";
};

export type SelectOptions = {
  readonly limit?: number;
  // Single column or array for multi-column tie-breaks (e.g.
  // [{col: "createdAt"}, {col: "id"}] for chronological-with-stable-id).
  readonly orderBy?: OrderByClause | readonly OrderByClause[];
};
