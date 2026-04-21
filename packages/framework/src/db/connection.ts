import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readPositiveIntEnv } from "../utils/env-parse";

export type DbConnection = ReturnType<typeof drizzle>;

// Drizzle's transaction callback receives a tx handle with the same query API
// as the top-level DbConnection. Extracted via Parameters so we stay in sync
// with whatever Drizzle defines without hard-coding the internal type name.
export type DbTx = Parameters<Parameters<DbConnection["transaction"]>[0]>[0];

// Code paths that operate on either a connection or an active transaction
// (e.g. TenantDb, dispatcher pipeline) accept both.
export type DbRunner = DbConnection | DbTx;

// Dynamic Drizzle tables (buildDrizzleTable with `any` column schema) lose
// their per-column types at the Drizzle boundary. Query results come back as
// arbitrary records. `DbRow` marks those typing-loss sites so readers see the
// limitation without re-spelling `Record<string, unknown>` at every callsite.
// Use `DbRow` for rows read via dynamic tables; a concrete entity-row type
// is preferred whenever the table is statically typed.
export type DbRow = Record<string, unknown>;

// The raw postgres.js client. Exposed alongside the Drizzle wrapper so the
// event-dispatcher (or other components that need LISTEN / pg-specific
// features Drizzle doesn't surface) can subscribe without re-opening a
// connection from the URL.
export type PgClient = ReturnType<typeof postgres>;

// Connection-pool options — thin wrapper around the postgres.js fields the
// framework explicitly supports. Omitted keys fall back to postgres.js
// defaults (max=10, idle_timeout=PGIDLE_TIMEOUT env, connect_timeout=
// PGCONNECT_TIMEOUT env). See `docs/plans/architecture/scaling.md` for
// sizing guidance per deployment shape.
export type DbConnectionOptions = {
  // Max concurrent connections in the pool. postgres.js defaults to 10 —
  // fine for a single app process against a small DB. Multi-worker or
  // high-concurrency API deploys should scale this with `num_workers *
  // per-request-concurrency` and stay below the DB's own max_connections
  // (typical managed postgres: 100–400).
  readonly maxConnections?: number;
  // Seconds before an idle connection is closed. Null/undefined → keep
  // connections warm forever (postgres.js default when the env var is
  // unset). Managed pgBouncer tiers usually want this explicitly set to
  // something like 30–60 so a single burst doesn't hold connections
  // indefinitely.
  readonly idleTimeoutSeconds?: number;
  // Seconds to wait while establishing a new connection. Fails the query
  // with a timeout error rather than hanging indefinitely when the DB is
  // unreachable — critical for `/health/ready` to actually flip to 503
  // within its 2s probe budget.
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
  // Only forward fields the caller set — empty object otherwise preserves
  // postgres.js's env-var-driven defaults (PGIDLE_TIMEOUT / PGCONNECT_TIMEOUT).
  const pgOptions: Parameters<typeof postgres>[1] = {};
  if (options.maxConnections !== undefined) pgOptions.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) pgOptions.idle_timeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined) {
    pgOptions.connect_timeout = options.connectTimeoutSeconds;
  }

  const client = postgres(url, pgOptions);
  const db = drizzle(client);

  return {
    db,
    client,
    close: async () => {
      await client.end();
    },
  };
}

// Parse the supported env vars into a DbConnectionOptions object. Useful
// for a main.ts that wants to read DATABASE_POOL_MAX / DATABASE_POOL_
// IDLE_TIMEOUT / DATABASE_POOL_CONNECT_TIMEOUT without re-implementing
// the number-coercion + validation. Unrecognised / non-numeric values
// throw — misconfig surfaces at boot, not mid-request.
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
