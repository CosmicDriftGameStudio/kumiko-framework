import type { DbTx } from "../db/connection";
import { extractPgError } from "../db/pg-error";
import { asRawClient, runInSavepoint, transaction } from "../db/query";
import { AccessDeniedError, InternalError } from "../errors";
import {
  type DispatchContext,
  memberResolutionReadOnlyDenied,
  resolveDbSource,
} from "./dispatch-shared";

const PG_READ_ONLY_SQLSTATE = "25006";

// Bun.SQL surfaces the PG SQLSTATE as `errno` (code stays "ERR_POSTGRES_SERVER_ERROR");
// postgres.js surfaces it as `code`, possibly one `.cause` layer down (DrizzleQueryError-style wrapping).
function isReadOnlyTransactionViolation(e: unknown): boolean {
  if (extractPgError(e)?.code === PG_READ_ONLY_SQLSTATE) return true;
  if (typeof e !== "object" || e === null) return false;
  // @cast-boundary error-details — Bun.SQL error shape (errno)
  if ((e as { errno?: unknown }).errno === PG_READ_ONLY_SQLSTATE) return true;
  // @cast-boundary error-details — Bun.SQL error shape (errno) under .cause
  const cause = (e as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return false;
  return (cause as { errno?: unknown }).errno === PG_READ_ONLY_SQLSTATE;
}

async function runInDiscardedReadOnlySavepoint<T>(
  tx: DbTx,
  fn: (readOnlyTx: DbTx) => Promise<T>,
): Promise<T> {
  const discardMarker = {};
  const settled: { outcome?: { readonly value: T } } = {};
  try {
    await runInSavepoint(tx, async (sp) => {
      // kumiko-lint-ignore raw-sql transaction characteristic, no query helper
      await asRawClient(sp).unsafe("SET TRANSACTION READ ONLY");
      // @cast-boundary driver savepoint handle — structurally a DbTx, same shape runInSavepoint's caller relies on
      settled.outcome = { value: await fn(sp as DbTx) };
      // Always discarded: RELEASE SAVEPOINT would leave the outer tx read-only too.
      throw discardMarker;
    });
  } catch (e) {
    if (e !== discardMarker) throw e;
  }
  if (!settled.outcome) {
    throw new InternalError({
      message: "runInDiscardedReadOnlySavepoint: savepoint ended without settling — this is a bug.",
    });
  }
  return settled.outcome.value;
}

export async function runInMemberReadOnlyTransaction<T>(
  ctx: DispatchContext,
  tx: DbTx | undefined,
  fn: (readOnlyTx: DbTx) => Promise<T>,
): Promise<T> {
  try {
    if (tx) return await runInDiscardedReadOnlySavepoint(tx, fn);
    const pool = resolveDbSource(ctx, undefined);
    if (!pool) {
      throw new InternalError({
        message: "ctx.queryAsMember requires a database connection — none is configured.",
      });
    }
    // Savepoint even on the pool path: Postgres rejects a READ WRITE reset (SQLSTATE 25001) inside a subtransaction.
    return await transaction(pool, (outer) =>
      // @cast-boundary driver begin() handle — structurally a DbTx, same shape runInSavepoint's caller relies on
      runInDiscardedReadOnlySavepoint(outer as DbTx, fn),
    );
  } catch (e) {
    if (e instanceof AccessDeniedError) throw e;
    if (isReadOnlyTransactionViolation(e)) throw memberResolutionReadOnlyDenied(e);
    throw e;
  }
}
