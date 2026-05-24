import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb, unsafePushTables } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { fileRefsTable } from "../file-ref-table";

let testDb: TestDb;
beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafePushTables(testDb.db, { fileRefsTable });
});
afterAll(async () => {
  await testDb.cleanup();
});
describe("probe", () => {
  test("ok", () => expect(1).toBe(1));
});
