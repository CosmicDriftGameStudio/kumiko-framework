// Base row-meta columns (id/tenantId/version/insertedAt/modifiedAt/
// insertedById/modifiedById) exist on every entity table without being
// declared entity fields (see rowMetaFieldNames in db/table-builder.ts).
// computeListViewModel needs a type + sortable hint per column when a screen
// picks one of these as a list column (e.g. a SystemAdmin cross-tenant view
// exposing tenantId). This stays a plain string map instead of importing
// db/table-builder directly, so headless (client bundle) doesn't pull
// drizzle in through this type-only subpath. list-row-meta-drift.test.ts
// guards the key set against drift from rowMetaFieldNames(false).
//
// Deliberately excludes the softDelete-only columns (isDeleted/deletedAt/
// deletedById) — this is also the SAME set the boot-validator's entityList
// column checks accept, so a softDelete column stays a boot-time error
// instead of a renderer-side throw (see screens.ts / entity-list-screens.ts).
export type ListRowMetaColumnType = "text" | "number" | "timestamp";

export const LIST_ROW_META_COLUMNS: Readonly<Record<string, ListRowMetaColumnType>> = {
  id: "text",
  tenantId: "text",
  version: "number",
  insertedAt: "timestamp",
  modifiedAt: "timestamp",
  insertedById: "text",
  modifiedById: "text",
};

export type ListRowMetaReference = {
  readonly refFeature: string;
  readonly refEntity: string;
  readonly refLabelField: string;
};

// tenantId would otherwise render the raw GUID; the lookup query is
// `tenant:query:tenant:list`, cross-tenant because the feature is
// `r.systemScope()`.
// ponytail: bulk lookup is capped at REFERENCE_LIST_LOOKUP_LIMIT (200) —
// above that, rows fall back to the GUID; paginate the lookup if an install
// ever exceeds it.
export const LIST_ROW_META_REFERENCES: Readonly<Record<string, ListRowMetaReference>> = {
  tenantId: { refFeature: "tenant", refEntity: "tenant", refLabelField: "name" },
};
