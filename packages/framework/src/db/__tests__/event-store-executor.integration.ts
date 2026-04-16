import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import { createEventsTable } from "../../event-store";
import {
  createEntityTable,
  createTestDb,
  type TestDb,
  TestUsers,
  testTenantId,
} from "../../testing";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildDrizzleTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const entity = createEntity({
  table: "es_exec_users",
  idType: "uuid",
  fields: {
    email: createTextField({ required: true, searchable: true }),
    firstName: createTextField(),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});
const table = buildDrizzleTable("esExecUser", entity);

let testDb: TestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEntityTable(testDb.db, entity, "esExecUser");
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, adminUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.db.execute(sql`TRUNCATE events, es_exec_users RESTART IDENTITY CASCADE`);
});

describe("event-store-executor", () => {
  const crud = createEventStoreExecutor(table, entity, { entityName: "esExecUser" });

  test("create appends event v1 + inserts projection row", async () => {
    const result = await crud.create({ email: "test@test.de", firstName: "Test" }, adminUser, tdb);
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.isNew).toBe(true);
    expect(typeof result.data.id).toBe("string");
    expect(result.data.data["email"]).toBe("test@test.de");
    expect(result.data.data["tenantId"]).toBe(testTenantId(1));
    expect(result.data.data["version"]).toBe(1);
  });

  test("update increments version + appends event", async () => {
    const created = await crud.create({ email: "u@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Updated" } },
      adminUser,
      tdb,
    );
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.data["version"]).toBe(2);
    expect(result.data.data["firstName"]).toBe("Updated");
  });

  test("stale version → version_conflict", async () => {
    const created = await crud.create({ email: "v@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "First" } },
      adminUser,
      tdb,
    );
    const stale = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Stale" } },
      adminUser,
      tdb,
    );
    expect(stale.isSuccess).toBe(false);
    if (stale.isSuccess) return;
    expect(stale.error.code).toBe("version_conflict");
  });

  test("delete soft-deletes + appends event", async () => {
    const created = await crud.create({ email: "d@test.de" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("setup failed");

    const deleted = await crud.delete({ id: created.data.id }, adminUser, tdb);
    expect(deleted.isSuccess).toBe(true);

    const detail = await crud.detail({ id: created.data.id }, adminUser, tdb);
    expect(detail).toBeNull();
  });
});
