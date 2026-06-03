import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";

export async function selectSerializedFieldDefinition(
  db: TenantDb,
  tenantId: string,
  entityName: string,
  fieldKey: string,
): Promise<unknown | null> {
  const rows = await asRawClient(db.raw).unsafe(
    "SELECT serialized_field FROM read_custom_field_definitions WHERE entity_name = $1 AND field_key = $2 AND tenant_id = $3 LIMIT 1",
    [entityName, fieldKey, tenantId],
  );
  const first = (rows as ReadonlyArray<Record<string, unknown>>)[0]; // @cast-boundary db-row
  return first ? (first["serialized_field"] ?? null) : null;
}
