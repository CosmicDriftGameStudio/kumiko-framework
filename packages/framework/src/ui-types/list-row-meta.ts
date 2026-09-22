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
import { SYSTEM_TENANT_ID, SYSTEM_USER_ID } from "../engine/types/identifiers";

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

export type ReferenceLookupSource = {
  readonly queryQn: string;
  readonly labelKey: string;
};

// Overrides the `<refFeature>:query:<refEntity>:list` convention the renderer
// otherwise derives for a reference lookup. Keyed by `${refFeature}:${refEntity}`
// like SYSTEM_REFERENCE_LABELS, so the override holds for every screen that
// references the entity instead of each one re-declaring it.
//
// user:user — the convention QN is a SystemAdmin cross-tenant roster whose
// `tenants` join must not reach a TenantAdmin, so it stays SystemAdmin-only and
// the label lookup goes through the member directory instead: own-tenant
// members for an admin, every user for a SystemAdmin (fw#3107).
export const REFERENCE_LOOKUP_SOURCES: Readonly<Record<string, ReferenceLookupSource>> = {
  "user:user": { queryQn: "tenant:query:member-directory", labelKey: "label" },
};

export type SystemReferenceLabel = {
  readonly id: string;
  readonly labelKey: string;
};

// Reference ids that never resolve through the bulk id->row lookup because
// no row exists for them (e.g. SYSTEM_TENANT_ID has no tenant record, see
// isSystemTenant()) — every reference column falls back to the raw id
// otherwise. Keyed by `${refFeature}:${refEntity}` so useReferenceLookup can
// consult this generically instead of any screen/hook hardcoding an entity
// name. Central so the label applies to every screen that references this
// entity, not just delivery-log (fw#2662).
export const SYSTEM_REFERENCE_LABELS: Readonly<Record<string, SystemReferenceLabel>> = {
  "tenant:tenant": { id: SYSTEM_TENANT_ID, labelKey: "kumiko.reference.system-tenant" },
  // createdBy on a system write (fw#3103) — SYSTEM_USER_ID is an alias for
  // "no human caller", so read_users never holds a matching row.
  "user:user": { id: SYSTEM_USER_ID, labelKey: "kumiko.reference.system-user" },
};
