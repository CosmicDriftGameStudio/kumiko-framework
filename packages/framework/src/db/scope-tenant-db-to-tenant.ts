import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { TenantId } from "../engine/types/identifiers.ts";
import { createTenantDb } from "./tenant-db.ts";
import { tenantDbRunner, tenantDbWritesDeniedReason } from "./tenant-db-runner.ts";

// Narrows a (possibly "system"-mode) TenantDb to a "tenant"-mode handle for one tenant on the
// same connection/transaction. For code that must run caller-supplied callbacks (e.g. config
// validators) without handing them a cross-tenant view.
export function scopeTenantDbToTenant(db: TenantDb, tenantId: TenantId): TenantDb {
  const writesDeniedReason = tenantDbWritesDeniedReason(db);
  return createTenantDb({
    db: tenantDbRunner(db),
    tenantId,
    mode: "tenant",
    ...(writesDeniedReason !== undefined && { grants: { writesDeniedReason } }),
  });
}
