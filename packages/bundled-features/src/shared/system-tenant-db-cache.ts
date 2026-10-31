import { createTenantDb, type DbConnection, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// One system-mode TenantDb per tenant, so a job touching many rows of the same
// tenant does not rebuild the wrapper per row.
export function createSystemTenantDbCache(
  db: DbConnection,
  reason: string,
): (tenantId: TenantId) => TenantDb {
  const cache = new Map<TenantId, TenantDb>();
  return (tenantId) => {
    let existing = cache.get(tenantId);
    if (!existing) {
      existing = createTenantDb({ db, tenantId, mode: "system", reason });
      cache.set(tenantId, existing);
    }
    return existing;
  };
}
