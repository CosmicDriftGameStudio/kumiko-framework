import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v4 as uuid } from "uuid";

const DEFAULT_TEST_URL = "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";

export type TestDb = {
  db: ReturnType<typeof drizzle>;
  client: ReturnType<typeof postgres>;
  dbName: string;
  cleanup: () => Promise<void>;
};

export async function createTestDb(
  baseUrl: string = process.env["TEST_DATABASE_URL"] ?? DEFAULT_TEST_URL,
): Promise<TestDb> {
  const dbName = `kumiko_test_${uuid().slice(0, 8)}`;
  const adminUrl = baseUrl.replace(/\/[^/]+$/, "/postgres");

  const adminClient = postgres(adminUrl);
  await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);
  await adminClient.end();

  const testUrl = baseUrl.replace(/\/[^/]+$/, `/${dbName}`);
  const client = postgres(testUrl);
  const db = drizzle(client);

  return {
    db,
    client,
    dbName,
    cleanup: async () => {
      await client.end();
      const admin = postgres(adminUrl);
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      } finally {
        await admin.end();
      }
    },
  };
}

export async function createTestTable(
  db: ReturnType<typeof drizzle>,
  tableSql: string,
): Promise<void> {
  await db.execute(sql.raw(tableSql));
}
