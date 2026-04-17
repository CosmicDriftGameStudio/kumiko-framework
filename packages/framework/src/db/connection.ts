import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

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

export function createDbConnection(url: string): {
  db: DbConnection;
  client: PgClient;
  close: () => Promise<void>;
} {
  const client = postgres(url);
  const db = drizzle(client);

  return {
    db,
    client,
    close: async () => {
      await client.end();
    },
  };
}
