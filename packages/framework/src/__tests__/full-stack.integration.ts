import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { buildServer } from "../api/server";
import { createSseBroker, type SseEvent } from "../api/sse-broker";
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
  type SaveContext,
} from "../engine";
import { type AuditTrailEntry, createEventLog } from "../pipeline";
import type { SearchAdapter } from "../search";
import { createInMemorySearchAdapter } from "../search";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../testing";

// --- Entities + Tables ---

const userEntity = createEntity({
  table: "fullstack_users",
  fields: {
    email: createTextField({ required: true, format: "email", searchable: true }),
    firstName: createTextField({ searchable: true }),
    lastName: createTextField({ searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
  searchWeight: 10,
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
let auditLog: AuditTrailEntry[];
let sseEvents: SseEvent[];

const adminUser: PipelineUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const guestUser: PipelineUser = { id: 2, tenantId: 1, roles: ["Guest"] };
const otherTenantAdmin: PipelineUser = { id: 3, tenantId: 2, roles: ["Admin"] };

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  searchAdapter = createInMemorySearchAdapter();
  auditLog = [];
  sseEvents = [];

  await searchAdapter.configure(1, {
    searchableFields: searchFields,
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

  // Feature with lifecycle hooks
  const postSaveLog: SaveContext[] = [];

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

    r.writeHandler(
      "user.update",
      z.object({ id: z.number(), version: z.number().optional(), changes: z.record(z.unknown()) }),
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

    r.writeHandler(
      "user.delete",
      z.object({ id: z.number() }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        const crud = createCrudExecutor(userTable, userEntity, { entityName: "user" });
        return crud.delete(event.payload, event.user, db);
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

    r.queryHandler("user.detail", z.object({ id: z.number() }), async (query, ctx) => {
      const db = ctx["db"] as DbConnection;
      const crud = createCrudExecutor(userTable, userEntity, { entityName: "user" });
      return crud.detail(query.payload, query.user, db);
    });

    // Feature-level postSave hook
    r.hook("postSave", "user", async (result) => {
      postSaveLog.push(result);
    });

    r.hook("validation", "user.create", (data) => {
      if (data["email"] === "banned@evil.com") return [{ field: "email", error: "banned_domain" }];
      return null;
    });

    r.translations({ keys: { "nav.title": { de: "Benutzer", en: "Users" } } });
  });

  // SSE Broker for tracking broadcasts
  const sseBroker = createSseBroker();
  sseBroker.addClient(
    "tenant:1",
    (event) => {
      sseEvents.push(event);
    },
    () => {},
  );

  // Audit Trail storage (in-memory for test)
  const _auditStorage = {
    append: async (entry: AuditTrailEntry) => {
      auditLog.push(entry);
    },
  };

  const registry = createRegistry([userFeature]);
  const eventLog = createEventLog(testRedis.redis, "kumiko:test:fullstack-log");

  const server = buildServer({
    registry,
    context: { db: testDb.db, redis: testRedis.redis, searchAdapter },
    jwtSecret: JWT_SECRET,
    dispatcherOptions: { eventLog },
    sseBroker,
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// =============================================================================
// CRUD: Create + Read
// =============================================================================

describe("full stack: CRUD", () => {
  test("create and read back", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "marc@test.de", firstName: "Marc", lastName: "Test" },
    });
    expect(createRes.status).toBe(200);
    const body = await createRes.json();
    expect(body.isSuccess).toBe(true);
    expect(body.data.isNew).toBe(true);
    const userId = body.data.id;

    const detailRes = await req("POST", "/api/query", adminUser, {
      type: "user.detail",
      payload: { id: userId },
    });
    const detail = await detailRes.json();
    expect(detail.data.email).toBe("marc@test.de");
    expect(detail.data.version).toBe(1);
  });

  test("delete (soft) removes from queries", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "todelete@test.de" },
    });
    const userId = (await createRes.json()).data.id;

    const deleteRes = await req("POST", "/api/write", adminUser, {
      type: "user.delete",
      payload: { id: userId },
    });
    const deleteBody = await deleteRes.json();
    expect(deleteBody.isSuccess).toBe(true);
    expect(deleteBody.data.data["email"]).toBe("todelete@test.de");

    const detailRes = await req("POST", "/api/query", adminUser, {
      type: "user.detail",
      payload: { id: userId },
    });
    expect((await detailRes.json()).data).toBeNull();
  });
});

// =============================================================================
// SaveContext: changes + previous
// =============================================================================

describe("full stack: SaveContext", () => {
  test("create returns isNew=true, empty previous", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "ctx-new@test.de", firstName: "New" },
    });
    const body = await res.json();
    expect(body.data.isNew).toBe(true);
    expect(body.data.changes).toEqual({ email: "ctx-new@test.de", firstName: "New" });
    expect(body.data.previous).toEqual({});
  });

  test("update returns isNew=false with exact changes and previous", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "ctx-upd@test.de", firstName: "Before", lastName: "Keep" },
    });
    const userId = (await createRes.json()).data.id;

    const updateRes = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, changes: { firstName: "After" } },
    });
    const body = await updateRes.json();
    expect(body.data.isNew).toBe(false);
    expect(body.data.changes).toEqual({ firstName: "After" });
    expect(body.data.previous["firstName"]).toBe("Before");
    expect(body.data.previous["lastName"]).toBe("Keep");
    expect(body.data.data["firstName"]).toBe("After");
  });

  test("status transition detection", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "status@test.de", firstName: "Draft" },
    });
    const userId = (await createRes.json()).data.id;

    // Draft → Started
    const u1 = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, changes: { firstName: "Started" } },
    });
    const b1 = await u1.json();
    expect(b1.data.previous["firstName"]).toBe("Draft");
    expect(b1.data.changes["firstName"]).toBe("Started");

    // Started → Started (no real change)
    const u2 = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, changes: { firstName: "Started" } },
    });
    const b2 = await u2.json();
    expect(b2.data.previous["firstName"]).toBe("Started");
    expect(b2.data.changes["firstName"]).toBe("Started");
    // Hook can detect: previous === changes → no transition
  });
});

// =============================================================================
// Optimistic Locking
// =============================================================================

describe("full stack: optimistic locking", () => {
  test("update with correct version succeeds", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "lock-ok@test.de" },
    });
    const userId = (await createRes.json()).data.id;

    const updateRes = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, version: 1, changes: { firstName: "V2" } },
    });
    const body = await updateRes.json();
    expect(body.isSuccess).toBe(true);
    expect(body.data.data["version"]).toBe(2);
  });

  test("update with stale version returns version_conflict", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "lock-fail@test.de" },
    });
    const userId = (await createRes.json()).data.id;

    // First update OK
    await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, version: 1, changes: { firstName: "V2" } },
    });

    // Second update with stale version 1 (current is 2)
    const staleRes = await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: userId, version: 1, changes: { firstName: "Stale" } },
    });
    const body = await staleRes.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error).toContain("version_conflict");
  });
});

// =============================================================================
// Search
// =============================================================================

describe("full stack: search", () => {
  test("search via SearchAdapter", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "findable@test.de", firstName: "Findable" },
    });

    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "findable" },
    });
    const body = await res.json();
    expect(
      body.data.rows.some((r: Record<string, unknown>) => r["email"] === "findable@test.de"),
    ).toBe(true);
  });

  test("search returns empty for no match", async () => {
    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "zzzzzznonexistent" },
    });
    expect((await res.json()).data.rows).toHaveLength(0);
  });
});

// =============================================================================
// Sorting
// =============================================================================

describe("full stack: sorting", () => {
  test("sort by lastName ASC", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "s-z@test.de", lastName: "Zebra" },
    });
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "s-a@test.de", lastName: "Alpha" },
    });

    const res = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { sort: "lastName", sortDirection: "asc" },
    });
    const names = (await res.json()).data.rows
      .map((r: Record<string, unknown>) => r["lastName"])
      .filter(Boolean);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

// =============================================================================
// Auth + Access
// =============================================================================

describe("full stack: auth", () => {
  test("unauthenticated → 401", async () => {
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user.create", payload: { email: "x@x.de" } }),
    });
    expect(res.status).toBe(401);
  });

  test("guest → access denied", async () => {
    const res = await req("POST", "/api/write", guestUser, {
      type: "user.create",
      payload: { email: "guest@test.de" },
    });
    expect((await res.json()).error).toContain("access");
  });

  test("other tenant cannot see data", async () => {
    const createRes = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "secret@test.de" },
    });
    const userId = (await createRes.json()).data.id;

    const detailRes = await req("POST", "/api/query", otherTenantAdmin, {
      type: "user.detail",
      payload: { id: userId },
    });
    expect((await detailRes.json()).data).toBeNull();
  });
});

// =============================================================================
// Validation
// =============================================================================

describe("full stack: validation", () => {
  test("zod rejects invalid email", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "not-email" },
    });
    expect((await res.json()).error).toContain("validation");
  });

  test("validation hook rejects banned domain", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "banned@evil.com" },
    });
    expect((await res.json()).error).toContain("banned_domain");
  });
});

// =============================================================================
// Command (fire-and-forget)
// =============================================================================

describe("full stack: command", () => {
  test("returns 202 and data lands in DB", async () => {
    const res = await req("POST", "/api/command", adminUser, {
      type: "user.create",
      payload: { email: "cmd@test.de", firstName: "Cmd" },
    });
    expect(res.status).toBe(202);

    const listRes = await req("POST", "/api/query", adminUser, {
      type: "user.list",
      payload: { search: "cmd" },
    });
    expect(
      (await listRes.json()).data.rows.some(
        (r: Record<string, unknown>) => r["email"] === "cmd@test.de",
      ),
    ).toBe(true);
  });
});

// =============================================================================
// Event Log
// =============================================================================

describe("full stack: event log", () => {
  test("events are logged in Redis", async () => {
    const eventLog = createEventLog(testRedis.redis, "kumiko:test:fullstack-log");
    const recent = await eventLog.recent(100);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.some((e) => e.type === "user.create")).toBe(true);
  });
});

// =============================================================================
// SSE
// =============================================================================

describe("full stack: SSE", () => {
  test("GET /api/sse requires auth", async () => {
    const res = await app.request("/api/sse");
    expect(res.status).toBe(401);
  });

  test("GET /api/sse with auth returns event stream", async () => {
    const token = await jwt.sign(adminUser);
    const res = await app.request("/api/sse", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});

// =============================================================================
// Health
// =============================================================================

describe("full stack: health", () => {
  test("GET /health works without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
