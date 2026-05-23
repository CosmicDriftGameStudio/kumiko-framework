// Bun.SQL-basierter Connection-Layer (KEIN drizzle). Production-Pfad
// nach drizzle-removal. Erstellt parallel zum legacy `db/connection.ts`
// — apps migrieren schritt-für-schritt, alte Datei weg sobald 0 Konsumenten.
//
// **postgres-js** bleibt als kleiner Peer NUR für LISTEN/NOTIFY in
// event-dispatcher.ts. Bun.sql 1.2.20 hat kein listen() (PR oven-sh/bun#25511
// pending). Nach Landung des Bun-LISTEN-Supports: peer raus.

import postgres from "postgres";
import { readPositiveIntEnv } from "../utils/env-parse";

// Bun.SQL ist callable als tagged template `sql\`...\`` PLUS hat methods
// (.begin / .unsafe / .end / .file / .reserve etc.). DbConnection-Type
// reflektiert die Instance-Shape.
export type BunDbConnection = InstanceType<typeof Bun.SQL>;

// Within sql.begin(async tx => {...}), tx hat dieselbe tagged-template-
// Shape + tx-spezifische Methods (savepoint, commit, rollback).
export type BunDbTx = BunDbConnection;

// Beide austauschbar im normalen call-path.
export type BunDbRunner = BunDbConnection | BunDbTx;

// Postgres-js peer NUR für event-dispatcher LISTEN.
export type PgListenClient = ReturnType<typeof postgres>;

export type BunDbConnectionOptions = {
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
};

export function createBunDbConnection(
  url: string,
  options: BunDbConnectionOptions = {},
): {
  db: BunDbConnection;
  listenClient: PgListenClient;
  close: () => Promise<void>;
} {
  const bunOpts: { max?: number; idleTimeout?: number; connectionTimeout?: number } = {};
  if (options.maxConnections !== undefined) bunOpts.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) bunOpts.idleTimeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined) {
    bunOpts.connectionTimeout = options.connectTimeoutSeconds;
  }
  const db = new Bun.SQL(url, bunOpts);

  // LISTEN-only peer — minimal pool (1 connection reicht), eigener idle/
  // connect-timeout falls gesetzt. Wenn das wegfällt, läuft event-dispatcher
  // auf polling-only ohne LISTEN-Wakeup.
  const pgOpts: Parameters<typeof postgres>[1] = { max: 1 };
  if (options.idleTimeoutSeconds !== undefined) pgOpts.idle_timeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined) {
    pgOpts.connect_timeout = options.connectTimeoutSeconds;
  }
  const listenClient = postgres(url, pgOpts);

  return {
    db,
    listenClient,
    close: async () => {
      await db.end();
      await listenClient.end();
    },
  };
}

export function bunDbConnectionOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BunDbConnectionOptions {
  const opts: BunDbConnectionOptions & {
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
