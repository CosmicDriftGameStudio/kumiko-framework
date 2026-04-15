import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField } from "../../engine";
import {
  createEntityTable,
  createTestDb,
  createTestUser,
  type TestDb,
  TestUsers,
} from "../../testing";
import { type CrudExecutor, createCrudExecutor } from "../crud-executor";
import { buildDrizzleTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

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
let adminDb: TenantDb;
let otherTenantDb: TenantDb;

const adminUser = TestUsers.admin;
const otherTenantUser = createTestUser({ id: 2, tenantId: 2 });

beforeAll(async () => {
  testDb = await createTestDb();
  await createEntityTable(testDb.db, entity);

  crud = createCrudExecutor(table, entity);
  adminDb = createTenantDb(testDb.db, adminUser.tenantId);
  otherTenantDb = createTenantDb(testDb.db, otherTenantUser.tenantId);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("crud create", () => {
  test("inserts row with SaveContext", async () => {
    const result = await crud.create(
      { email: "test@test.de", firstName: "Test" },
      adminUser,
      adminDb,
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

  test("applies field defaults when payload omits them", async () => {
    // isEnabled has `default: true` on the entity — payload omits it,
    // so the insert must write true (not null, not undefined).
    const result = await crud.create({ email: "default-check@test.de" }, adminUser, adminDb);

    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.data["isEnabled"]).toBe(true);
  });

  test("explicit value wins over default", async () => {
    // Client explicitly sets isEnabled: false — must survive, default must not overwrite.
    const result = await crud.create(
      { email: "explicit@test.de", isEnabled: false },
      adminUser,
      adminDb,
    );

    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.data["isEnabled"]).toBe(false);
  });

  test("falsy default (false) is applied when omitted", async () => {
    // Entity with a boolean field defaulting to `false`. A naive `if (!value)`
    // gate would skip this — the applyDefaults implementation must use a strict
    // `=== undefined` check.
    const falsyDefaultEntity = createEntity({
      table: "crud_falsy_defaults",
      fields: {
        email: createTextField({ required: true }),
        isFlagged: createBooleanField({ default: false }),
      },
    });
    const falsyTable = buildDrizzleTable("crudFalsy", falsyDefaultEntity);
    await createEntityTable(testDb.db, falsyDefaultEntity);
    const falsyCrud = createCrudExecutor(falsyTable, falsyDefaultEntity);

    const result = await falsyCrud.create({ email: "falsy@test.de" }, adminUser, adminDb);
    expect(result.isSuccess).toBe(true);
    if (!result.isSuccess) return;
    expect(result.data.data["isFlagged"]).toBe(false);
  });
});

describe("crud detail", () => {
  test("finds row by id and tenant", async () => {
    const created = await crud.create({ email: "detail@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const row = await crud.detail({ id: created.data.id }, adminUser, adminDb);
    expect(row).not.toBeNull();
    expect(row?.["email"]).toBe("detail@test.de");
  });

  test("returns null for other tenant", async () => {
    const created = await crud.create({ email: "tenant1@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const row = await crud.detail({ id: created.data.id }, otherTenantUser, otherTenantDb);
    expect(row).toBeNull();
  });
});

describe("crud update", () => {
  test("returns SaveContext with changes and previous", async () => {
    const created = await crud.create(
      { email: "update@test.de", firstName: "Before" },
      adminUser,
      adminDb,
    );
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "After" } },
      adminUser,
      adminDb,
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
    const created = await crud.create({ email: "ver@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    expect(created.data.data["version"]).toBe(1);

    const update1 = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "V2" } },
      adminUser,
      adminDb,
    );
    if (!update1.isSuccess) throw new Error("Update 1 failed");
    expect(update1.data.data["version"]).toBe(2);

    const update2 = await crud.update(
      { id: created.data.id, version: 2, changes: { firstName: "V3" } },
      adminUser,
      adminDb,
    );
    if (!update2.isSuccess) throw new Error("Update 2 failed");
    expect(update2.data.data["version"]).toBe(3);
  });

  test("optimistic locking: rejects stale version", async () => {
    const created = await crud.create({ email: "lock@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const update1 = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "OK" } },
      adminUser,
      adminDb,
    );
    expect(update1.isSuccess).toBe(true);

    const update2 = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Stale" } },
      adminUser,
      adminDb,
    );
    expect(update2.isSuccess).toBe(false);
    if (!update2.isSuccess) {
      expect(update2.error.code).toBe("version_conflict");
    }
  });

  test("optimistic locking: accepts matching version", async () => {
    const created = await crud.create({ email: "lock2@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Match" } },
      adminUser,
      adminDb,
    );
    expect(result.isSuccess).toBe(true);
  });

  test("update without version is rejected with version_conflict (no silent last-writer-wins)", async () => {
    const created = await crud.create({ email: "nolock@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { firstName: "NoCheck" } },
      adminUser,
      adminDb,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("version_conflict");
    }
  });

  test("update without version succeeds when handler opts out via skipOptimisticLock", async () => {
    const created = await crud.create({ email: "optout@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, changes: { firstName: "Forced" } },
      adminUser,
      adminDb,
      { skipOptimisticLock: true },
    );
    expect(result.isSuccess).toBe(true);
  });

  test("returns not_found for other tenant", async () => {
    const created = await crud.create({ email: "update2@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const result = await crud.update(
      { id: created.data.id, version: 1, changes: { firstName: "Hacked" } },
      otherTenantUser,
      otherTenantDb,
    );

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("not_found");
  });
});

describe("crud delete (soft)", () => {
  test("soft deletes and returns DeleteContext", async () => {
    const created = await crud.create({ email: "delete@test.de" }, adminUser, adminDb);
    if (!created.isSuccess) throw new Error("Setup failed");

    const deleteResult = await crud.delete({ id: created.data.id }, adminUser, adminDb);
    expect(deleteResult.isSuccess).toBe(true);
    if (deleteResult.isSuccess) {
      expect(deleteResult.data.id).toBe(created.data.id);
      expect(deleteResult.data.data["email"]).toBe("delete@test.de");
    }

    const row = await crud.detail({ id: created.data.id }, adminUser, adminDb);
    expect(row).toBeNull();
  });
});

describe("crud list", () => {
  test("lists rows for tenant with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await crud.create({ email: `list${i}@test.de`, firstName: `User${i}` }, adminUser, adminDb);
    }

    const page1 = await crud.list({ limit: 3 }, adminUser, adminDb);
    expect(page1.rows.length).toBeLessThanOrEqual(3);
    expect(page1.rows.every((r) => r["tenantId"] === 1)).toBe(true);
  });
});
