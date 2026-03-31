import { sql } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type CrudExecutor, createCrudExecutor } from "../../db/crud-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import {
  createEntity,
  createNumberField,
  createRegistry,
  createTextField,
  defineFeature,
  type PipelineUser,
  type Registry,
} from "../../engine";
import { createTestDb, type TestDb } from "../../testing";
import { createCascadeDeleteHook } from "../cascade-handler";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = PgTableWithColumns<any>;

let testDb: TestDb;
let registry: Registry;
let departmentTable: Table;
let userTable: Table;
let sessionTable: Table;
let departmentCrud: CrudExecutor;
let userCrud: CrudExecutor;
let sessionCrud: CrudExecutor;

const admin: PipelineUser = { id: 1, tenantId: 1, roles: ["Admin"] };

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

  await testDb.db.execute(sql`
    CREATE TABLE cascade_departments (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, version INTEGER DEFAULT 1 NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL, modified_at TIMESTAMP,
      inserted_by_id INTEGER, modified_by_id INTEGER, name TEXT
    )
  `);
  await testDb.db.execute(sql`
    CREATE TABLE cascade_users (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, version INTEGER DEFAULT 1 NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL, modified_at TIMESTAMP,
      inserted_by_id INTEGER, modified_by_id INTEGER, name TEXT, department_id INTEGER
    )
  `);
  await testDb.db.execute(sql`
    CREATE TABLE cascade_sessions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, version INTEGER DEFAULT 1 NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL, modified_at TIMESTAMP,
      inserted_by_id INTEGER, modified_by_id INTEGER, user_id INTEGER, token TEXT
    )
  `);

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
    const dept = await departmentCrud.create({ name: "Engineering" }, admin, testDb.db);
    if (!dept.isSuccess) throw new Error("Setup failed");

    await userCrud.create({ name: "Marc", departmentId: dept.data.id }, admin, testDb.db);

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["user", userTable]]));

    await expect(
      cascadeHook.fn(
        { id: dept.data.id, data: { tenantId: 1 } },
        { db: testDb.db, _entityName: "department" },
      ),
    ).rejects.toThrow(/delete_restricted/);
  });

  test("allows delete when no related records", async () => {
    const dept = await departmentCrud.create({ name: "Empty" }, admin, testDb.db);
    if (!dept.isSuccess) throw new Error("Setup failed");

    const cascadeHook = createCascadeDeleteHook(registry, new Map([["user", userTable]]));

    await expect(
      cascadeHook.fn(
        { id: dept.data.id, data: { tenantId: 1 } },
        { db: testDb.db, _entityName: "department" },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("cascade delete: cascade", () => {
  test("deletes related records when parent is deleted", async () => {
    const user = await userCrud.create({ name: "Cascade User" }, admin, testDb.db);
    if (!user.isSuccess) throw new Error("Setup failed");

    await sessionCrud.create({ userId: user.data.id, token: "abc" }, admin, testDb.db);
    await sessionCrud.create({ userId: user.data.id, token: "def" }, admin, testDb.db);

    // Verify sessions exist
    const before = await sessionCrud.list({}, admin, testDb.db);
    const sessionsBefore = before.rows.filter((r) => r["userId"] === user.data.id);
    expect(sessionsBefore.length).toBe(2);

    // Run cascade
    const cascadeHook = createCascadeDeleteHook(registry, new Map([["session", sessionTable]]));

    await cascadeHook.fn(
      { id: user.data.id, data: { tenantId: 1 } },
      { db: testDb.db, _entityName: "user" },
    );

    // Sessions should be gone
    const after = await sessionCrud.list({}, admin, testDb.db);
    const sessionsAfter = after.rows.filter((r) => r["userId"] === user.data.id);
    expect(sessionsAfter.length).toBe(0);
  });
});
