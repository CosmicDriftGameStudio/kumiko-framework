import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { createEntity, createTextField } from "../../engine";
import { createTestDb, type TestDb, TestUsers, unsafeCreateEntityTable } from "../../stack";
import type { TableColumns } from "../dialect";
import { buildEntityTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

const entity = createEntity({
  table: "tenant_db_count_items",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const table: TableColumns = buildEntityTable("tenantDbCountItem", entity);

let testDb: TestDb;
const tenantA = TestUsers.admin; // tenantId: 1
const tenantB = TestUsers.otherTenant; // tenantId: 2

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "tenantDbCountItem");

  const tdbA = createTenantDb(testDb.db, tenantA.tenantId);
  const tdbB = createTenantDb(testDb.db, tenantB.tenantId);

  await tdbA.insertOne(table, { name: "A1" });
  await tdbA.insertOne(table, { name: "A2" });
  await tdbA.insertOne(table, { name: "A3" });
  await tdbB.insertOne(table, { name: "B1" });

  await seedRow(testDb.db, table, {
    name: "Reference",
    tenantId: "00000000-0000-4000-8000-000000000000",
    version: 1,
    insertedAt: Temporal.Now.instant(),
  });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("TenantDb.count() — tenant mode", () => {
  test("B's count returns only B's own rows plus the reference row, never A's rows", async () => {
    const tdbB = createTenantDb(testDb.db, tenantB.tenantId);
    const count = await tdbB.count(table);
    expect(count).toBe(2); // B1 + Reference
  });

  test("A's count returns only A's own rows plus the reference row", async () => {
    const tdbA = createTenantDb(testDb.db, tenantA.tenantId);
    const count = await tdbA.count(table);
    expect(count).toBe(4); // A1, A2, A3 + Reference
  });

  test("where filter narrows the count", async () => {
    const tdbA = createTenantDb(testDb.db, tenantA.tenantId);
    const count = await tdbA.count(table, { name: "A1" });
    expect(count).toBe(1);
  });

  test("B's where: { tenantId: tenantA } cannot widen scope — falls back to B's own scope", async () => {
    const tdbB = createTenantDb(testDb.db, tenantB.tenantId);
    const count = await tdbB.count(table, { tenantId: tenantA.tenantId });
    // The requested tenantId isn't in B's allowed set [B, SYSTEM], so it falls
    // back to B's full enforced scope rather than widening to A.
    expect(count).toBe(2); // B1 + Reference
  });

  test("where: { tenantId: B } excludes the reference row", async () => {
    const tdbB = createTenantDb(testDb.db, tenantB.tenantId);
    const count = await tdbB.count(table, { tenantId: tenantB.tenantId });
    expect(count).toBe(1); // B1 only
  });

  test("count matches selectMany(...).length for the same scope", async () => {
    const tdbA = createTenantDb(testDb.db, tenantA.tenantId);
    const [count, rows] = await Promise.all([tdbA.count(table), tdbA.selectMany(table)]);
    expect(count).toBe(rows.length);
  });
});

describe("TenantDb.count() — system mode", () => {
  test("counts all rows across every tenant, unfiltered", async () => {
    const systemDb = createTenantDb(testDb.db, tenantA.tenantId, "system");
    const count = await systemDb.count(table);
    expect(count).toBe(5); // A1, A2, A3, B1, Reference
  });
});
