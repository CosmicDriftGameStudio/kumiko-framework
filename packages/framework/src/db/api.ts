// DB-API: Unified Types und Connection-Factory.
// Provider-agnostic code verwendet ausschliesslich diese Types.
// Provider-Implementierungen: postgres-provider.ts, bun-provider.ts.
//
// `asRawClient(db)` aus bun-db/query.ts normalisiert beide Provider
// zu { unsafe, begin } — business code ist provider-neutral.
//
// Default: postgres-js. Set DB_PROVIDER=bun für Bun.SQL (experimentell).

import type { PgListenClient } from "@cosmicdrift/kumiko-types/db-connection";

export type DbConnectionOptions = {
  readonly maxConnections?: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  readonly closeTimeoutSeconds?: number;
};

// A DB outage can leave an in-flight query referenced on a dead connection,
// so a plain end() (no timeout = wait for queries to finish) hangs forever —
// close() must always bound how long shutdown waits.
export const DEFAULT_DB_CLOSE_TIMEOUT_SECONDS = 5;

// Connection handle: db for queries, client as the raw driver client (also used
// for LISTEN/NOTIFY), close for pool shutdown.
export type DbPoolHandle = {
  /** Provider Connection — Calls gehen über asRawClient() oder direkt. */
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider connection — postgres-js | Bun.SQL
  readonly db: any;
  /** Raw driver client (postgres-js or Bun.SQL) */
  // biome-ignore lint/suspicious/noExplicitAny: cross-provider client — postgres-js | Bun.SQL
  readonly client: any;
  /** LISTEN-capable client; Bun.SQL serves it from its own dedicated connection */
  readonly listenClient?: PgListenClient;
  /** Pool schliessen */
  close: () => Promise<void>;
};

let _provider: undefined | (() => Promise<typeof import("./postgres-provider.js")>);

export async function createConnection(
  url: string,
  options: DbConnectionOptions = {},
): Promise<DbPoolHandle> {
  const p = process.env["DB_PROVIDER"];
  if (p === "bun" || p === "bun-sql") {
    const { createBunConnection } = await import("./bun-provider.js");
    return createBunConnection(url, options);
  }
  // postgres-js: sync, kein async import nötig
  const { createPgConnection } = await import("./postgres-provider.js");
  return createPgConnection(url, options);
}
