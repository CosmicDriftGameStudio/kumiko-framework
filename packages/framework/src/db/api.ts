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
  /** Provider Connection — Calls gehen über asRawClient() oder direkt. */
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider connection — postgres-js | Bun.SQL
  readonly db: any;
  /** Legacy postgres-js Client (für LISTEN peer) */
  // biome-ignore lint/suspicious/noExplicitAny: postgres-js client
  readonly client: any;
  /** Optionaler Bun.SQL LISTEN peer */
  // biome-ignore lint/suspicious/noExplicitAny: postgres-js LISTEN peer
  readonly listenClient?: any;
  /** Pool schliessen */
  close: () => Promise<void>;
};

let _provider: undefined | (() => Promise<typeof import("./postgres-provider")>);

export async function createConnection(
  url: string,
  options: DbConnectionOptions = {},
): Promise<DbConnection> {
  const p = process.env["DB_PROVIDER"];
  if (p === "bun" || p === "bun-sql") {
    const { createBunConnection } = await import("./bun-provider");
    return createBunConnection(url, options);
  }
  // postgres-js: sync, kein async import nötig
  const { createPgConnection } = await import("./postgres-provider");
  return createPgConnection(url, options);
}
