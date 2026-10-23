import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { InternalError } from "../errors/index.ts";
import type { DbRunner } from "./connection.ts";
import { runInNewTransaction, runInSavepointIfSupported } from "./query.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";

// Same tenant, mode and grants on another handle of the connection (own transaction or savepoint).
type ScopedRebinder = {
  readonly memberReadOnly: boolean;
  readonly rebind: (runner: DbRunner) => TenantDb;
};

const scopedRebinders = new WeakMap<TenantDb, ScopedRebinder>();

export function registerScopedRebinder(tenantDb: TenantDb, scoped: ScopedRebinder): void {
  scopedRebinders.set(tenantDb, scoped);
}

function requireScopedRebinder(tenantDb: TenantDb, caller: string): ScopedRebinder {
  const scoped = scopedRebinders.get(tenantDb);
  if (!scoped) {
    throw new InternalError({
      message:
        `${caller} received a TenantDb without a transaction rebinder: either it was not ` +
        "built by createTenantDb, or it is the fail-closed ctx.db/ctx.dbOutsideTransaction of an " +
        "r.systemScope() handler (use ctx.systemDb.outsideTransaction there).",
    });
  }
  return scoped;
}

export async function runInOwnTransaction<T>(
  tenantDb: TenantDb,
  fn: (txDb: TenantDb) => Promise<T>,
): Promise<T> {
  const scoped = requireScopedRebinder(tenantDb, "runInOwnTransaction");
  if (scoped.memberReadOnly) {
    throw new InternalError({
      message:
        "runInOwnTransaction: memberReadOnly TenantDb — a fresh transaction would escape " +
        "the enforced read-only scope.",
    });
  }
  return runInNewTransaction(tenantDbRunner(tenantDb), (tx) => fn(scoped.rebind(tx)));
}

// A throw inside fn rolls back only fn's statements; the caller's transaction stays usable.
export async function runInOwnSavepoint<T>(
  tenantDb: TenantDb,
  fn: (savepointDb: TenantDb) => Promise<T>,
): Promise<T> {
  const scoped = requireScopedRebinder(tenantDb, "runInOwnSavepoint");
  return runInSavepointIfSupported(tenantDbRunner(tenantDb), (sp) => fn(scoped.rebind(sp)));
}
