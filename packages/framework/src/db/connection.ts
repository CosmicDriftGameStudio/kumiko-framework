import type { DbConnection, PgClient } from "@cosmicdrift/kumiko-types/db-connection";
import postgres from "postgres";
import { readPositiveIntEnv } from "../utils/env-parse.js";

export type * from "@cosmicdrift/kumiko-types/db-connection";

type PostgresDriverOptions = NonNullable<Parameters<typeof postgres>[1]>;

export type DbConnectionOptions = {
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  readonly closeTimeoutSeconds?: number;
  readonly ssl?: PostgresDriverOptions["ssl"];
  readonly onNotice?: (notice: postgres.Notice) => void;
};

export type CreateDbConnectionOptions = DbConnectionOptions & { readonly url: string };

export type DbConnectionHandle = {
  db: DbConnection;
  client: PgClient;
  close: () => Promise<void>;
};

// A DB outage can leave an in-flight query referenced on a dead connection,
// so a plain end() (no timeout = wait for queries to finish) hangs forever —
// close() must always bound how long shutdown waits.
export const DEFAULT_DB_CLOSE_TIMEOUT_SECONDS = 5;

export function createDbConnection({
  url,
  ...options
}: CreateDbConnectionOptions): DbConnectionHandle {
  const pgOptions: PostgresDriverOptions = {};
  if (options.maxConnections !== undefined) pgOptions.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) {
    pgOptions.idle_timeout = options.idleTimeoutSeconds;
  }
  if (options.connectTimeoutSeconds !== undefined) {
    pgOptions.connect_timeout = options.connectTimeoutSeconds;
  }
  if (options.ssl !== undefined) pgOptions.ssl = options.ssl;
  if (options.onNotice !== undefined) pgOptions.onnotice = options.onNotice;

  const client = postgres(url, pgOptions);

  return {
    db: client,
    client,
    close: () =>
      client.end({
        timeout: options.closeTimeoutSeconds ?? DEFAULT_DB_CLOSE_TIMEOUT_SECONDS,
      }),
  };
}

// DB_PROVIDER=bun selected the removed Bun.SQL driver; ignoring it would boot
// postgres-js under a config that still claims Bun.SQL.
function assertNoRemovedDbProvider(env: Readonly<Record<string, string | undefined>>): void {
  const provider = env["DB_PROVIDER"];
  if (provider === undefined || provider === "" || provider === "postgres") return;
  throw new Error(
    `DB_PROVIDER="${provider}" is no longer supported: postgres-js is the only driver. Remove DB_PROVIDER from the environment.`,
  );
}

export function dbConnectionOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DbConnectionOptions {
  assertNoRemovedDbProvider(env);
  const opts: {
    -readonly [K in keyof DbConnectionOptions]: DbConnectionOptions[K];
  } = {};
  const max = readPositiveIntEnv(env, "DATABASE_POOL_MAX");
  const idle = readPositiveIntEnv(env, "DATABASE_POOL_IDLE_TIMEOUT");
  const connect = readPositiveIntEnv(env, "DATABASE_POOL_CONNECT_TIMEOUT");
  if (max !== undefined) opts.maxConnections = max;
  if (idle !== undefined) opts.idleTimeoutSeconds = idle;
  if (connect !== undefined) opts.connectTimeoutSeconds = connect;
  return opts;
}

// Outside-tx access runs on its own pool: sharing the write pool deadlocks once
// pool-max concurrent writes each hold a tx and then wait for a second connection.
export const DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX = 3;

export function outsideTransactionPoolOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DbConnectionOptions {
  return {
    ...dbConnectionOptionsFromEnv(env),
    maxConnections:
      readPositiveIntEnv(env, "DATABASE_OUTSIDE_TX_POOL_MAX") ??
      DEFAULT_OUTSIDE_TRANSACTION_POOL_MAX,
  };
}
