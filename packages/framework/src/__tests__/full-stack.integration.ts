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
  type SessionUser,
  type SaveContext,
} from "../engine";
import {
  type AuditTrailEntry,
  createEventLog,
  createIdempotencyGuard,
  type SystemHooks,
} from "../pipeline";
import {
  createAuditTrailHook,
  createSearchIndexHook,
  createSseBroadcastHook,
} from "../pipeline/system-hooks";
import type { SearchAdapter } from "../search";
import { createInMemorySearchAdapter } from "../search";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../testing";

// --- Entities ---

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

// --- Test state that system hooks write to ---

let testDb: TestDb;
let testRedis: TestRedis;
let searchAdapter: SearchAdapter;
let app: ReturnType<typeof buildServer>["app"];
let jwt: ReturnType<typeof buildServer>["jwt"];
const auditLog: AuditTrailEntry[] = [];
const sseEvents: SseEvent[] = [];
const featurePostSaveLog: SaveContext[] = [];

const adminUser: SessionUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const guestUser: SessionUser = { id: 2, tenantId: 1, roles: ["Guest"] };
const otherTenantAdmin: SessionUser = { id: 3, tenantId: 2, roles: ["Admin"] };
const JWT_SECRET = "full-stack-test-secret-minimum-32-chars!!";

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  searchAdapter = createInMemorySearchAdapter();

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

  // SSE Broker — capture events sent to tenant:1
  const sseBroker = createSseBroker();
  sseBroker.addClient(
    "tenant:1",
    (event) => sseEvents.push(event),
    () => {},
  );

  // Feature with REAL postSave hook
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
          entityName: "user",
        });
        return crud.list(query.payload, query.user, db);
      },
    );

    r.queryHandler("user.detail", z.object({ id: z.number() }), async (query, ctx) => {
      const db = ctx["db"] as DbConnection;
      const crud = createCrudExecutor(userTable, userEntity, {});
      return crud.detail(query.payload, query.user, db);
    });

    // Feature-level postSave hook — proves feature hooks fire
    r.hook("postSave", "user", async (result) => {
      featurePostSaveLog.push(result);
    });

    r.hook("validation", "user.create", (data) => {
      if (data["email"] === "banned@evil.com") return [{ field: "email", error: "banned_domain" }];
      return null;
    });
  });

  const registry = createRegistry([userFeature]);

  // REAL system hooks — wired through lifecycle pipeline
  const systemHooks: SystemHooks = {
    postSave: [
      createSearchIndexHook(searchAdapter, registry),
      createSseBroadcastHook(sseBroker),
      createAuditTrailHook({
        append: async (entry) => {
          auditLog.push(entry);
        },
      }),
    ],
  };

  const eventLog = createEventLog(testRedis.redis, "kumiko:test:fullstack-log");
  const idempotency = createIdempotencyGuard(testRedis.redis, { ttlSeconds: 60 });

  const server = buildServer({
    registry,
    context: { db: testDb.db, redis: testRedis.redis, searchAdapter },
    jwtSecret: JWT_SECRET,
    dispatcherOptions: { eventLog, idempotency },
    systemHooks,
    sseBroker,
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

// =============================================================================
// CRUD
// =============================================================================

describe("full stack: CRUD", () => {
  test("create and read back", async () => {
    const res = await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "marc@test.de", firstName: "Marc", lastName: "Test" },
    });
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.data.isNew).toBe(true);

    const detail = await req("POST", "/api/query", adminUser, {
      type: "user.detail",
      payload: { id: body.data.id },
    });
    const d = await detail.json();
    expect(d.data.email).toBe("marc@test.de");
    expect(d.data.version).toBe(1);
  });

  test("soft delete removes from queries", async () => {
    const c = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "del@test.de" },
      })
    ).json();

    const del = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.delete",
        payload: { id: c.data.id },
      })
    ).json();
    expect(del.isSuccess).toBe(true);

    const d = await (
      await req("POST", "/api/query", adminUser, {
        type: "user.detail",
        payload: { id: c.data.id },
      })
    ).json();
    expect(d.data).toBeNull();
  });
});

// =============================================================================
// SaveContext
// =============================================================================

describe("full stack: SaveContext changes + previous", () => {
  test("update returns exact changes and previous state", async () => {
    const c = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "ctx@test.de", firstName: "Before", lastName: "Keep" },
      })
    ).json();

    const u = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.update",
        payload: { id: c.data.id, changes: { firstName: "After" } },
      })
    ).json();

    expect(u.data.isNew).toBe(false);
    expect(u.data.changes).toEqual({ firstName: "After" });
    expect(u.data.previous["firstName"]).toBe("Before");
    expect(u.data.previous["lastName"]).toBe("Keep");
    expect(u.data.data["firstName"]).toBe("After");
  });
});

// =============================================================================
// Optimistic Locking
// =============================================================================

describe("full stack: optimistic locking", () => {
  test("stale version returns version_conflict", async () => {
    const c = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "lock@test.de" },
      })
    ).json();

    await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: c.data.id, version: 1, changes: { firstName: "V2" } },
    });

    const stale = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.update",
        payload: { id: c.data.id, version: 1, changes: { firstName: "Stale" } },
      })
    ).json();

    expect(stale.isSuccess).toBe(false);
    expect(stale.error).toContain("version_conflict");
  });
});

// =============================================================================
// System Hooks ACTUALLY FIRE
// =============================================================================

describe("full stack: lifecycle pipeline — system hooks fire", () => {
  test("feature postSave hook receives SaveContext", async () => {
    const before = featurePostSaveLog.length;

    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "hook@test.de", firstName: "Hooked" },
    });

    expect(featurePostSaveLog.length).toBeGreaterThan(before);
    const last = featurePostSaveLog[featurePostSaveLog.length - 1];
    expect(last?.data["email"]).toBe("hook@test.de");
    expect(last?.isNew).toBe(true);
  });

  test("audit trail system hook captures create", async () => {
    const before = auditLog.length;

    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "audit@test.de" },
    });

    expect(auditLog.length).toBeGreaterThan(before);
    const last = auditLog[auditLog.length - 1];
    expect(last?.action).toBe("user.create");
    expect(last?.entityType).toBe("user");
    expect(last?.isNew).toBe(true);
    expect(last?.userId).toBe(1);
  });

  test("audit trail system hook captures update with changes + previous", async () => {
    const c = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "audit-upd@test.de", firstName: "Old" },
      })
    ).json();

    const beforeLen = auditLog.length;

    await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: c.data.id, changes: { firstName: "New" } },
    });

    const updateEntry = auditLog.slice(beforeLen).find((e) => e.action === "user.update");
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.changes["firstName"]).toBe("New");
    expect(updateEntry?.previous["firstName"]).toBe("Old");
    expect(updateEntry?.isNew).toBe(false);
  });

  test("SSE broadcast fires on create", async () => {
    const before = sseEvents.length;

    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "sse@test.de" },
    });

    expect(sseEvents.length).toBeGreaterThan(before);
    const last = sseEvents[sseEvents.length - 1];
    expect(last?.type).toBe("user.created");
    expect(last?.data["id"]).toBeDefined();
  });

  test("SSE broadcast fires on update", async () => {
    const c = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "sse-upd@test.de" },
      })
    ).json();

    const before = sseEvents.length;

    await req("POST", "/api/write", adminUser, {
      type: "user.update",
      payload: { id: c.data.id, changes: { firstName: "SSE" } },
    });

    const updateEvent = sseEvents.slice(before).find((e) => e.type === "user.updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.data["changes"]).toEqual({ firstName: "SSE" });
  });

  test("search index updated via system hook after create", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "indexed@test.de", firstName: "Indexed" },
    });

    // Search should find it — indexed by system hook, not CrudExecutor
    const results = await searchAdapter.search(1, "indexed", { filterType: "user" });
    expect(results.some((r) => r.entityType === "user")).toBe(true);
  });
});

// =============================================================================
// Auth + Access + Validation + Tenant Isolation
// =============================================================================

describe("full stack: auth + access + validation", () => {
  test("unauthenticated → 401", async () => {
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user.create", payload: { email: "x@x.de" } }),
    });
    expect(res.status).toBe(401);
  });

  test("guest → access denied", async () => {
    const res = await (
      await req("POST", "/api/write", guestUser, {
        type: "user.create",
        payload: { email: "guest@test.de" },
      })
    ).json();
    expect(res.error).toContain("access");
  });

  test("other tenant cannot see data", async () => {
    const c = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "secret@test.de" },
      })
    ).json();

    const d = await (
      await req("POST", "/api/query", otherTenantAdmin, {
        type: "user.detail",
        payload: { id: c.data.id },
      })
    ).json();
    expect(d.data).toBeNull();
  });

  test("validation hook rejects banned domain", async () => {
    const res = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "banned@evil.com" },
      })
    ).json();
    expect(res.error).toContain("banned_domain");
  });
});

// =============================================================================
// Search + Sort
// =============================================================================

describe("full stack: search + sort", () => {
  test("search finds via SearchAdapter", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "findable@test.de", firstName: "Findable" },
    });

    const res = await (
      await req("POST", "/api/query", adminUser, {
        type: "user.list",
        payload: { search: "findable" },
      })
    ).json();
    expect(
      res.data.rows.some((r: Record<string, unknown>) => r["email"] === "findable@test.de"),
    ).toBe(true);
  });

  test("sort by lastName ASC", async () => {
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "sz@test.de", lastName: "Zebra" },
    });
    await req("POST", "/api/write", adminUser, {
      type: "user.create",
      payload: { email: "sa@test.de", lastName: "Alpha" },
    });

    const res = await (
      await req("POST", "/api/query", adminUser, {
        type: "user.list",
        payload: { sort: "lastName", sortDirection: "asc" },
      })
    ).json();

    const names = res.data.rows.map((r: Record<string, unknown>) => r["lastName"]).filter(Boolean);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

// =============================================================================
// Event Log + SSE Route + Health
// =============================================================================

describe("full stack: event log", () => {
  test("events logged in Redis", async () => {
    const eventLog = createEventLog(testRedis.redis, "kumiko:test:fullstack-log");
    const recent = await eventLog.recent(100);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.some((e) => e.type === "user.create")).toBe(true);
  });
});

describe("full stack: SSE route", () => {
  test("requires auth", async () => {
    expect((await app.request("/api/sse")).status).toBe(401);
  });

  test("returns event stream", async () => {
    const token = await jwt.sign(adminUser);
    const res = await app.request("/api/sse", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});

// =============================================================================
// Idempotency (Redis-backed, end-to-end)
// =============================================================================

describe("full stack: idempotency", () => {
  test("duplicate requestId returns cached result, no double insert", async () => {
    const requestId = "idem-fullstack-001";

    const res1 = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "idem@test.de" },
        requestId,
      })
    ).json();
    expect(res1.isSuccess).toBe(true);
    const firstId = res1.data.id;

    // Same requestId → should return cached result, NOT create a second user
    const res2 = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "idem@test.de" },
        requestId,
      })
    ).json();
    expect(res2.isSuccess).toBe(true);
    expect(res2.data.id).toBe(firstId);
  });

  test("different requestIds create separate records", async () => {
    const res1 = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "idem-a@test.de" },
        requestId: "idem-a",
      })
    ).json();

    const res2 = await (
      await req("POST", "/api/write", adminUser, {
        type: "user.create",
        payload: { email: "idem-b@test.de" },
        requestId: "idem-b",
      })
    ).json();

    expect(res1.data.id).not.toBe(res2.data.id);
  });
});

// =============================================================================
// Health
// =============================================================================

describe("full stack: health", () => {
  test("GET /health", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ status: "ok" });
  });
});
