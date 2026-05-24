// Bun.SQL-only createTestDb equivalent. KEIN postgres-js Import.
//
// Pattern: admin-Verbindung zum postgres-DB → CREATE DATABASE →
// Bun.SQL zur neuen DB → cleanup droppt die DB.
// Kein Drizzle, kein postgres-js, nur Bun.SQL(.unsafe).

import { generateId } from "../../utils";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";

export type BunTestDb = {
  db: Bun.SQL;
  dbName: string;
  cleanup: () => Promise<void>;
};

export async function createBunTestDb(
  baseUrl?: string,
): Promise<BunTestDb> {
  const url = baseUrl ?? DATABASE_URL;
  const dbName = `kumiko_test_${generateId().slice(-8)}`;
  const adminUrl = url.replace(/\/[^/]+$/, "/postgres");

  const admin = new Bun.SQL(adminUrl);
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const testUrl = url.replace(/\/[^/]+$/, `/${dbName}`);
  const db = new Bun.SQL(testUrl);

  return {
    db,
    dbName,
    cleanup: async () => {
      await db.end();
      const admin2 = new Bun.SQL(adminUrl);
      try {
        await admin2.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      } finally {
        await admin2.end();
      }
    },
  };
}
