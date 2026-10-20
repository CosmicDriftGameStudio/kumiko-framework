import { openUnboundedSiblingPool, type PgClient } from "./connection.ts";

const UNBOUNDED_POOL_CLOSE_TIMEOUT_SECONDS = 5;

// Server pools cap statement_timeout (see serverTimeoutOptionsFromEnv); index builds, reindex,
// PII backfill and projection rebuilds legitimately run longer. The cap is a connect-time session
// setting, so the run gets its own short-lived pool with the same options minus the cap: one shared
// connection would deadlock code that holds a lock in a tx while its DDL runs on another connection.
// Handles not created by createDbConnection (tx, savepoint, siblings) are passed through.
export async function withoutStatementTimeout<R, T>(
  db: R,
  run: (db: R | PgClient) => Promise<T>,
): Promise<T> {
  const unbounded = openUnboundedSiblingPool(db);
  if (unbounded === undefined) return run(db);
  try {
    return await run(unbounded);
  } finally {
    await unbounded.end({ timeout: UNBOUNDED_POOL_CLOSE_TIMEOUT_SECONDS });
  }
}
