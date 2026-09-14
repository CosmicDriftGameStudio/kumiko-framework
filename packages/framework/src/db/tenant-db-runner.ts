import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { InternalError } from "../errors";
import type { DbRunner } from "./connection";

const tenantDbRunners = new WeakMap<TenantDb, DbRunner>();

export function bindTenantDbRunner(tenantDb: TenantDb, runner: DbRunner): void {
  tenantDbRunners.set(tenantDb, runner);
}

// WeakMap.get never reads a property off tenantDb — safe even when tenantDb is a
// throwing systemScope guard Proxy that rejects every property access.
export function tenantDbRunner(tenantDb: TenantDb): DbRunner {
  const runner = tenantDbRunners.get(tenantDb);
  if (!runner) {
    throw new InternalError({
      message:
        "framework infrastructure received a TenantDb not built by createTenantDb (or a " +
        "fail-closed systemScope guard) — no connection bound.",
    });
  }
  return runner;
}
