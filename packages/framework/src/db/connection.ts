// DB-Connection-Types: provider-agnostic via db/api.ts.
// createConnection delegiert an postgres-provider (default) oder bun-provider (DB_PROVIDER=bun).
import postgres from "postgres";
import { readPositiveIntEnv } from "../utils/env-parse";
export { createConnection, type DbConnectionOptions } from "./api";

// Legacy Types — für Aufrufer die direkt diese Module importieren
// biome-ignore lint/suspicious/noExplicitAny: Bun.SQL global type
export type DbConnection = ReturnType<typeof postgres> | any;
// biome-ignore lint/suspicious/noExplicitAny: postgres-js namespace lookup
export type DbTx = postgres.TransactionSql<any> | any;
export type DbRunner = DbConnection | DbTx;
export type DbRow = Record<string, unknown>;
export type PgClient = ReturnType<typeof postgres>;

export type PgListenClient = ReturnType<typeof postgres>;

// Legacy: postgres-js only. Neue Aufrufer: createConnection() aus api.ts.
export function createDbConnection(
  url: string,
  options: import("./api").DbConnectionOptions = {},
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
): import("./api").DbConnectionOptions {
  const opts: import("./api").DbConnectionOptions & {
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
