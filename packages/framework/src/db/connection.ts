import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type DbConnection = ReturnType<typeof drizzle>;

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
