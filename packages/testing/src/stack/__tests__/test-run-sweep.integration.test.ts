import { describe, expect, test } from "bun:test";
import {
  createDatabase,
  createDbConnection,
  databaseExists,
  dropDatabaseIfExists,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Redis } from "ioredis";
import { adminUrlOf, databaseUrlOf, requireEnv, testDbTemplatePrefix } from "../db.ts";
import { createTestRunId, sweepFinishedTestRuns, testRunAliveKey } from "../test-run.ts";

describe("sweepFinishedTestRuns", () => {
  test("removes the own run and runs without an alive key, keeps live runs, legacy and foreign data", async () => {
    const redisUrl = requireEnv("REDIS_URL");
    const adminDatabaseUrl = adminUrlOf(requireEnv("TEST_DATABASE_URL"));
    const [ownRun, deadRun, liveRun] = [createTestRunId(), createTestRunId(), createTestRunId()];
    const removedKeys = [
      `kt:${ownRun}:stack1:rate`,
      `bull:kt-${ownRun}-stack1-api:meta`,
      `kt:${deadRun}:stack2:rate`,
      `bull:kt-${deadRun}-chat-1a2b3c4d-worker:id`,
    ];
    const keptKeys = [
      testRunAliveKey(liveRun),
      `kt:${liveRun}:stack3:rate`,
      `bull:kt-${liveRun}-stack3-api:meta`,
      `kt:${generateId().slice(-8)}:legacy`,
      `foreign-${generateId()}:key`,
    ];
    const deadDb = `kumiko_test_${deadRun}_${generateId().slice(-8)}`;
    const deadDbInUse = `kumiko_test_${deadRun}_${generateId().slice(-8)}`;
    const ownTemplateDb = `${testDbTemplatePrefix(ownRun)}fingerprint`;
    const liveDb = `kumiko_test_${liveRun}_${generateId().slice(-8)}`;
    const databases = [deadDb, deadDbInUse, ownTemplateDb, liveDb];

    const redis = new Redis(redisUrl);
    const admin = createDbConnection({
      url: adminDatabaseUrl,
      maxConnections: 1,
      rowLevelSecurity: "off",
    });
    let inUse: ReturnType<typeof createDbConnection> | undefined;
    try {
      await Promise.all([...removedKeys, ...keptKeys].map((key) => redis.set(key, "1", "EX", 600)));
      for (const name of databases) await createDatabase(admin.db, name);
      inUse = createDbConnection({
        url: databaseUrlOf(requireEnv("TEST_DATABASE_URL"), deadDbInUse),
        maxConnections: 1,
        rowLevelSecurity: "off",
      });
      // Any query holds the pool connection open, which is what blocks DROP DATABASE.
      await databaseExists(inUse.db, deadDbInUse);

      await sweepFinishedTestRuns({ runId: ownRun, redisUrl, adminDatabaseUrl });

      expect(await redis.exists(...removedKeys)).toBe(0);
      expect(await redis.exists(...keptKeys)).toBe(keptKeys.length);
      expect(await databaseExists(admin.db, deadDb)).toBe(false);
      expect(await databaseExists(admin.db, ownTemplateDb)).toBe(false);
      expect(await databaseExists(admin.db, deadDbInUse)).toBe(true);
      expect(await databaseExists(admin.db, liveDb)).toBe(true);
    } finally {
      await inUse?.close();
      for (const name of databases) await dropDatabaseIfExists(admin.db, name);
      await admin.close();
      await redis.del(...removedKeys, ...keptKeys);
      redis.disconnect();
    }
  });
});
