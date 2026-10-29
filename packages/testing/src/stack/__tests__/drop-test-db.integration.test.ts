import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createDbConnection,
  databaseExists,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { adminUrlOf, createTestDb, dropTestDb, requireEnv } from "../db.ts";

describe("dropTestDb", () => {
  test("removes a persistent test database", async () => {
    const baseUrl = requireEnv("TEST_DATABASE_URL");
    const dbName = `kumiko_test_drop_${randomBytes(4).toString("hex")}`;
    const testDb = await createTestDb({ persistent: true, dbName });
    await testDb.cleanup();

    const admin = createDbConnection({ url: adminUrlOf(baseUrl), maxConnections: 1 });
    try {
      expect(await databaseExists(admin.db, dbName)).toBe(true);
      await dropTestDb(baseUrl, dbName);
      expect(await databaseExists(admin.db, dbName)).toBe(false);
    } finally {
      await admin.close();
    }
  });
});
