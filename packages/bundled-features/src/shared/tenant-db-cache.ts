import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// One TenantDb per tenant, so a job touching many rows of the same tenant does
// not rebuild the wrapper per row. The caller builds the TenantDb itself, so
// its createTenantDb call keeps the literal system-mode reason the guard needs.
export function createTenantDbCache(
  create: (tenantId: TenantId) => TenantDb,
): (tenantId: TenantId) => TenantDb {
  const cache = new Map<TenantId, TenantDb>();
  return (tenantId) => {
    let existing = cache.get(tenantId);
    if (!existing) {
      existing = create(tenantId);
      cache.set(tenantId, existing);
    }
    return existing;
  };
}
