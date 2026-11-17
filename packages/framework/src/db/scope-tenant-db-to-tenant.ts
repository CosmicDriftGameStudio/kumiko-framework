import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { TenantId } from "../engine/types/identifiers.ts";
import { AccessDeniedError } from "../errors/index.ts";
import { createTenantDb } from "./tenant-db.ts";
import { tenantDbRunner, tenantDbWritesDeniedReason } from "./tenant-db-runner.ts";

// Narrows a system-mode TenantDb (or a tenant-mode one to its own tenant) to a "tenant"-mode handle
// for one tenant on the same connection/transaction. For code that must run caller-supplied
// callbacks (e.g. config validators) without handing them a cross-tenant view.
export function scopeTenantDbToTenant(db: TenantDb, tenantId: TenantId): TenantDb {
  // Narrowing a system-mode handle is the purpose; moving a tenant handle to another tenant is a cross-tenant path without declaration.
  if (db.mode === "tenant" && db.tenantId !== tenantId) {
    throw new AccessDeniedError({
      message: `scopeTenantDbToTenant(): a tenant-mode handle for "${db.tenantId}" cannot be moved to tenant "${tenantId}"`,
    });
  }
  const writesDeniedReason = tenantDbWritesDeniedReason(db);
  return createTenantDb({
    db: tenantDbRunner(db),
    tenantId,
    mode: "tenant",
    ...(writesDeniedReason !== undefined && { grants: { writesDeniedReason } }),
  });
}
