import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { InternalError } from "../errors/index.ts";
import type { DbRunner } from "./connection.ts";

const tenantDbRunners = new WeakMap<object, DbRunner>();

export function isBoundTenantDb(value: unknown): value is TenantDb {
  return typeof value === "object" && value !== null && tenantDbRunners.has(value);
}

export function isDbRunner(value: unknown): value is DbRunner {
  return typeof propertyOf(value, "unsafe") === "function";
}

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

const writesDeniedReasons = new WeakMap<TenantDb, string>();

export function denyTenantDbWrites(tenantDb: TenantDb, reason: string): void {
  writesDeniedReasons.set(tenantDb, reason);
}

export function tenantDbWritesDeniedReason(tenantDb: TenantDb): string | undefined {
  return writesDeniedReasons.get(tenantDb);
}

export function tenantDbWritesDeniedError(operation: string, reason: string): InternalError {
  return new InternalError({
    message: `${operation}: writes are not available ${reason}; run the write through ctx.write so it gets its own transaction`,
  });
}

// For framework code that writes through the raw runner (executor verbs, event appends, projection steps):
// the TenantDb's own write methods are denied via TenantDbGrants, this closes the runner-based door.
export function tenantDbWriteRunner(tenantDb: TenantDb, operation: string): DbRunner {
  const reason = writesDeniedReasons.get(tenantDb);
  if (reason !== undefined) throw tenantDbWritesDeniedError(operation, reason);
  return tenantDbRunner(tenantDb);
}
