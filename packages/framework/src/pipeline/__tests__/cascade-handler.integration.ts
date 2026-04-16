import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type CrudExecutor, createCrudExecutor } from "../../db/crud-executor";
import type { TableColumns } from "../../db/dialect";
import { buildDrizzleTable } from "../../db/table-builder";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import {
  createEntity,
  createNumberField,
  createRegistry,
  createTextField,
  defineFeature,
  type Registry,
} from "../../engine";
import { createEntityTable, createTestDb, type TestDb, TestUsers } from "../../testing";
import { createCascadeDeleteHook } from "../cascade-handler";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

let testDb: TestDb;
let tdb: TenantDb;
let registry: Registry;
let departmentTable: Table;
let userTable: Table;
let sessionTable: Table;
let departmentCrud: CrudExecutor;
let userCrud: CrudExecutor;
let sessionCrud: CrudExecutor;

const admin = TestUsers.admin;

const departmentEntity = createEntity({
  table: "cascade_departments",
  fields: { name: createTextField() },
});
const userEntity = createEntity({
  table: "cascade_users",
  fields: { name: createTextField(), departmentId: createNumberField() },
});
const sessionEntity = createEntity({
  table: "cascade_sessions",
  fields: { userId: createNumberField(), token: createTextField() },
});

beforeAll(async () => {
  testDb = await createTestDb();
  tdb = createTenantDb(testDb.db, admin.tenantId);

  await createEntityTable(testDb.db, departmentEntity);
  await createEntityTable(testDb.db, userEntity);
  await createEntityTable(testDb.db, sessionEntity);

  departmentTable = buildDrizzleTable("department", departmentEntity);
  userTable = buildDrizzleTable("user", userEntity);
  sessionTable = buildDrizzleTable("session", sessionEntity);

  const feature = defineFeature("cascade", (r) => {
    r.entity("department", departmentEntity);
    r.entity("user", userEntity);
    r.entity("session", sessionEntity);

    r.relation("department", "users", {
      type: "hasMany",
      target: "user",
      foreignKey: "departmentId",
      onDelete: "restrict",
    });

    r.relation("user", "sessions", {
      type: "hasMany",
      target: "session",
      foreignKey: "userId",
      onDelete: "cascade",
    });
  });

  registry = createRegistry([feature]);
  departmentCrud = createCrudExecutor(departmentTable, departmentEntity);
  userCrud = createCrudExecutor(userTable, userEntity);
  sessionCrud = createCrudExecutor(sessionTable, sessionEntity);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("cascade delete: restrict", () => {
  test("blocks delete when related records exist", async () => {
    const dept = await departmentCrud.create({ name: "Engineering" }, admin, tdb);
    if (!dept.isSuccess) throw new Error("Setup failed");

    await userCrud.create({ name: "Marc", departmentId: dept.data.id }, admin, tdb);

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["user", userTable]]));

    await expect(
      cascadeHook.fn(
        {
          kind: "delete",
          id: dept.data.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "department",
        },
        { db: tdb },
      ),
    ).rejects.toMatchObject({ code: "conflict", details: { reason: "delete_restricted" } });
  });

  test("allows delete when no related records", async () => {
    const dept = await departmentCrud.create({ name: "Empty" }, admin, tdb);
    if (!dept.isSuccess) throw new Error("Setup failed");

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["user", userTable]]));

    await expect(
      cascadeHook.fn(
        {
          kind: "delete",
          id: dept.data.id,
          data: { tenantId: "00000000-0000-4000-8000-000000000001" },
          entityName: "department",
        },
        { db: tdb },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("cascade delete: cascade", () => {
  test("deletes related records when parent is deleted", async () => {
    const user = await userCrud.create({ name: "Cascade User" }, admin, tdb);
    if (!user.isSuccess) throw new Error("Setup failed");

    await sessionCrud.create({ userId: user.data.id, token: "abc" }, admin, tdb);
    await sessionCrud.create({ userId: user.data.id, token: "def" }, admin, tdb);

    // Verify sessions exist
    const before = await sessionCrud.list({}, admin, tdb);
    const sessionsBefore = before.rows.filter((r) => r["userId"] === user.data.id);
    expect(sessionsBefore.length).toBe(2);

    // Run cascade
    const cascadeHook = createCascadeDeleteHook(registry, new Map([["session", sessionTable]]));

    await cascadeHook.fn(
      {
        kind: "delete",
        id: user.data.id,
        data: { tenantId: "00000000-0000-4000-8000-000000000001" },
        entityName: "user",
      },
      { db: tdb },
    );

    // Sessions should be gone
    const after = await sessionCrud.list({}, admin, tdb);
    const sessionsAfter = after.rows.filter((r) => r["userId"] === user.data.id);
    expect(sessionsAfter.length).toBe(0);
  });
});
