import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";

export async function countTenantFieldDefinitions(db: TenantDb, tenantId: string): Promise<number> {
  // Active definitions only — delete soft-deletes (the deterministic stream is
  // kept so a re-define can restore it), so isDeleted rows must not consume quota.
  const rowsResult = await asRawClient(db.raw).unsafe(
    "SELECT COUNT(*)::int AS n FROM read_custom_field_definitions WHERE tenant_id = $1 AND is_deleted = FALSE",
    [tenantId],
  );
  const rows = rowsResult as ReadonlyArray<Record<string, unknown>>; // @cast-boundary db-row
  const first = rows[0];
  if (!first) return 0;
  const n = first["n"];
  return typeof n === "number" ? n : Number.parseInt(String(n ?? 0), 10);
}
