import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { DbConnection } from "./connection";
import type { DbAdapter } from "./types";

export type PgAdapterOptions = {
  url: string;
};

export function createPgAdapter(options: PgAdapterOptions): DbAdapter {
  let client: ReturnType<typeof postgres> | null = null;
  let db: DbConnection | null = null;

  return {
    async connect() {
      client = postgres(options.url);
      db = drizzle(client);
    },

    async close() {
      if (client) {
        await client.end();
        client = null;
        db = null;
      }
    },

    getConnection() {
      if (!db) throw new Error("Database not connected. Call connect() first.");
      return db;
    },
  };
}
