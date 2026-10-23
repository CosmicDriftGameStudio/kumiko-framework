import type { EventStoreExecutor } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { runnerCanBeginTransaction } from "./query.ts";
import { isBoundTenantDb, tenantDbRunner, tenantDbWritesDeniedReason } from "./tenant-db-runner.ts";
import { runInOwnSavepoint, runInOwnTransaction } from "./tenant-db-scoped-rebind.ts";

type WriteVerbs = Pick<EventStoreExecutor, "create" | "update" | "delete" | "forget" | "restore">;

// Aborts the surrounding transaction when a verb returns a failure instead of throwing.
class RollbackOnFailure extends Error {}

// Append, projection and hooks commit or roll back together, also when a handler swallows a failed
// verb inside its transaction. Savepoints on one tx are serialized, so parallel verbs cannot interleave.
async function runVerbAtomically<R extends WriteResult>(
  db: TenantDb,
  run: (txDb: TenantDb) => Promise<R>,
): Promise<R> {
  // Unbound and denied handles keep their original error, a fresh transaction would reword it.
  if (!isBoundTenantDb(db) || tenantDbWritesDeniedReason(db) !== undefined) {
    return run(db);
  }
  const runInOwnScope = runnerCanBeginTransaction(tenantDbRunner(db))
    ? runInOwnTransaction
    : runInOwnSavepoint;
  let failure: R | undefined;
  try {
    return await runInOwnScope(db, async (txDb) => {
      const result = await run(txDb);
      if (!result.isSuccess) {
        failure = result;
        throw new RollbackOnFailure();
      }
      return result;
    });
  } catch (error) {
    if (error instanceof RollbackOnFailure && failure !== undefined) return failure;
    throw error;
  }
}

export function withOwnTransactionOnPool(verbs: WriteVerbs): WriteVerbs {
  return {
    create: (payload, user, db, options) =>
      runVerbAtomically(db, (txDb) => verbs.create(payload, user, txDb, options)),
    update: (payload, user, db, options) =>
      runVerbAtomically(db, (txDb) => verbs.update(payload, user, txDb, options)),
    delete: (payload, user, db, options) =>
      runVerbAtomically(db, (txDb) => verbs.delete(payload, user, txDb, options)),
    forget: (payload, user, db, options) =>
      runVerbAtomically(db, (txDb) => verbs.forget(payload, user, txDb, options)),
    restore: (payload, user, db, options) =>
      runVerbAtomically(db, (txDb) => verbs.restore(payload, user, txDb, options)),
  };
}
