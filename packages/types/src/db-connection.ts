import type postgres from "postgres";

// Minimal structural surface both postgres-js and Bun.SQL satisfy for
// asRawClient() / query helpers. Avoid `| any` — TS unions with `any`
// collapse to `any` and erase the postgres side entirely.
export type RawDbClient = {
  // postgres-js: unsafe(string, values?); Bun.SQL: unsafe(string) / tagged
  unsafe: (...args: never[]) => unknown;
  begin: <T>(fn: (tx: RawDbClient) => Promise<T>) => Promise<T>;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

// Raw SQL client (postgres-js instance or Bun.SQL). Distinct from the
// framework's structural pool handle (`DbPoolHandle` in db/api.ts).
export type DbConnection = ReturnType<typeof postgres> | RawDbClient;
export type DbTx = postgres.TransactionSql<Record<string, unknown>> | RawDbClient;
export type DbRunner = DbConnection | DbTx;
export type DbRow = Record<string, unknown>;
export type PgClient = ReturnType<typeof postgres>;

export type PgListenClient = ReturnType<typeof postgres>;
