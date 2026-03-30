import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer } from "../api/server";
import { createCrudExecutor } from "../db/crud-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createBooleanField,
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type PipelineUser,
} from "../engine";
import { createEventLog } from "../pipeline";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../testing";

// --- Setup: A realistic feature ---

const userEntity = createEntity({
  table: "fullstack_users",
  fields: {
    email: createTextField({ required: true, format: "email", searchable: true }),
    firstName: createTextField({ searchable: true }),
    lastName: createTextField({ searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
});

const userTable = buildDrizzleTable("user", userEntity);

const userFeature = defineFeature("users", (r) => {
  r.entity("user", userEntity);

  r.writeHandler(
    "user.create",
    z.object({
      email: z.string().email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    }),
    async (event, ctx) => {
      const db = ctx["db"] as import("../db").DbConnection;
      const crud = createCrudExecutor(userTable, userEntity, ["email", "firstName", "lastName"]);
      return crud.create(event.payload, event.user, db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "user.list",
    z.object({ search: z.string().optional(), limit: z.number().optional() }),
    async (query, ctx) => {
      const db = ctx["db"] as import("../db").DbConnection;
      const crud = createCrudExecutor(userTable, userEntity, ["email", "firstName", "lastName"]);
      return crud.list(query.payload, query.user, db);
    },
  );

  r.queryHandler("user.detail", z.object({ id: z.number() }), async (query, ctx) => {
    const db = ctx["db"] as import("../db").DbConnection;
    const crud = createCrudExecutor(userTable, userEntity, ["email", "firstName", "lastName"]);
    return crud.detail(query.payload, query.user, db);
  });

  r.hook("validation", "user.create", (data) => {
    if (data["email"] === "banned@evil.com") return [{ field: "email", error: "banned_domain" }];
    return null;
  });

  r.translations({
    keys: {
      "nav.title": { de: "Benutzer", en: "Users" },
      "field.email": { de: "E-Mail", en: "Email" },
    },
  });
});

// --- Test infra ---

const JWT_SECRET = "full-stack-test-secret-minimum-32-chars!!";

let testDb: TestDb;
let testRedis: TestRedis;
let app: ReturnType<typeof buildServer>["app"];
let jwt: ReturnType<typeof buildServer>["jwt"];
let _eventLog: ReturnType<typeof createEventLog>;

const adminUser: PipelineUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const guestUser: PipelineUser = { id: 2, tenantId: 1, roles: ["Guest"] };
const otherTenantAdmin: PipelineUser = { id: 3, tenantId: 2, roles: ["Admin"] };

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();

  await testDb.db.execute(sql`
    CREATE TABLE fullstack_users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
      modified_at TIMESTAMP,
      inserted_by_id INTEGER,
      modified_by_id INTEGER,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      is_enabled BOOLEAN DEFAULT TRUE NOT NULL
    )
  `);

  _eventLog = createEventLog(testRedis.redis);

  const registry = createRegistry([userFeature]);
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

async function req(method: string, path: string, user: PipelineUser, body?: unknown) {
  const token = await jwt.sign(user);
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// --- Full Stack Tests ---

describe("full stack: HTTP → Auth → Dispatch → DB", () => {
  test("create user via /api/write and read back via /api/query", async () => {
    // Create
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "marc@test.de", firstName: "Marc", lastName: "Test" },
    });
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.isSuccess).toBe(true);
    const userId = createBody.data.id;
    expect(typeof userId).toBe("number");

    // Read back via detail
    const detailRes = await req("POST", "/api/query", adminUser, {
      type: "user.detail",
      payload: { id: userId },
    });
    expect(detailRes.status).toBe(200);
    const detailBody = await detailRes.json();
    expect(detailBody.data.email).toBe("marc@test.de");
    expect(detailBody.data.firstName).toBe("Marc");
    expect(detailBody.data.tenantId).toBe(1);
  });

  test("search works end-to-end", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "anna@test.de", firstName: "Anna" },
    });

    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "anna" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rows.some((r: Record<string, unknown>) => r["email"] === "anna@test.de")).toBe(
      true,
    );
  });

  test("tenant isolation: other tenant cannot see data", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "secret@tenant1.de" },
    });
    const userId = (await createRes.json()).data.id;

    const detailRes = await req("POST", "/api/query", otherTenantAdmin, {
      type: "user.detail",
      payload: { id: userId },
    });
    const body = await detailRes.json();
    expect(body.data).toBeNull();
  });
});

describe("full stack: auth + access control", () => {
  test("unauthenticated request is rejected", async () => {
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user.create", payload: { email: "x@x.de" } }),
    });
    expect(res.status).toBe(401);
  });

  test("guest cannot create user (access denied)", async () => {
    const res = await req("POST", "/api/write", guestUser, {
      type: "user.create",
      payload: { email: "guest@test.de" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("access");
  });
});

describe("full stack: validation pipeline", () => {
  test("zod schema rejects invalid email", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "not-an-email" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("validation");
  });

  test("validation hook rejects banned domain", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "banned@evil.com" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("banned_domain");
  });
});

describe("full stack: command (fire-and-forget)", () => {
  test("command creates user and returns 202", async () => {
    const res = await req("POST", "/api/command", adminUser, {
      type: "user.create",
      payload: { email: "command@test.de", firstName: "Command" },
    });
    expect(res.status).toBe(202);

    // Verify it actually landed in the DB
    const listRes = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "command@test.de" },
    });
    const body = await listRes.json();
    expect(
      body.data.rows.some((r: Record<string, unknown>) => r["email"] === "command@test.de"),
    ).toBe(true);
  });
});

describe("full stack: health check", () => {
  test("GET /health works without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
