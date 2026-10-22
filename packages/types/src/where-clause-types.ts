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
  /** Not for jsonb columns; an empty list matches every row. */
  readonly notIn?: readonly unknown[];
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
  // Field names as in WhereObject/row; only these columns are read, so unselected columns (e.g. encrypted ciphertext) never leave the database.
  readonly fields?: readonly string[];
  // Single column or array for multi-column tie-breaks (e.g.
  // [{col: "createdAt"}, {col: "id"}] for chronological-with-stable-id).
  readonly orderBy?: OrderByClause | readonly OrderByClause[];
  // Newest-row-per-key reads without unsafeRaw: one row per distinct value of
  // these fields (Postgres DISTINCT ON), the first by `orderBy`. Postgres needs
  // `orderBy` to start with these fields in the same order; omitted `orderBy`
  // defaults to them ascending. The tenant-scoped read set includes SYSTEM_TENANT_ID reference
  // rows, so they compete for "newest"; add `tenantId: db.tenantId` to the where to pick own rows only.
  readonly distinctOn?: readonly [string, ...string[]];
};
