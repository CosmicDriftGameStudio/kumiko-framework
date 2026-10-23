// deleteMany reports the driver's affected-row count: no RETURNING, also inside transactions
// and through a tenant-scoped handle.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../../seeding/seed-users.ts";
import { asRawClient, countWhere, deleteMany, insertMany, transaction } from "../../query.ts";
import { createTenantDb } from "../../tenant-db.ts";
import { runInOwnTransaction } from "../../tenant-db-scoped-rebind.ts";
import { makeTableMeta, renderCreateTable, uniqueTableName } from "./_helpers.ts";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);

async function withTenantTable<T>(
  fn: (ctx: { db: TestDb["db"]; meta: ReturnType<typeof makeTableMeta> }) => Promise<T>,
): Promise<T> {
  const db = testDb.db;
  const meta = makeTableMeta(uniqueTableName("delcount"), [
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "score", pgType: "integer", notNull: true, defaultSql: "0" },
  ]);
  await asRawClient(db).unsafe(renderCreateTable(meta));
  try {
    return await fn({ db, meta });
  } finally {
    await asRawClient(db).unsafe(`DROP TABLE IF EXISTS "${meta.tableName}"`);
  }
}

describe("deleteMany count", () => {
  test("is 0 for no match, 1 for one row and n for several", async () => {
    await withTenantTable(async ({ db, meta }) => {
      await insertMany(db, meta, [
        { tenantId: tenantA, score: 1 },
        { tenantId: tenantA, score: 2 },
        { tenantId: tenantA, score: 2 },
        { tenantId: tenantA, score: 2 },
      ]);

      expect(await deleteMany(db, meta, { score: 99 })).toBe(0);
      expect(await deleteMany(db, meta, { score: 1 })).toBe(1);
      expect(await deleteMany(db, meta, { score: 2 })).toBe(3);
      expect(await countWhere(db, meta)).toBe(0);
    });
  });

  test("is exact inside a transaction and reflects a rollback", async () => {
    await withTenantTable(async ({ db, meta }) => {
      await insertMany(db, meta, [
        { tenantId: tenantA, score: 7 },
        { tenantId: tenantA, score: 7 },
      ]);

      const counts = await transaction(db, async (tx) => [
        await deleteMany(tx, meta, { score: 7 }),
        await deleteMany(tx, meta, { score: 7 }),
      ]);
      expect(counts).toEqual([2, 0]);

      await insertMany(db, meta, [{ tenantId: tenantA, score: 8 }]);
      await transaction(db, async (tx) => {
        expect(await deleteMany(tx, meta, { score: 8 })).toBe(1);
        throw new Error("roll back");
      }).catch(() => undefined);
      expect(await countWhere(db, meta, { score: 8 })).toBe(1);
    });
  });

  test("a tenant-scoped handle counts only its own tenant's rows, in and out of a transaction", async () => {
    await withTenantTable(async ({ db, meta }) => {
      await insertMany(db, meta, [
        { tenantId: tenantA, score: 5 },
        { tenantId: tenantA, score: 5 },
        { tenantId: tenantB, score: 5 },
      ]);
      const tenantDb = createTenantDb({ db, tenantId: tenantA });

      expect(await tenantDb.deleteMany(meta, { score: 6 })).toBe(0);
      const inTransaction = await runInOwnTransaction(tenantDb, (txDb) =>
        txDb.deleteMany(meta, { score: 5 }),
      );
      expect(inTransaction).toBe(2);
      expect(await countWhere(db, meta, { tenantId: tenantB })).toBe(1);
      expect(await createTenantDb({ db, tenantId: tenantB }).deleteMany(meta, { score: 5 })).toBe(
        1,
      );
    });
  });
});
