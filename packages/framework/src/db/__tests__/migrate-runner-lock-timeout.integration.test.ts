import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { MigrationLockTimeoutError, runMigrations } from "../migrate-runner.ts";
import { asRawClient } from "../query.ts";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "mig_lock_target"`);
  await asRawClient(testDb.db).unsafe(`CREATE TABLE "mig_lock_target" ("id" text PRIMARY KEY)`);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("runMigrations lock_timeout", () => {
  test("a migration blocked by a foreign table lock fails naming the migration", async () => {
    const holder = await asRawClient(testDb.db).reserve?.();
    if (holder === undefined) throw new Error("test pool offers no reserve()");
    await holder.unsafe("BEGIN");
    await holder.unsafe(`LOCK TABLE "mig_lock_target" IN ACCESS EXCLUSIVE MODE`);
    try {
      const error = await runMigrations(
        testDb.db,
        [
          {
            id: "0001_alter_locked",
            checksum: "lock-timeout-0001",
            statements: [`ALTER TABLE "mig_lock_target" ADD COLUMN "label" text`],
          },
        ],
        { lockTimeoutMs: 300 },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MigrationLockTimeoutError);
      expect(error instanceof Error ? error.message : "").toContain("0001_alter_locked");
    } finally {
      await holder.unsafe("ROLLBACK");
      await holder.release();
    }
    const tracked = await asRawClient(testDb.db).unsafe(
      `SELECT 1 FROM "_kumiko_migrations" WHERE id = '0001_alter_locked'`,
    );
    expect(tracked).toEqual([]);
  });
});
