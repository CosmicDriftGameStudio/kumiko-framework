import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField, type SessionUser } from "../../engine";
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

const adminUser: SessionUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const otherTenantUser: SessionUser = { id: 2, tenantId: 2, roles: ["Admin"] };

beforeAll(async () => {
  testDb = await createTestDb();

  await testDb.db.execute(
    sql`CREATE TABLE crud_users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
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

  crud = createCrudExecutor(table, entity);
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

  test("increments version on each update", async () => {
    const created = await crud.create({ email: "ver@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    expect(created.data.data["version"]).toBe(1);

    const update1 = await crud.update(
      { id: created.data.id, changes: { firstName: "V2" } },
      adminUser,
      testDb.db,
    );
    if (!update1.isSuccess) throw new Error("Update 1 failed");
    expect(update1.data.data["version"]).toBe(2);

    const update2 = await crud.update(
      { id: created.data.id, changes: { firstName: "V3" } },
      adminUser,
      testDb.db,
    );
    if (!update2.isSuccess) throw new Error("Update 2 failed");
    expect(update2.data.data["version"]).toBe(3);
  });

  test("optimistic locking: rejects stale version", async () => {
    const created = await crud.create({ email: "lock@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    // Update with correct version
    const update1 = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "OK" } },
      adminUser,
      testDb.db,
    );
    expect(update1.isSuccess).toBe(true);

    // Try update with stale version (1, but current is now 2)
    const update2 = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Stale" } },
      adminUser,
      testDb.db,
    );
    expect(update2.isSuccess).toBe(false);
    if (!update2.isSuccess) {
      expect(update2.error).toContain("version_conflict");
    }
  });

  test("optimistic locking: accepts matching version", async () => {
    const created = await crud.create({ email: "lock2@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Match" } },
      adminUser,
      testDb.db,
    );
    expect(result.isSuccess).toBe(true);
  });

  test("update without version skips locking check", async () => {
    const created = await crud.create({ email: "nolock@test.de" }, adminUser, testDb.db);
    if (!created.isSuccess) throw new Error("Setup failed");

    // No version = no check, always succeeds
    const result = await crud.update(
      { id: created.data.id, changes: { firstName: "NoCheck" } },
      adminUser,
      testDb.db,
    );
    expect(result.isSuccess).toBe(true);
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
