// T1.5b — per-field write access-check for the set/clear handlers.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { selectSerializedFieldDefinition } from "../db/queries/field-access";
import { parseSerializedField } from "./parse-serialized-field";

export type FieldAccessCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: "field_definition_not_found" | "field_access_denied";
      requiredRoles?: ReadonlyArray<string>;
    };

export async function checkFieldAccessForWrite(
  db: TenantDb,
  tenantId: string,
  entityName: string,
  fieldKey: string,
  userRoles: ReadonlyArray<string>,
): Promise<FieldAccessCheckResult> {
  const serialized = await selectSerializedFieldDefinition(db, tenantId, entityName, fieldKey);
  if (serialized === null) {
    return { ok: false, reason: "field_definition_not_found" };
  }

  const parsed = parseSerializedField(serialized);
  if (!parsed) return { ok: true };

  const required = parsed.fieldAccess?.write;
  if (!required || required.length === 0) {
    return { ok: true };
  }
  const hit = userRoles.some((role) => required.includes(role));
  return hit ? { ok: true } : { ok: false, reason: "field_access_denied", requiredRoles: required };
}
