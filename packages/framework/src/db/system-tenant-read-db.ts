import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers.ts";
import type { DbRunner } from "./connection.ts";
import { createTenantDb } from "./tenant-db.ts";
import { isBoundTenantDb, tenantDbRunner } from "./tenant-db-runner.ts";

// Tenant mode on the system tenant: RLS isolation passes exactly the system tenant's rows, never
// another tenant's, which a `kumiko.scope = 'system'` bypass would also expose.
export function systemTenantReadDb(db: TenantDb | DbRunner): TenantDb {
  return createTenantDb({
    db: isBoundTenantDb(db) ? tenantDbRunner(db) : db,
    tenantId: SYSTEM_TENANT_ID,
    mode: "tenant",
    grants: { writesDeniedReason: "on a handle that reads the system tenant's rows only" },
  });
}

// Raw runner on the same system-tenant handle, for event-store functions that take a DbRunner
// (event streaming, stream archival). Writes stay inside the system tenant's isolation.
export function systemTenantStreamRunner(db: TenantDb | DbRunner): DbRunner {
  return tenantDbRunner(systemTenantReadDb(db));
}
