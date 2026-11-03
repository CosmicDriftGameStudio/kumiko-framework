import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { assertReason } from "../engine/escape-hatch-reason.ts";
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

// Raw runner for event-store reads that take a DbRunner (event streaming, archive checks).
export function systemTenantReadRunner(db: TenantDb | DbRunner): DbRunner {
  return tenantDbRunner(systemTenantReadDb(db));
}

// Raw runner for event-store writes that take a DbRunner (stream archival, note erasure); RLS
// isolation limits its writes to system-tenant rows.
export function systemTenantWriteRunner(db: TenantDb | DbRunner, reason: string): DbRunner {
  assertReason("systemTenantWriteRunner", reason);
  return tenantDbRunner(
    createTenantDb({
      db: isBoundTenantDb(db) ? tenantDbRunner(db) : db,
      tenantId: SYSTEM_TENANT_ID,
      mode: "tenant",
    }),
  );
}
