import type { EventStoreExecutor } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { runnerCanBeginTransaction } from "./query.ts";
import { runInOwnTransaction } from "./tenant-db.ts";
import { isBoundTenantDb, tenantDbRunner, tenantDbWritesDeniedReason } from "./tenant-db-runner.ts";

type WriteVerbs = Pick<EventStoreExecutor, "create" | "update" | "delete" | "forget" | "restore">;

// Aborts the surrounding transaction when a verb returns a failure instead of throwing.
class RollbackOnFailure extends Error {}

// Pool runners have no savepoint, so append, projection and hooks would otherwise commit as
// separate autocommit statements. Tx and savepoint runners already provide atomicity.
async function runVerbAtomically<R extends WriteResult>(
  db: TenantDb,
  run: (txDb: TenantDb) => Promise<R>,
): Promise<R> {
  // Unbound and denied handles keep their original error, a fresh transaction would reword it.
  if (
    !isBoundTenantDb(db) ||
    tenantDbWritesDeniedReason(db) !== undefined ||
    !runnerCanBeginTransaction(tenantDbRunner(db))
  ) {
    return run(db);
  }
  let failure: R | undefined;
  try {
    return await runInOwnTransaction(db, async (txDb) => {
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
