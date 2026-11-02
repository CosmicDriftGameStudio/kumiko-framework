import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../db/query.ts";
import { tableExists } from "../../db/schema-inspection.ts";
import { createEsOperationsTable } from "../operations-schema.ts";

// API pods and workers of one app boot at the same time against a database that has no
// kumiko_es_operations yet; every process creates it on its first boot.
const BOOTING_PROCESSES = 8;

describe("createEsOperationsTable — concurrent boot", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  test("processes creating the table at the same time all succeed", async () => {
    await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "kumiko_es_operations"`);

    const results = await Promise.allSettled(
      Array.from({ length: BOOTING_PROCESSES }, () => createEsOperationsTable(testDb.db)),
    );

    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await tableExists(testDb.db, "public.kumiko_es_operations")).toBe(true);
  });
});

describe("createEsOperationsTable — small pools", () => {
  test.each([
    { poolMax: 1, callers: 1 },
    { poolMax: 2, callers: 4 },
  ])(
    "finishes with poolMax $poolMax and $callers concurrent callers",
    async ({ poolMax, callers }) => {
      const smallPoolDb = await createTestDb({ poolMax });
      try {
        await asRawClient(smallPoolDb.db).unsafe(`DROP TABLE IF EXISTS "kumiko_es_operations"`);
        const results = await Promise.allSettled(
          Array.from({ length: callers }, () => createEsOperationsTable(smallPoolDb.db)),
        );
        expect(results.filter((r) => r.status === "rejected")).toEqual([]);
        expect(await tableExists(smallPoolDb.db, "public.kumiko_es_operations")).toBe(true);
      } finally {
        await smallPoolDb.cleanup();
      }
    },
  );
});
