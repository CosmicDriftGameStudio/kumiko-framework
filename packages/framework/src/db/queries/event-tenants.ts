import type { AnyDb } from "../query.ts";
import { unsafeReadRetrying } from "../query.ts";

// Every tenant_id that owns at least one event. Loose index scan: one probe on
// events_tenant_type_idx (leading column tenant_id) per distinct value, so the cost follows the
// number of tenants, not the number of events.
export async function listEventTenantIds(db: AnyDb): Promise<readonly string[]> {
  const rows = await unsafeReadRetrying<{ tenant_id: string }>(
    db,
    `WITH RECURSIVE tenants AS (
       (SELECT "tenant_id" FROM "kumiko_events" ORDER BY "tenant_id" LIMIT 1)
       UNION ALL
       SELECT (SELECT e."tenant_id" FROM "kumiko_events" e
                WHERE e."tenant_id" > tenants."tenant_id"
                ORDER BY e."tenant_id" LIMIT 1)
         FROM tenants
        WHERE tenants."tenant_id" IS NOT NULL
     )
     SELECT "tenant_id"::text AS tenant_id FROM tenants WHERE "tenant_id" IS NOT NULL`,
    [],
  );
  return rows.map((row) => row.tenant_id);
}
