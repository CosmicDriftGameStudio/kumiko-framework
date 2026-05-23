// T1.5e — per-tenant fieldDefinition quota.
//
// `countTenantFieldDefinitions(db, tenantId)` runs a single COUNT(*) against
// `read_custom_field_definitions` scoped to the caller's tenant. The
// `define-tenant-field` handler consults this before insert and rejects
// with `cap_exceeded` once a configurable per-tenant ceiling is reached.
//
// This is a simple projection-count rather than a `cap-counter`-bundle
// counter, because the read-projection is the authoritative source
// (soft-deleted rows already drop out) and we don't need rolling-window
// semantics. A future iteration can swap to `cap-counter` if pricing
// wants e.g. monthly-roll definition allowances.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { sql } from "drizzle-orm";

export async function countTenantFieldDefinitions(db: TenantDb, tenantId: string): Promise<number> {
  const rowsResult = await db.raw.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM read_custom_field_definitions
    WHERE tenant_id = ${tenantId}
  `);
  const rows = rowsResult as ReadonlyArray<Record<string, unknown>>; // @cast-boundary db-row
  const first = rows[0];
  if (!first) return 0;
  const n = first["n"];
  return typeof n === "number" ? n : Number.parseInt(String(n ?? 0), 10);
}
