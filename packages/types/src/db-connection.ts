import type postgres from "postgres";

// Minimal structural surface of a raw SQL client (postgres-js) for
// asRawClient() / query helpers. Avoid `| any` — TS unions with `any`
// collapse to `any` and erase the postgres side entirely.
export type RawDbClient = {
  // Signatures are intentionally loose: postgres-js uses (string, values?),
  // Call sites go through asRawClient() which normalizes at runtime.
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider unsafe arity
  unsafe: (...args: any[]) => any;
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider begin arity
  begin: (...args: any[]) => any;
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
