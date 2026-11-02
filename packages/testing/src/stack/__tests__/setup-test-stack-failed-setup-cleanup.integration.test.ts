// A throwing extraContext factory runs after the ephemeral DB and Redis exist; the caller never gets a
// stack back, so setupTestStack itself must drop them.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import { databaseExists } from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { adminUrlOf } from "../db.ts";
import { setupTestStack } from "../test-stack.ts";

describe("setupTestStack failed setup", () => {
  test("drops the ephemeral database when the extraContext factory throws", async () => {
    const baseUrl = process.env["TEST_DATABASE_URL"];
    if (!baseUrl) throw new Error("TEST_DATABASE_URL is required for this test");
    const dbName = `kumiko_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await expect(
      setupTestStack({
        features: [],
        dbName,
        extraContext: () => {
          throw new Error("extraContext exploded");
        },
      }),
    ).rejects.toThrow(/extraContext exploded/);

    const admin = createDbConnection({
      url: adminUrlOf(baseUrl),
      maxConnections: 1,
      rowLevelSecurity: "off",
    });
    try {
      expect(await databaseExists(admin.db, dbName)).toBe(false);
    } finally {
      await admin.close();
    }
  });
});
