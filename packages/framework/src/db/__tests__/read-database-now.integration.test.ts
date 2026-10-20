import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers } from "../../seeding/seed-users.ts";
import { readDatabaseNow } from "../queries/database-now.ts";
import { asRawClient, transaction } from "../query.ts";
import { createTenantDb } from "../tenant-db.ts";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("readDatabaseNow", () => {
  test("returns the database time as a Date", async () => {
    const before = Date.now();
    const now = await readDatabaseNow(
      createTenantDb({ db: testDb.db, tenantId: TestUsers.admin.tenantId }),
    );
    expect(now).toBeInstanceOf(Date);
    expect(Math.abs(now.getTime() - before)).toBeLessThan(5_000);
  });

  test("is the transaction start: two reads in one transaction agree", async () => {
    const [first, second] = await transaction(testDb.db, async (tx) => {
      const db = createTenantDb({ db: tx, tenantId: TestUsers.admin.tenantId });
      const earlier = await readDatabaseNow(db);
      await asRawClient(tx).unsafe("SELECT pg_sleep(0.05)");
      return [earlier, await readDatabaseNow(db)];
    });
    expect(first?.getTime()).toBe(second?.getTime());
  });
});
