import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer } from "../api/server";
import { createCrudExecutor } from "../db/crud-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createEntity,
  createNumberField,
  createRegistry,
  createTextField,
  defineFeature,
  type SessionUser,
} from "../engine";
import {
  createEntityTable,
  createTestDb,
  createTestRedis,
  createTestUser,
  type TestDb,
  type TestRedis,
  TestUsers,
} from "../testing";

// --- Entity with field-level access ---

const employeeEntity = createEntity({
  table: "fa_employees",
  fields: {
    email: createTextField({ required: true }),
    firstName: createTextField(),
    salary: createNumberField({ access: { read: ["Admin", "Accounting"], write: ["Admin"] } }),
    notes: createTextField({ access: { read: ["Admin"], write: ["Admin"] } }),
  },
});

const employeeTable = buildDrizzleTable("employee", employeeEntity);

// --- Test infra ---

const JWT_SECRET = "field-access-test-secret-minimum-32-chars!!";

let testDb: TestDb;
let testRedis: TestRedis;
let app: ReturnType<typeof buildServer>["app"];
let jwt: ReturnType<typeof buildServer>["jwt"];

const adminUser = TestUsers.admin;
const accountingUser = createTestUser({ id: 2, roles: ["Accounting"] });
const employeeUser = createTestUser({ id: 3, roles: ["Employee"] });

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();

  await createEntityTable(testDb.db, employeeEntity);

  const feature = defineFeature("employees", (r) => {
    r.entity("employee", employeeEntity);

    r.writeHandler(
      "employee:create",
      z.object({
        email: z.string(),
        firstName: z.string().optional(),
        salary: z.number().optional(),
        notes: z.string().optional(),
      }),
      async (event, ctx) => {
        const db = ctx.db;
        const crud = createCrudExecutor(employeeTable, employeeEntity, { entityName: "employee" });
        return crud.create(event.payload, event.user, db);
      },
      { access: { roles: ["Admin", "Accounting", "Employee"] } },
    );

    r.writeHandler(
      "employee:update",
      z.object({
        id: z.number(),
        version: z.number().optional(),
        changes: z.record(z.string(), z.unknown()),
      }),
      async (event, ctx) => {
        const db = ctx.db;
        const crud = createCrudExecutor(employeeTable, employeeEntity, { entityName: "employee" });
        return crud.update(event.payload, event.user, db);
      },
      { access: { roles: ["Admin", "Accounting", "Employee"] } },
    );

    r.queryHandler(
      "employee:detail",
      z.object({ id: z.number() }),
      async (query, ctx) => {
        const db = ctx.db;
        const crud = createCrudExecutor(employeeTable, employeeEntity, { entityName: "employee" });
        return crud.detail(query.payload, query.user, db);
      },
      { access: { roles: ["Admin", "Accounting", "Employee"] } },
    );
  });

  const registry = createRegistry([feature]);
  const server = buildServer({
    registry,
    context: { db: testDb.db, redis: testRedis.redis },
    jwtSecret: JWT_SECRET,
  });
  app = server.app;
  jwt = server.jwt;
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

async function req(method: string, path: string, user: SessionUser, body?: unknown) {
  const token = await jwt.sign(user);
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// Seed a record as Admin (has all field access)
async function seedEmployee(): Promise<number> {
  const res = await (
    await req("POST", "/api/write", adminUser, {
      type: "employees:write:employee:create",
      payload: { email: "test@test.de", firstName: "Test", salary: 75000, notes: "Internal note" },
    })
  ).json();
  return res.data.id;
}

// =============================================================================
// READ: field filtering based on role
// =============================================================================

describe("field-level read access", () => {
  let employeeId: number;

  beforeAll(async () => {
    employeeId = await seedEmployee();
  });

  test("Admin sees all fields", async () => {
    const res = await (
      await req("POST", "/api/query", adminUser, {
        type: "employees:query:employee:detail",
        payload: { id: employeeId },
      })
    ).json();

    expect(res.data["email"]).toBe("test@test.de");
    expect(res.data["salary"]).toBe(75000);
    expect(res.data["notes"]).toBe("Internal note");
    expect(res.data["firstName"]).toBe("Test");
  });

  test("Accounting sees salary but not notes", async () => {
    const res = await (
      await req("POST", "/api/query", accountingUser, {
        type: "employees:query:employee:detail",
        payload: { id: employeeId },
      })
    ).json();

    expect(res.data["email"]).toBe("test@test.de");
    expect(res.data["salary"]).toBe(75000);
    expect(res.data["notes"]).toBeUndefined();
    expect(res.data["firstName"]).toBe("Test");
  });

  test("Employee sees neither salary nor notes", async () => {
    const res = await (
      await req("POST", "/api/query", employeeUser, {
        type: "employees:query:employee:detail",
        payload: { id: employeeId },
      })
    ).json();

    expect(res.data["email"]).toBe("test@test.de");
    expect(res.data["firstName"]).toBe("Test");
    expect(res.data["salary"]).toBeUndefined();
    expect(res.data["notes"]).toBeUndefined();
  });
});

// =============================================================================
// WRITE: reject forbidden field changes
// =============================================================================

describe("field-level write access", () => {
  test("Admin can update salary", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", adminUser, {
        type: "employees:write:employee:update",
        payload: { id, changes: { salary: 80000 } },
      })
    ).json();

    expect(res.isSuccess).toBe(true);
  });

  test("Employee cannot update salary — error", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", employeeUser, {
        type: "employees:write:employee:update",
        payload: { id, changes: { salary: 999999 } },
      })
    ).json();

    expect(res.isSuccess).toBe(false);
    expect(res.error.code).toBe("access_denied");
    expect(res.error.details).toMatchObject({ reason: "field_access_denied", field: "salary" });
  });

  test("Employee can update firstName", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", employeeUser, {
        type: "employees:write:employee:update",
        payload: { id, changes: { firstName: "Updated" } },
      })
    ).json();

    expect(res.isSuccess).toBe(true);
    expect(res.data.data["firstName"]).toBe("Updated");
  });

  test("Employee cannot create with salary — error", async () => {
    const res = await (
      await req("POST", "/api/write", employeeUser, {
        type: "employees:write:employee:create",
        payload: { email: "new@test.de", salary: 50000 },
      })
    ).json();

    expect(res.isSuccess).toBe(false);
    expect(res.error.code).toBe("access_denied");
    expect(res.error.details).toMatchObject({ reason: "field_access_denied", field: "salary" });
  });

  test("Accounting cannot update salary (only read)", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", accountingUser, {
        type: "employees:write:employee:update",
        payload: { id, changes: { salary: 60000 } },
      })
    ).json();

    expect(res.isSuccess).toBe(false);
    expect(res.error.code).toBe("access_denied");
    expect(res.error.details).toMatchObject({ reason: "field_access_denied", field: "salary" });
  });
});
