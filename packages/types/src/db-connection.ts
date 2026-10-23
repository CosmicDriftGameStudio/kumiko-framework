import type { SQL, TransactionSQL } from "bun";

// Structural surface of a raw SQL client; test fakes and non-Bun runners implement it.
// Keep it typed: a union member with `any` signatures would erase the Bun.SQL side.
export type RawDbClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => PromiseLike<readonly unknown[]>;
  begin: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

// Raw SQL client (Bun.SQL instance or structurally compatible). Distinct from the
// framework's pool handle (`DbConnectionHandle` in db/connection.ts).
export type DbConnection = SQL | RawDbClient;
export type DbTx = TransactionSQL | RawDbClient;
export type DbRunner = DbConnection | DbTx;
export type DbRow = Record<string, unknown>;
export type PgClient = SQL;

export type PgListenSubscription = {
  unlisten(): Promise<void>;
};

// Bun.SQL holds LISTEN on its own connection and calls onlisten again after
// every reconnect.
export type PgListenClient = {
  listen(
    channel: string,
    onnotify: (payload: string) => void,
    onlisten?: () => void,
  ): Promise<PgListenSubscription>;
};
