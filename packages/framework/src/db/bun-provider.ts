// Bun.SQL Provider — experimentell.
// Default: postgres-js. Dieser Provider nur aktiv wenn DB_PROVIDER=bun.
// Bekannter Bug: Extended-Query-Protocol Caching verursacht
// PostgresError "bind message has 11 result formats but query has 1 columns"
// bei sequentiellen Queries mit unterschiedlicher Spaltenzahl innerhalb
// derselben Connection.
//
// Bun.SQL hat kein LISTEN — postgres-js-Peer für event-dispatcher.

import postgres from "postgres";
import type { DbConnection, DbConnectionOptions } from "./api";

export function createBunConnection(url: string, options: DbConnectionOptions = {}): DbConnection {
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

  return {
    db,
    client: listenClient,
    listenClient,
    close: async () => {
      await db.end();
      await listenClient.end();
    },
  };
}
