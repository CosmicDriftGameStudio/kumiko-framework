import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { TestUsers } from "../../seeding/seed-users.ts";
import { asRawClient, runInSavepoint, runInSavepointIfSupported, transaction } from "../query.ts";
import { createTenantDb, withExecutorManagedWrites } from "../tenant-db.ts";
import { tenantDbRunner } from "../tenant-db-runner.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

// Bun.SQL lets savepoints on one transaction overlap; the helpers must run them one at a time
// while savepoints opened from inside a running one still nest without waiting for it.

let testDb: BunTestDb;

async function insertAfterPause(runner: unknown, value: string, pauseSeconds: number) {
  const raw = asRawClient(runner);
  await raw.unsafe("SELECT pg_sleep($1)", [pauseSeconds]);
  await raw.unsafe("INSERT INTO psp_rows (value) VALUES ($1)", [value]);
}

async function committedValues(): Promise<string[]> {
  const rows = await asRawClient(testDb.db).unsafe<{ value: string }>(
    "SELECT value FROM psp_rows ORDER BY value",
  );
  return rows.map((row) => row.value);
}

beforeAll(async () => {
  testDb = await createTestDb();
  await asRawClient(testDb.db).unsafe("CREATE TABLE IF NOT EXISTS psp_rows (value text NOT NULL)");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe("TRUNCATE psp_rows");
});

describe("savepoints opened in parallel on one transaction", () => {
  test("all of them commit, the first to finish no longer releases the others", async () => {
    await transaction(testDb.db, async (tx) => {
      await Promise.all(
        ["a", "b", "c", "d"].map((value, index) =>
          runInSavepoint(tx, (sp) => insertAfterPause(sp, value, 0.02 * (4 - index))),
        ),
      );
    });

    expect(await committedValues()).toEqual(["a", "b", "c", "d"]);
  });

  test("a failing savepoint rolls back only its own rows", async () => {
    await transaction(testDb.db, async (tx) => {
      const results = await Promise.allSettled([
        runInSavepointIfSupported(tx, (sp) => insertAfterPause(sp, "kept-1", 0.03)),
        runInSavepointIfSupported(tx, async (sp) => {
          await insertAfterPause(sp, "discarded", 0);
          await asRawClient(sp).unsafe("SELECT 1 FROM psp_no_such_table");
        }),
        runInSavepointIfSupported(tx, (sp) => insertAfterPause(sp, "kept-2", 0.01)),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "rejected",
        "fulfilled",
      ]);
    });

    expect(await committedValues()).toEqual(["kept-1", "kept-2"]);
  });

  test("proxy runners over the same transaction share one queue", async () => {
    const tenantId = TestUsers.admin.tenantId;
    await transaction(testDb.db, async (tx) => {
      const gatedRunner = tenantDbRunner(createTenantDb({ db: tx, tenantId }));
      await Promise.all([
        runInSavepoint(tx, (sp) => insertAfterPause(sp, "raw", 0.03)),
        runInSavepointIfSupported(withExecutorManagedWrites(gatedRunner), (sp) =>
          insertAfterPause(sp, "capable", 0.01),
        ),
        runInSavepointIfSupported(gatedRunner, (sp) => insertAfterPause(sp, "gated", 0)),
      ]);
    });

    expect(await committedValues()).toEqual(["capable", "gated", "raw"]);
  });

  test("savepoints opened inside a savepoint nest, also through the outer handle", async () => {
    await transaction(testDb.db, async (tx) => {
      await Promise.all([
        runInSavepoint(tx, async (outer) => {
          await Promise.all([
            runInSavepoint(outer, (sp) => insertAfterPause(sp, "inner-on-sp", 0.02)),
            runInSavepoint(tx, (sp) => insertAfterPause(sp, "inner-on-tx", 0)),
          ]);
        }),
        runInSavepoint(tx, (sp) => insertAfterPause(sp, "sibling", 0)),
      ]);
    });

    expect(await committedValues()).toEqual(["inner-on-sp", "inner-on-tx", "sibling"]);
  });
});
