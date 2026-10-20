import type { DbConnection, PgClient } from "@cosmicdrift/kumiko-types/db-connection";
import postgres from "postgres";
import { readPositiveIntEnv } from "../utils/env-parse.ts";

export type * from "@cosmicdrift/kumiko-types/db-connection";

type PostgresDriverOptions = NonNullable<Parameters<typeof postgres>[1]>;

export type DbConnectionOptions = {
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  readonly closeTimeoutSeconds?: number;
  readonly ssl?: PostgresDriverOptions["ssl"];
  readonly onNotice?: (notice: postgres.Notice) => void;
  // Postgres session parameters sent at connect time; 0 disables the limit.
  readonly statementTimeoutMs?: number;
  readonly idleInTransactionSessionTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
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

export type UnboundedSiblingPool = {
  readonly client: PgClient;
  readonly close: (timeoutSeconds: number) => Promise<void>;
};

// Keyed by the pool so withoutStatementTimeout can open a sibling with identical connect options.
const unboundedSiblingFactories = new WeakMap<object, () => UnboundedSiblingPool>();

export function openUnboundedSiblingPool(db: unknown): UnboundedSiblingPool | undefined {
  if (typeof db !== "function" && (typeof db !== "object" || db === null)) return undefined;
  return unboundedSiblingFactories.get(db)?.();
}

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
  const serverParameters: Record<string, number> = {};
  if (options.statementTimeoutMs !== undefined) {
    serverParameters["statement_timeout"] = options.statementTimeoutMs;
  }
  if (options.idleInTransactionSessionTimeoutMs !== undefined) {
    serverParameters["idle_in_transaction_session_timeout"] =
      options.idleInTransactionSessionTimeoutMs;
  }
  if (options.lockTimeoutMs !== undefined) serverParameters["lock_timeout"] = options.lockTimeoutMs;
  if (Object.keys(serverParameters).length > 0) pgOptions.connection = serverParameters;

  const client = postgres(url, pgOptions);
  // A run that never settles (a caller gave up on it via its own timeout) never reaches the
  // sibling's own close; close() ends it so shutdown and DROP DATABASE are not blocked by it.
  const openSiblings = new Set<PgClient>();
  unboundedSiblingFactories.set(client, () => {
    // Two connections are enough for lock-in-tx plus DDL; the cap keeps parallel rebuilds from exhausting max_connections.
    const sibling = postgres(url, {
      ...pgOptions,
      max: 4,
      connection: { ...pgOptions.connection, statement_timeout: 0 },
    });
    openSiblings.add(sibling);
    return {
      client: sibling,
      close: async (timeoutSeconds) => {
        openSiblings.delete(sibling);
        await sibling.end({ timeout: timeoutSeconds });
      },
    };
  });

  return {
    db: client,
    client,
    close: async () => {
      const timeout = options.closeTimeoutSeconds ?? DEFAULT_DB_CLOSE_TIMEOUT_SECONDS;
      unboundedSiblingFactories.delete(client);
      const pools = [client, ...openSiblings];
      openSiblings.clear();
      const results = await Promise.allSettled(pools.map((pool) => pool.end({ timeout })));
      const failure = results.find((result) => result.status === "rejected");
      if (failure !== undefined) throw failure.reason;
    },
  };
}

// DB_PROVIDER=bun selected the removed Bun.SQL driver; ignoring it would boot
// postgres-js under a config that still claims Bun.SQL.
function assertNoRemovedDbProvider(env: Readonly<Record<string, string | undefined>>): void {
  const provider = env["DB_PROVIDER"];
  if (provider !== undefined && provider !== "" && provider !== "postgres") {
    throw new Error(
      `DB_PROVIDER="${provider}" is no longer supported: postgres-js is the only driver. Remove DB_PROVIDER from the environment.`,
    );
  }
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

export const DEFAULT_SERVER_STATEMENT_TIMEOUT_MS = 60_000;
// Handlers that await external calls inside a tx must not be killed; five minutes still ends leaked transactions.
export const DEFAULT_SERVER_IDLE_IN_TRANSACTION_TIMEOUT_MS = 300_000;

// Long-running servers (prod app, worker) bound runaway statements and tx held
// open by a stuck handler; one-shot CLIs keep the unbounded driver default.
export function serverTimeoutOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DbConnectionOptions {
  const lockTimeoutMs = readPositiveIntEnv(env, "DATABASE_LOCK_TIMEOUT_MS");
  return {
    statementTimeoutMs:
      readPositiveIntEnv(env, "DATABASE_STATEMENT_TIMEOUT_MS") ??
      DEFAULT_SERVER_STATEMENT_TIMEOUT_MS,
    idleInTransactionSessionTimeoutMs:
      readPositiveIntEnv(env, "DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS") ??
      DEFAULT_SERVER_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    ...(lockTimeoutMs !== undefined && { lockTimeoutMs }),
  };
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
