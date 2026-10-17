// Bun.SQL provider, opt-in via DB_PROVIDER=bun; postgres-js stays the default.
// Known bug (Bun <= 1.4.3, oven-sh/bun#29484): a cached plan is not re-prepared
// after DDL, so e.g. `SELECT *` after ADD COLUMN fails on that connection with
// 0A000 "cached plan must not change result type". prepare:false is no fix,
// it changes how jsonb params are bound.
//
// LISTEN runs on Bun.SQL's own dedicated connection, which is exempt from the
// pool's idleTimeout and maxLifetime and re-LISTENs after a drop.

import {
  type DbConnectionOptions,
  type DbPoolHandle,
  DEFAULT_DB_CLOSE_TIMEOUT_SECONDS,
} from "./api.js";

export function createBunConnection(url: string, options: DbConnectionOptions = {}): DbPoolHandle {
  const bunOpts: { max?: number; idleTimeout?: number; connectionTimeout?: number } = {};
  if (options.maxConnections !== undefined) bunOpts.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) bunOpts.idleTimeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined)
    bunOpts.connectionTimeout = options.connectTimeoutSeconds;
  const db = new Bun.SQL(url, bunOpts);

  const closeTimeout = options.closeTimeoutSeconds ?? DEFAULT_DB_CLOSE_TIMEOUT_SECONDS;
  return {
    db,
    client: db,
    listenClient: db,
    close: async () => {
      await db.end({ timeout: closeTimeout });
    },
  };
}
