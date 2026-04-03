import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer } from "../api/server";
import { createCrudExecutor } from "../db/crud-executor";
import type { DbConnection } from "../db/index";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createEntity,
  createNumberField,
  createRegistry,
  createTextField,
  defineFeature,
  type SessionUser,
} from "../engine";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../testing";
import { ErrorCodes } from "../engine/constants";

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

const adminUser: SessionUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const accountingUser: SessionUser = { id: 2, tenantId: 1, roles: ["Accounting"] };
const employeeUser: SessionUser = { id: 3, tenantId: 1, roles: ["Employee"] };

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();

  await testDb.db.execute(sql`
    CREATE TABLE fa_employees (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
      modified_at TIMESTAMP,
      inserted_by_id INTEGER,
      modified_by_id INTEGER,
      email TEXT,
      first_name TEXT,
      salary INTEGER,
      notes TEXT
    )
  `);

  const feature = defineFeature("employees", (r) => {
    r.entity("employee", employeeEntity);

    r.writeHandler(
      "employee.create",
      z.object({
        email: z.string(),
        firstName: z.string().optional(),
        salary: z.number().optional(),
        notes: z.string().optional(),
      }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        const crud = createCrudExecutor(employeeTable, employeeEntity, { entityName: "employee" });
        return crud.create(event.payload, event.user, db);
      },
      { access: { roles: ["Admin", "Accounting", "Employee"] } },
    );

    r.writeHandler(
      "employee.update",
      z.object({ id: z.number(), version: z.number().optional(), changes: z.record(z.unknown()) }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        const crud = createCrudExecutor(employeeTable, employeeEntity, { entityName: "employee" });
        return crud.update(event.payload, event.user, db);
      },
      { access: { roles: ["Admin", "Accounting", "Employee"] } },
    );

    r.queryHandler(
      "employee.detail",
      z.object({ id: z.number() }),
      async (query, ctx) => {
        const db = ctx["db"] as DbConnection;
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
      type: "employee.create",
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
        type: "employee.detail",
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
        type: "employee.detail",
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
        type: "employee.detail",
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
        type: "employee.update",
        payload: { id, changes: { salary: 80000 } },
      })
    ).json();

    expect(res.isSuccess).toBe(true);
  });

  test("Employee cannot update salary — error", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", employeeUser, {
        type: "employee.update",
        payload: { id, changes: { salary: 999999 } },
      })
    ).json();

    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain(ErrorCodes.fieldAccessDenied);
    expect(res.error).toContain("salary");
  });

  test("Employee can update firstName", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", employeeUser, {
        type: "employee.update",
        payload: { id, changes: { firstName: "Updated" } },
      })
    ).json();

    expect(res.isSuccess).toBe(true);
    expect(res.data.data["firstName"]).toBe("Updated");
  });

  test("Employee cannot create with salary — error", async () => {
    const res = await (
      await req("POST", "/api/write", employeeUser, {
        type: "employee.create",
        payload: { email: "new@test.de", salary: 50000 },
      })
    ).json();

    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain(ErrorCodes.fieldAccessDenied);
  });

  test("Accounting cannot update salary (only read)", async () => {
    const id = await seedEmployee();
    const res = await (
      await req("POST", "/api/write", accountingUser, {
        type: "employee.update",
        payload: { id, changes: { salary: 60000 } },
      })
    ).json();

    expect(res.isSuccess).toBe(false);
    expect(res.error).toContain(ErrorCodes.fieldAccessDenied);
  });
});
