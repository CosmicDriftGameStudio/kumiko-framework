import type { DbConnection } from "@cosmicdrift/kumiko-types/db-connection";
import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { AccessDeniedError } from "../errors/index.ts";
import {
  type ConnectionTenantDb,
  type CreateTenantDbOptions,
  createTenantDb as createTenantDbInAnyMode,
  type ExecutorManagedTenantDb,
  isUnsafeRawRunner,
} from "./tenant-db.ts";

// System mode and grants stay framework-internal (internal/row-level-security); the public
// handle is always pinned to one tenant, and declared cross-tenant access goes through
// r.systemScope(), ctx.crossTenantReads or ctx.tenants.writeTarget.
export type PublicCreateTenantDbOptions = Pick<
  CreateTenantDbOptions,
  "db" | "tenantId" | "tracer" | "meter" | "signal"
> & { readonly mode?: "tenant" };

export function createTenantDb(
  options: PublicCreateTenantDbOptions & { readonly db: ExecutorManagedRunner },
): ExecutorManagedTenantDb;
export function createTenantDb(
  options: PublicCreateTenantDbOptions & { readonly db: DbConnection },
): ConnectionTenantDb;
export function createTenantDb(options: PublicCreateTenantDbOptions): TenantDb;
export function createTenantDb(options: PublicCreateTenantDbOptions): TenantDb {
  // An unsafeRaw runner is system-scoped by declaration; re-tenanting it would turn one
  // audited raw escape hatch into a typed handle on any tenant.
  if (isUnsafeRawRunner(options.db)) {
    throw new AccessDeniedError({
      message:
        "createTenantDb(): a runner from unsafeRaw() cannot back a TenantDb. Use r.systemScope() with ctx.systemDb.acknowledgeCrossTenant(reason), ctx.crossTenantReads or ctx.tenants.writeTarget(tenantId).",
    });
  }
  const { db, tenantId, tracer, meter, signal } = options;
  return createTenantDbInAnyMode({ db, tenantId, tracer, meter, signal, mode: "tenant" });
}
