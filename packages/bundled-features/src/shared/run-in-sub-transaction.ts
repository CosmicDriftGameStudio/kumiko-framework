import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

// Per-unit sub-transaction (one user, one purged row), nesting-aware across both db shapes:
//   - top-level connection (Bun.SQL / postgres-js Sql) → `.begin` (BEGIN)
//   - TransactionSql (inside the dispatcher's outer tx, where every
//     writeHandler already runs) → `.savepoint` (SAVEPOINT)
// A TransactionSql has no `.begin`, so the previous unconditional `.begin`
// threw "is not a function" on every user when invoked through the dispatcher
// (the cron path) → zero deletions in production, while direct-connection tests
// stayed green. Selecting the available method makes the sub-tx work in both
// contexts; on throw the savepoint rolls back just this user (others survive).
export async function runInSubTransaction<T>(
  db: DbRunner,
  fn: (tx: DbRunner) => Promise<T>,
): Promise<T> {
  // `db` is already the raw runner (the handler passes ctx.db.unsafeRaw(...),
  // the tests a top-level connection) — cast to read the transaction surface directly,
  // without asRawClient (a test-only escape hatch).
  const runner = db as {
    begin?: (f: (tx: DbRunner) => Promise<T>) => Promise<T>;
    savepoint?: (f: (tx: DbRunner) => Promise<T>) => Promise<T>;
  };
  // savepoint-first: empirically (Bun 1.3.14, not re-checked on 1.4.0) the
  // surfaces are NOT mutually exclusive — a TransactionSql exposes begin AND
  // savepoint, only the top-level connection has begin alone. begin-first
  // picked the nested BEGIN inside a tx (the incident class above);
  // savepoint-first hits the savepoint there and falls back to begin top-level.
  const open = runner.savepoint ?? runner.begin;
  if (!open) {
    throw new Error(
      "runInSubTransaction: db exposes neither .begin nor .savepoint — cannot open a sub-transaction",
    );
  }
  return open.call(runner, fn);
}
