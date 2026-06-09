import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

// guard:dup-ok — andere SQL als selectFieldDefinitionsForEntity; gleiche Bezeichner, verschiedene Queries
export async function selectFieldDefinitionsWithSerialized(
  db: DbRunner,
  entityName: string,
  tenantId: string,
): Promise<readonly { field_key: string; serialized_field: unknown }[]> {
  return asRawClient(db).unsafe(
    "SELECT field_key, serialized_field FROM read_custom_field_definitions WHERE entity_name = $1 AND tenant_id = $2",
    [entityName, tenantId],
  ) as Promise<readonly { field_key: string; serialized_field: unknown }[]>;
}

export async function selectHostRowsWithCustomFields(
  db: DbRunner,
  tableName: string,
  tenantId: string,
): Promise<readonly unknown[]> {
  const quoted = `"${tableName.replace(/"/g, '""')}"`;
  const rowsResult = await asRawClient(db).unsafe(
    `SELECT id, modified_at, custom_fields FROM ${quoted} WHERE tenant_id = $1 AND custom_fields IS NOT NULL`,
    [tenantId],
  );
  return Array.isArray(rowsResult) ? rowsResult : [];
}

export async function applyRetentionRemovals(
  db: DbRunner,
  tableName: string,
  deleteKeys: readonly string[],
  anonymizeKeys: readonly string[],
  rowId: string,
): Promise<void> {
  const quoted = `"${tableName.replace(/"/g, '""')}"`;
  // Atomic per-row jsonb edit instead of read-modify-write of the whole
  // object: delete-keys are dropped (`- $1::text[]`), anonymize-keys are set
  // to JSON null via a merge patch. Operating on the live row value preserves
  // a concurrent set-custom-field on any *other* key — no lost update.
  await asRawClient(db).unsafe(
    `UPDATE ${quoted} SET custom_fields = CASE
       WHEN jsonb_typeof(custom_fields) = 'object' THEN
         (custom_fields - $1::text[])
         || COALESCE(
              (SELECT jsonb_object_agg(k, 'null'::jsonb) FROM unnest($2::text[]) AS k),
              '{}'::jsonb
            )
       ELSE custom_fields
     END
     WHERE id = $3`,
    [deleteKeys, anonymizeKeys, rowId],
  );
}
