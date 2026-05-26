// T1.5b — per-field write access-check for the set/clear handlers.
// Plus single-fetch loader so set-custom-field can run access-check AND
// value-validation off one DB read (no double fetch).

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { selectSerializedFieldDefinition } from "../db/queries/field-access";
import { parseSerializedField, type SerializedFieldShape } from "./parse-serialized-field";

export type FieldAccessCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: "field_definition_not_found" | "field_access_denied";
      requiredRoles?: ReadonlyArray<string>;
    };

export type LoadedFieldDefinition =
  | { found: false }
  // `field` is null when the row exists but its serialized_field is corrupt —
  // callers treat that as "no restriction / no schema" (lenient), distinct
  // from `found: false` (no definition → 404).
  | { found: true; field: SerializedFieldShape | null };

export async function loadFieldDefinition(
  db: TenantDb,
  tenantId: string,
  entityName: string,
  fieldKey: string,
): Promise<LoadedFieldDefinition> {
  const serialized = await selectSerializedFieldDefinition(db, tenantId, entityName, fieldKey);
  if (serialized === null) return { found: false };
  return { found: true, field: parseSerializedField(serialized) };
}

// Pure access-check on an already-loaded definition. Returns the required
// roles when the caller is denied, or `null` when access is allowed.
export function fieldWriteAccessDeniedRoles(
  field: SerializedFieldShape | null,
  userRoles: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  const required = field?.fieldAccess?.write;
  if (!required || required.length === 0) return null;
  return userRoles.some((role) => required.includes(role)) ? null : required;
}

// Convenience wrapper retained for clear-custom-field (no value-validation
// needed there) — does the load + access-check in one call.
export async function checkFieldAccessForWrite(
  db: TenantDb,
  tenantId: string,
  entityName: string,
  fieldKey: string,
  userRoles: ReadonlyArray<string>,
): Promise<FieldAccessCheckResult> {
  const loaded = await loadFieldDefinition(db, tenantId, entityName, fieldKey);
  if (!loaded.found) return { ok: false, reason: "field_definition_not_found" };

  const deniedRoles = fieldWriteAccessDeniedRoles(loaded.field, userRoles);
  if (!deniedRoles) return { ok: true };
  return { ok: false, reason: "field_access_denied", requiredRoles: deniedRoles };
}
