import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer } from "../api/server";
import { createCrudExecutor } from "../db/crud-executor";
import type { DbConnection } from "../db/index";
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
import type { SearchAdapter } from "../search";
import { createInMemorySearchAdapter } from "../search";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../testing";

// --- Entity + Table ---

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
const searchFields = ["email", "firstName", "lastName"];

// --- Test infra ---

const JWT_SECRET = "full-stack-test-secret-minimum-32-chars!!";

let testDb: TestDb;
let testRedis: TestRedis;
let searchAdapter: SearchAdapter;
let app: ReturnType<typeof buildServer>["app"];
let jwt: ReturnType<typeof buildServer>["jwt"];

const adminUser: PipelineUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const guestUser: PipelineUser = { id: 2, tenantId: 1, roles: ["Guest"] };
const otherTenantAdmin: PipelineUser = { id: 3, tenantId: 2, roles: ["Admin"] };

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  searchAdapter = createInMemorySearchAdapter();
  // Tenant 1 — configure search for all fields
  await searchAdapter.configure(1, {
    searchableFields: ["email", "firstName", "lastName"],
    rankingFields: ["email", "firstName", "lastName"],
  });

  await testDb.db.execute(sql`
    CREATE TABLE fullstack_users (
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
      last_name TEXT,
      is_enabled BOOLEAN DEFAULT TRUE NOT NULL
    )
  `);

  // Feature defined here so it can close over searchAdapter
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
        const db = ctx["db"] as DbConnection;
        const sa = ctx["searchAdapter"] as SearchAdapter;
        const crud = createCrudExecutor(userTable, userEntity, {
          searchAdapter: sa,
          searchableFields: searchFields,
          entityName: "user",
        });
        return crud.create(event.payload, event.user, db);
      },
      { access: { roles: ["Admin"] } },
    );

    r.queryHandler(
      "user.list",
      z.object({
        search: z.string().optional(),
        limit: z.number().optional(),
        sort: z.string().optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
      }),
      async (query, ctx) => {
        const db = ctx["db"] as DbConnection;
        const sa = ctx["searchAdapter"] as SearchAdapter;
        const crud = createCrudExecutor(userTable, userEntity, {
          searchAdapter: sa,
          searchableFields: searchFields,
          entityName: "user",
        });
        return crud.list(query.payload, query.user, db);
      },
    );

    r.writeHandler(
      "user.update",
      z.object({ id: z.number(), changes: z.record(z.unknown()) }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        const sa = ctx["searchAdapter"] as SearchAdapter;
        const crud = createCrudExecutor(userTable, userEntity, {
          searchAdapter: sa,
          searchableFields: searchFields,
          entityName: "user",
        });
        return crud.update(event.payload, event.user, db);
      },
      { access: { roles: ["Admin"] } },
    );

    r.queryHandler("user.detail", z.object({ id: z.number() }), async (query, ctx) => {
      const db = ctx["db"] as DbConnection;
      const crud = createCrudExecutor(userTable, userEntity, {});
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

  const eventLog = createEventLog(testRedis.redis, "kumiko:test:fullstack-log");
  const registry = createRegistry([userFeature]);
  const server = buildServer({
    registry,
    context: { db: testDb.db, redis: testRedis.redis, searchAdapter },
    jwtSecret: JWT_SECRET,
    dispatcherOptions: { eventLog },
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

describe("full stack: HTTP -> Auth -> Dispatch -> DB", () => {
  test("create user via /api/write and read back via /api/query", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "marc@test.de", firstName: "Marc", lastName: "Test" },
    });
    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.isSuccess).toBe(true);
    const userId = createBody.data.id;
    expect(typeof userId).toBe("number");

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

  test("search via SearchAdapter end-to-end", async () => {
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

  test("search returns empty for no match", async () => {
    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "nonexistent-xyz-12345" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rows).toHaveLength(0);
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

describe("full stack: search + sorting combined", () => {
  test("sort results by lastName ASC", async () => {
    // Create users with known lastNames
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "sort-z@test.de", firstName: "Zara", lastName: "Zebra" },
    });
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "sort-a@test.de", firstName: "Adam", lastName: "Alpha" },
    });
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "sort-m@test.de", firstName: "Mia", lastName: "Mitte" },
    });

    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { sort: "lastName", sortDirection: "asc" },
    });
    const body = await res.json();
    const names = body.data.rows.map((r: Record<string, unknown>) => r["lastName"]).filter(Boolean);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  test("sort results by lastName DESC", async () => {
    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { sort: "lastName", sortDirection: "desc" },
    });
    const body = await res.json();
    const names = body.data.rows.map((r: Record<string, unknown>) => r["lastName"]).filter(Boolean);
    const sorted = [...names].sort().reverse();
    expect(names).toEqual(sorted);
  });

  test("search + sort combined: find and sort", async () => {
    // Search for "sort-" prefix in email, sort by lastName
    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "sort-", sort: "lastName", sortDirection: "asc" },
    });
    const body = await res.json();
    const names = body.data.rows.map((r: Record<string, unknown>) => r["lastName"]);
    expect(names).toEqual(["Alpha", "Mitte", "Zebra"]);
  });

  test("search scoring: email match ranks higher", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "findme@test.de", firstName: "Other", lastName: "Person" },
    });
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "other@test.de", firstName: "Findme", lastName: "Name" },
    });

    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "findme" },
    });
    const body = await res.json();
    // Both should be found
    expect(body.data.rows.length).toBeGreaterThanOrEqual(2);
    // Email match (findme@test.de) should come first due to ranking
    expect(body.data.rows[0]["email"]).toBe("findme@test.de");
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

    // Verify it actually landed — search via adapter
    const listRes = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "command" },
    });
    const body = await listRes.json();
    expect(
      body.data.rows.some((r: Record<string, unknown>) => r["email"] === "command@test.de"),
    ).toBe(true);
  });
});

describe("full stack: event log", () => {
  test("dispatched events are logged", async () => {
    const eventLog = createEventLog(testRedis.redis, "kumiko:test:fullstack-log");
    const recent = await eventLog.recent(50);
    // Previous tests should have logged events
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.some((e) => e.type === "user.create")).toBe(true);
  });
});

describe("full stack: SaveContext — changes + previous", () => {
  test("create returns isNew=true with changes and empty previous", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "ctx-create@test.de", firstName: "New" },
    });
    const body = await res.json();

    expect(body.isSuccess).toBe(true);
    expect(body.data.isNew).toBe(true);
    expect(body.data.changes).toEqual({ email: "ctx-create@test.de", firstName: "New" });
    expect(body.data.previous).toEqual({});
    expect(body.data.data["email"]).toBe("ctx-create@test.de");
  });

  test("update returns isNew=false with only changed fields and previous state", async () => {
    // Create
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "ctx-update@test.de", firstName: "Before", lastName: "Unchanged" },
    });
    const createBody = await createRes.json();
    const userId = createBody.data.id;

    // Update only firstName
    const updateRes = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, changes: { firstName: "After" } },
    });
    const updateBody = await updateRes.json();

    expect(updateBody.isSuccess).toBe(true);
    expect(updateBody.data.isNew).toBe(false);
    expect(updateBody.data.changes).toEqual({ firstName: "After" });
    expect(updateBody.data.previous["firstName"]).toBe("Before");
    expect(updateBody.data.previous["lastName"]).toBe("Unchanged");
    expect(updateBody.data.data["firstName"]).toBe("After");
    expect(updateBody.data.data["lastName"]).toBe("Unchanged");
  });

  test("status transition: only triggers on actual change", async () => {
    // This tests the pattern: "send email when status changes to Started"
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "status@test.de", firstName: "Draft" },
    });
    const userId = (await createRes.json()).data.id;

    // First update: change firstName to "Started"
    const update1 = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, changes: { firstName: "Started" } },
    });
    const body1 = await update1.json();
    expect(body1.data.changes["firstName"]).toBe("Started");
    expect(body1.data.previous["firstName"]).toBe("Draft");
    // Hook would detect: firstName changed from "Draft" to "Started" → trigger!

    // Second update: same value again
    const update2 = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, changes: { firstName: "Started" } },
    });
    const body2 = await update2.json();
    expect(body2.data.changes["firstName"]).toBe("Started");
    expect(body2.data.previous["firstName"]).toBe("Started");
    // Hook would detect: firstName "Started" → "Started" → NO trigger!
  });
});

describe("full stack: health check", () => {
  test("GET /health works without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
