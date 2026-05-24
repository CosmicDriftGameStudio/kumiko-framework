// PostgreSQL Provider: postgres-js.
// Standard-Provider — stabil, keine bekannten Protocol-Level-Bugs.
// `asRawClient(db)` wrappt .unsafe und .begin transparent.

import postgres from "postgres";
import type { DbConnection, DbConnectionOptions } from "./api";

export function createPgConnection(
  url: string,
  options: DbConnectionOptions = {},
): DbConnection {
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
