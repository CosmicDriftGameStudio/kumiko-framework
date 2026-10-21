import type postgres from "postgres";

// Structural surface of a raw SQL client; test fakes and non-postgres runners implement it.
// Keep it typed: a union member with `any` signatures would erase the postgres side.
export type RawDbClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => PromiseLike<readonly unknown[]>;
  begin: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

// Raw SQL client (postgres-js instance or structurally compatible). Distinct from the
// framework's pool handle (`DbConnectionHandle` in db/connection.ts).
export type DbConnection = ReturnType<typeof postgres> | RawDbClient;
export type DbTx = postgres.TransactionSql<Record<string, unknown>> | RawDbClient;
export type DbRunner = DbConnection | DbTx;
export type DbRow = Record<string, unknown>;
export type PgClient = ReturnType<typeof postgres>;

export type PgListenSubscription = {
  unlisten(): Promise<void>;
};

// postgres-js re-issues LISTEN after a dropped connection and calls onlisten
// again then.
export type PgListenClient = {
  listen(
    channel: string,
    onnotify: (payload: string) => void,
    onlisten?: () => void,
  ): Promise<PgListenSubscription>;
};
