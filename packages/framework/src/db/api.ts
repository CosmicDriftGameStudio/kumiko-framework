// DB-API: Unified Types und Connection-Factory.
// Provider-agnostic code verwendet ausschliesslich diese Types.
// Provider-Implementierungen: postgres-provider.ts, bun-provider.ts.
//
// `asRawClient(db)` aus bun-db/query.ts normalisiert beide Provider
// zu { unsafe, begin } — business code ist provider-neutral.
//
// Default: postgres-js. Set DB_PROVIDER=bun für Bun.SQL (experimentell).

export type DbConnectionOptions = {
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
};

// Connection-Handle: db für Queries, client für Legacy-Zugriff (LISTEN/NOTIFY-Peer
// bei Bun.SQL), close für Pool-Shutdown.
export type DbConnection = {
  /** Provider Connection — leerer Handle, Calls über asRawClient() */
  readonly db: unknown;
  /** Legacy postgres-js Client (für LISTEN peer) */
  readonly client: unknown;
  /** Optionaler Bun.SQL LISTEN peer */
  readonly listenClient?: unknown;
  /** Pool schliessen */
  close: () => Promise<void>;
};

import { createPgConnection } from "./postgres-provider";

export async function createConnection(
  url: string,
  options: DbConnectionOptions = {},
): Promise<DbConnection> {
  const p = process.env["DB_PROVIDER"];
  if (p === "bun" || p === "bun-sql") {
    const { createBunConnection } = await import("./bun-provider");
    return createBunConnection(url, options);
  }
  return createPgConnection(url, options);
}
