// Bun.SQL provider, opt-in via DB_PROVIDER=bun; postgres-js stays the default.
// Known bug (Bun <= 1.4.3, oven-sh/bun#29484): a cached plan is not re-prepared
// after DDL, so e.g. `SELECT *` after ADD COLUMN fails on that connection with
// 0A000 "cached plan must not change result type". prepare:false is no fix,
// it changes how jsonb params are bound.
//
// The event dispatcher needs listen(channel, fn, onlisten) plus unlisten, which
// Bun.SQL.listen lacks, hence the postgres-js LISTEN peer.

import postgres from "postgres";
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

  // LISTEN peer — 1 connection reicht für NOTIFY-Wakeups
  const pgOpts: Parameters<typeof postgres>[1] = { max: 1 };
  if (options.idleTimeoutSeconds !== undefined) pgOpts.idle_timeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined)
    pgOpts.connect_timeout = options.connectTimeoutSeconds;
  const listenClient = postgres(url, pgOpts);

  const closeTimeout = options.closeTimeoutSeconds ?? DEFAULT_DB_CLOSE_TIMEOUT_SECONDS;
  return {
    db,
    client: listenClient,
    listenClient,
    close: async () => {
      await db.end({ timeout: closeTimeout });
      await listenClient.end({ timeout: closeTimeout });
    },
  };
}
