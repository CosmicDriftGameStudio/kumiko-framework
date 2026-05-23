// T1.5b — per-field write access-check for the set/clear handlers.
//
// Loads a fieldDefinition by (tenantId, entityName, fieldKey), reads its
// `serializedField.fieldAccess.write` array, and verifies the calling user
// holds at least one of the listed roles. When `fieldAccess.write` is
// absent or empty the handler-level RBAC is the only gate.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { sql } from "drizzle-orm";
import { parseSerializedField } from "./parse-serialized-field";

export type FieldAccessCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: "field_definition_not_found" | "field_access_denied";
      requiredRoles?: ReadonlyArray<string>;
    };

// Resolution mirrors the Plan-Doc v2 system+tenant UNION: the active
// definition for a fieldKey on an entity is either system-scope or
// tenant-scope, never both (B1 conflict-rule). The tenant-scoped row sits
// in the caller's tenantId; system-scoped rows would sit under
// SYSTEM_TENANT_ID. B1 only ships the tenant-scoped pipeline, so we only
// query the caller's tenant — system-scope lookup will land in B2.
async function loadSerializedField(
  db: TenantDb,
  tenantId: string,
  entityName: string,
  fieldKey: string,
): Promise<unknown | null> {
  // TenantDb's tenant-filtered API doesn't expose raw SQL — for this
  // single-row lookup we drop down to the underlying DbRunner. tenantId
  // is still pinned in the WHERE clause so we don't lose isolation.
  const rows = await db.raw.execute(sql`
    SELECT serialized_field
    FROM read_custom_field_definitions
    WHERE entity_name = ${entityName}
      AND field_key = ${fieldKey}
      AND tenant_id = ${tenantId}
    LIMIT 1
  `);
  const first = (rows as ReadonlyArray<Record<string, unknown>>)[0]; // @cast-boundary db-row
  return first ? (first["serialized_field"] ?? null) : null;
}

// Per Plan-Doc T1.5b: an empty / undefined `write` array means the field
// inherits the handler-level RBAC unchanged. Only an explicit non-empty
// list constrains. Intersection is role-name equality (case-sensitive).
export async function checkFieldAccessForWrite(
  db: TenantDb,
  tenantId: string,
  entityName: string,
  fieldKey: string,
  userRoles: ReadonlyArray<string>,
): Promise<FieldAccessCheckResult> {
  const serialized = await loadSerializedField(db, tenantId, entityName, fieldKey);
  if (serialized === null) {
    return { ok: false, reason: "field_definition_not_found" };
  }

  const parsed = parseSerializedField(serialized);
  // skip: corrupt serialized_field on disk → treat as no-access-restriction
  // rather than 500. Loader already returned null on missing row, so a
  // null here means parse-failure on a present row; behave like an open
  // field (next gate is the handler-level RBAC).
  if (!parsed) return { ok: true };

  const required = parsed.fieldAccess?.write;
  if (!required || required.length === 0) {
    return { ok: true };
  }
  const hit = userRoles.some((role) => required.includes(role));
  return hit ? { ok: true } : { ok: false, reason: "field_access_denied", requiredRoles: required };
}
