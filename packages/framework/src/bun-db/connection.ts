/// <reference types="bun-types" preserve="true" />
// Bun.SQL-basierter Connection-Layer (KEIN drizzle). Production-Pfad
// nach drizzle-removal. Erstellt parallel zum legacy `db/connection.ts`
// — apps migrieren schritt-für-schritt, alte Datei weg sobald 0 Konsumenten.
//
// LISTEN for the event dispatcher uses Bun.SQL's listen() on its own
// dedicated connection, outside the pool's idleTimeout.

import type { PgListenClient } from "@cosmicdrift/kumiko-types/db-connection";
import { readPositiveIntEnv } from "../utils/env-parse.js";

export type { PgListenClient };

// Bun.SQL ist callable als tagged template `sql\`...\`` PLUS hat methods
// (.begin / .unsafe / .end / .file / .reserve etc.). DbConnection-Type
// reflektiert die Instance-Shape.
export type BunDbConnection = InstanceType<typeof Bun.SQL>;

// Within sql.begin(async tx => {...}), tx hat dieselbe tagged-template-
// Shape + tx-spezifische Methods (savepoint, commit, rollback).
export type BunDbTx = BunDbConnection;

// Beide austauschbar im normalen call-path.
export type BunDbRunner = BunDbConnection | BunDbTx;

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

  return {
    db,
    listenClient: db,
    close: async () => {
      await db.end();
    },
  };
}

// guard:dup-ok — ENV-Reader für BunDB (gibt { db, listenClient } zurück), nicht verwandt mit redisClientOptionsFromEnv
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
