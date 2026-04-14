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

export function createDbConnection(url: string): {
  db: DbConnection;
  close: () => Promise<void>;
} {
  const client = postgres(url);
  const db = drizzle(client);

  return {
    db,
    close: async () => {
      await client.end();
    },
  };
}
