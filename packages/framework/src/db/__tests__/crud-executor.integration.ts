import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField, type PipelineUser } from "../../engine";
import { createTestDb, type TestDb } from "../../testing";
import { type CrudExecutor, createCrudExecutor } from "../crud-executor";
import { buildDrizzleTable } from "../table-builder";

const entity = createEntity({
  table: "crud_users",
  fields: {
    email: createTextField({ required: true, searchable: true }),
    firstName: createTextField({ searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const table = buildDrizzleTable("crudUser", entity);

let testDb: TestDb;
let crud: CrudExecutor;

const adminUser: PipelineUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const otherTenantUser: PipelineUser = { id: 2, tenantId: 2, roles: ["Admin"] };

beforeAll(async () => {
  testDb = await createTestDb();

  await testDb.db.execute(
    sql`CREATE TABLE crud_users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
      modified_at TIMESTAMP,
      inserted_by_id INTEGER,
      modified_by_id INTEGER,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      email TEXT,
      first_name TEXT,
      is_enabled BOOLEAN DEFAULT TRUE NOT NULL
    )`,
  );

  crud = createCrudExecutor(table, entity, { searchableFields: ["email", "firstName"] });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("crud create", () => {
  test("inserts row with SaveContext", async () => {
    const result = await crud.create(
      { email: "test@test.de", firstName: "Test" },
      adminUser,
      testDb.db,
    );

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data.isNew).toBe(true);
      expect(result.data.data["email"]).toBe("test@test.de");
      expect(result.data.data["tenantId"]).toBe(1);
      expect(result.data.changes).toEqual({ email: "test@test.de", firstName: "Test" });
      expect(result.data.previous).toEqual({});
      expect(result.data.id).toBeDefined();
    }
  });
});

describe("crud detail", () => {
  test("finds row by id and tenant", async () => {
    const created = await crud.create({ email: "detail@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    const row = await crud.detail({ id: created.data.id }, adminUser, testDb.db);
    expect(row).not.toBeNull();
    expect(row?.["email"]).toBe("detail@test.de");
  });

  test("returns null for other tenant", async () => {
    const created = await crud.create({ email: "tenant1@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    const row = await crud.detail({ id: created.data.id }, otherTenantUser, testDb.db);
    expect(row).toBeNull();
  });
});

describe("crud update", () => {
  test("returns SaveContext with changes and previous", async () => {
    const created = await crud.create(
      { email: "update@test.de", firstName: "Before" },
      adminUser,
      testDb.db,
    );
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { firstName: "After" } },
      adminUser,
      testDb.db,
    );

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data.isNew).toBe(false);
      expect(result.data.data["firstName"]).toBe("After");
      expect(result.data.changes).toEqual({ firstName: "After" });
      expect(result.data.previous["firstName"]).toBe("Before");
      expect(result.data.data["modifiedById"]).toBe(1);
    }
  });

  test("returns not_found for other tenant", async () => {
    const created = await crud.create({ email: "update2@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { firstName: "Hacked" } },
      otherTenantUser,
      testDb.db,
    );

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toBe("not_found");
  });
});

describe("crud delete (soft)", () => {
  test("soft deletes and returns DeleteContext", async () => {
    const created = await crud.create({ email: "delete@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    const deleteResult = await crud.delete({ id: created.data.id }, adminUser, testDb.db);
    expect(deleteResult.isSuccess).toBe(true);
    if (deleteResult.isSuccess) {
      expect(deleteResult.data.id).toBe(created.data.id);
      expect(deleteResult.data.data["email"]).toBe("delete@test.de");
    }

    // Should not be found anymore
    const row = await crud.detail({ id: created.data.id }, adminUser, testDb.db);
    expect(row).toBeNull();
  });
});

describe("crud list", () => {
  test("lists rows for tenant with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await crud.create({ email: `list${i}@test.de`, firstName: `User${i}` }, adminUser, testDb.db);
    }

    const page1 = await crud.list({ limit: 3 }, adminUser, testDb.db);
    expect(page1.rows.length).toBeLessThanOrEqual(3);
    expect(page1.rows.every((r) => r["tenantId"] === 1)).toBe(true);
  });
});
