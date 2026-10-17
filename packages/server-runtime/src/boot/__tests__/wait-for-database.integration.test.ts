import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-framework/stack";
import { waitForDatabase } from "../wait-for-database";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("waitForDatabase against real Postgres", () => {
  test("passes straight through without logging or sleeping", async () => {
    const logs: string[] = [];
    await waitForDatabase(testDb.db, {
      processName: "integration",
      log: (line) => logs.push(line),
      sleep: async () => {
        throw new Error("must not sleep when the database is reachable");
      },
    });
    expect(logs).toEqual([]);
  });
});
