import type postgres from "postgres";

// Minimal structural surface both postgres-js and Bun.SQL satisfy for
// asRawClient() / query helpers. Avoid `| any` — TS unions with `any`
// collapse to `any` and erase the postgres side entirely.
export type RawDbClient = {
  // Signatures are intentionally loose: postgres-js uses (string, values?),
  // Bun.SQL uses tagged templates / unsafe(string). Call sites go through
  // asRawClient() which normalizes at runtime.
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider unsafe arity
  unsafe: (...args: any[]) => any;
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider begin arity
  begin: (...args: any[]) => any;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

// Raw SQL client (postgres-js instance or Bun.SQL). Distinct from the
// framework's structural pool handle (`DbPoolHandle` in db/api.ts).
export type DbConnection = ReturnType<typeof postgres> | RawDbClient;
export type DbTx = postgres.TransactionSql<Record<string, unknown>> | RawDbClient;
export type DbRunner = DbConnection | DbTx;
export type DbRow = Record<string, unknown>;
export type PgClient = ReturnType<typeof postgres>;

export type PgListenSubscription = {
  unlisten(): Promise<void>;
};

// Driver-neutral LISTEN surface: postgres-js and Bun.SQL (>= 1.4.0) both
// re-issue LISTEN after a dropped connection and call onlisten again then.
export type PgListenClient = {
  listen(
    channel: string,
    onnotify: (payload: string) => void,
    onlisten?: () => void,
  ): Promise<PgListenSubscription>;
};
