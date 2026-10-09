import type { DbTx } from "../db/connection.js";
import { extractPgError } from "../db/pg-error.js";
import { asRawClient, runInSavepoint, transaction } from "../db/query.js";
import {
  AccessDeniedError,
  InternalError,
  MemberReadTimeoutError,
  memberResolutionReadOnlyDenied,
} from "../errors/index.js";
import { type DispatchContext, resolveDbSource } from "./dispatch-shared.js";

const PG_READ_ONLY_SQLSTATE = "25006";
const PG_QUERY_CANCELED_SQLSTATE = "57014";

function isReadOnlyTransactionViolation(e: unknown): boolean {
  return extractPgError(e)?.code === PG_READ_ONLY_SQLSTATE;
}

class SavepointDiscard extends Error {
  constructor() {
    super("savepoint discarded on purpose");
    this.name = "SavepointDiscard";
  }
}

function isStatementTimeout(e: unknown): boolean {
  return extractPgError(e)?.code === PG_QUERY_CANCELED_SQLSTATE;
}

// SET cannot take bind parameters, so the value is interpolated — only after it is proven a plain integer.
function memberReadSessionSettingsSql(timeoutMs: number, bindIdleTimeout: boolean): string {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new InternalError({
      message: `member read timeout must be a positive integer, got ${timeoutMs}`,
    });
  }
  const idleTimeout = bindIdleTimeout
    ? `; SET LOCAL idle_in_transaction_session_timeout = ${timeoutMs}`
    : "";
  return `SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = ${timeoutMs}${idleTimeout}`;
}

async function runInDiscardedReadOnlySavepoint<T>(
  tx: DbTx,
  timeoutMs: number,
  bindIdleTimeout: boolean,
  fn: (readOnlyTx: DbTx) => Promise<T>,
): Promise<T> {
  const settled: { outcome?: { readonly value: T } } = {};
  try {
    await runInSavepoint(tx, async (sp) => {
      // kumiko-lint-ignore raw-sql transaction characteristic, no query helper
      await asRawClient(sp).unsafe(memberReadSessionSettingsSql(timeoutMs, bindIdleTimeout));
      // @cast-boundary driver savepoint handle — structurally a DbTx, same shape runInSavepoint's caller relies on
      settled.outcome = { value: await fn(sp as DbTx) };
      // Always discarded: RELEASE SAVEPOINT would leave the outer tx read-only too.
      throw new SavepointDiscard();
    });
  } catch (e) {
    if (!(e instanceof SavepointDiscard)) throw e;
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
  const timeoutMs = ctx.memberReadTimeoutMs;
  try {
    if (tx) return await runInDiscardedReadOnlySavepoint(tx, timeoutMs, false, fn);
    const pool = resolveDbSource(ctx, undefined);
    if (!pool) {
      throw new InternalError({
        message: "ctx.queryAsMember requires a database connection — none is configured.",
      });
    }
    // Savepoint even on the pool path: Postgres rejects a READ WRITE reset (SQLSTATE 25001) inside a subtransaction.
    return await transaction(pool, (outer) =>
      // @cast-boundary driver begin() handle — structurally a DbTx, same shape runInSavepoint's caller relies on
      runInDiscardedReadOnlySavepoint(outer as DbTx, timeoutMs, true, fn),
    );
  } catch (e) {
    if (e instanceof AccessDeniedError) throw e;
    if (isReadOnlyTransactionViolation(e)) throw memberResolutionReadOnlyDenied(e);
    if (isStatementTimeout(e)) {
      throw new MemberReadTimeoutError({ timeoutMs, ...(e instanceof Error && { cause: e }) });
    }
    throw e;
  }
}
