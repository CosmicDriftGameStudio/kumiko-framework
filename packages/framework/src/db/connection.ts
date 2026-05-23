import postgres from "postgres";
import { readPositiveIntEnv } from "../utils/env-parse";

// DbConnection is the postgres-js Sql client. Native: it has `.unsafe()` +
// `.begin()` that bun-db's asRawClient expects.
export type DbConnection = ReturnType<typeof postgres>;

// Inside `.begin(async tx => {...})`, postgres-js hands the callback a
// TransactionSql — extends ISql so it has `.unsafe()` and `.begin()`
// (savepoint-aware) but lacks the pool-lifecycle methods (`.end()`, CLOSE,
// END constants). For framework call-sites we use TransactionSql directly.
// biome-ignore lint/suspicious/noExplicitAny: postgres-js namespace lookup
export type DbTx = postgres.TransactionSql<any>;

// Either a top-level connection or an active transaction. Framework code
// (TenantDb, dispatcher pipeline, event-store helpers) accepts both.
export type DbRunner = DbConnection | DbTx;

// Read-side rows are dynamic by definition — the framework doesn't know
// the per-entity column shape at compile time. `DbRow` marks the typing-
// loss sites so call sites either cast to a concrete row type or live
// with the erased shape explicitly.
export type DbRow = Record<string, unknown>;

// Re-exported alias kept for callers that previously imported PgClient
// from this module; it's the same postgres-js Sql instance.
export type PgClient = ReturnType<typeof postgres>;

export type DbConnectionOptions = {
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
};

export function createDbConnection(
  url: string,
  options: DbConnectionOptions = {},
): {
  db: DbConnection;
  client: PgClient;
  close: () => Promise<void>;
} {
  const pgOptions: Parameters<typeof postgres>[1] = {};
  if (options.maxConnections !== undefined) pgOptions.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) pgOptions.idle_timeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined) {
    pgOptions.connect_timeout = options.connectTimeoutSeconds;
  }

  const client = postgres(url, pgOptions);

  return {
    db: client,
    client,
    close: async () => {
      await client.end();
    },
  };
}

export function dbConnectionOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DbConnectionOptions {
  const opts: DbConnectionOptions & {
    maxConnections?: number;
    idleTimeoutSeconds?: number;
    connectTimeoutSeconds?: number;
  } = {};
  const max = readPositiveIntEnv(env, "DATABASE_POOL_MAX");
  const idle = readPositiveIntEnv(env, "DATABASE_POOL_IDLE_TIMEOUT");
  const connect = readPositiveIntEnv(env, "DATABASE_POOL_CONNECT_TIMEOUT");
  if (max !== undefined) opts.maxConnections = max;
  if (idle !== undefined) opts.idleTimeoutSeconds = idle;
  if (connect !== undefined) opts.connectTimeoutSeconds = connect;
  return opts;
}
