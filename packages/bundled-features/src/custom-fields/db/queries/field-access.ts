import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

// System definitions are visible to every tenant; when both scopes define the
// same key the system row wins (ORDER BY puts it first).
export async function selectSerializedFieldDefinition(
  runner: DbRunner,
  tenantId: string,
  entityName: string,
  fieldKey: string,
): Promise<unknown | null> {
  const rows = await unsafeReadRetrying(
    runner,
    "SELECT serialized_field FROM read_custom_field_definitions WHERE entity_name = $1 AND field_key = $2 AND tenant_id IN ($3, $4) AND is_deleted = FALSE ORDER BY (tenant_id = $4) DESC LIMIT 1",
    [entityName, fieldKey, tenantId, SYSTEM_TENANT_ID],
  );
  const first = (rows as ReadonlyArray<Record<string, unknown>>)[0]; // @cast-boundary db-row
  return first ? (first["serialized_field"] ?? null) : null;
}
