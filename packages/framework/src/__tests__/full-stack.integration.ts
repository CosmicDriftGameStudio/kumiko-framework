import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createCrudExecutor } from "../db/crud-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
  type SaveContext,
} from "../engine";
import { ErrorCodes } from "../engine/constants";
import { createEventLog } from "../pipeline";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "../testing";

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

// --- Feature-level hook log (not a system hook, tracked separately) ---

const featurePostSaveLog: SaveContext[] = [];

// --- Feature definition ---

function userCrud(ctx: { searchAdapter?: unknown; entityCache?: unknown }) {
  return createCrudExecutor(userTable, userEntity, {
    entityName: "user",
    ...(ctx.searchAdapter
      ? { searchAdapter: ctx.searchAdapter as import("../search").SearchAdapter }
      : {}),
    ...(ctx.entityCache
      ? { entityCache: ctx.entityCache as import("../pipeline/entity-cache").EntityCache }
      : {}),
  });
}

const userFeature = defineFeature("users", (r) => {
  const user = r.entity("user", userEntity);

  const createHandler = r.writeHandler(
    "user:create",
    z.object({
      email: z.email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    }),
    async (event, ctx) => userCrud(ctx).create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "user:update",
    z.object({
      id: z.number(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) => userCrud(ctx).update(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "user:delete",
    z.object({ id: z.number() }),
    async (event, ctx) => userCrud(ctx).delete(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "user:list",
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
      sort: z.string().optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
    }),
    async (query, ctx) => userCrud(ctx).list(query.payload, query.user, ctx.db),
  );

  r.queryHandler("user:detail", z.object({ id: z.number() }), async (query, ctx) =>
    userCrud(ctx).detail(query.payload, query.user, ctx.db),
  );

  r.entityHook("postSave", user, async (result) => {
    featurePostSaveLog.push(result);
  });

  r.hook("validation", createHandler, (data) => {
    if (data["email"] === "banned@evil.com") return [{ field: "email", error: "banned_domain" }];
    return null;
  });
});

// --- Stack + Users ---

let stack: TestStack;

const adminUser = TestUsers.admin;
const guestUser = createTestUser({ id: 2, roles: ["Guest"] });
const otherTenantAdmin = createTestUser({ id: 3, tenantId: 2 });

beforeAll(async () => {
  stack = await setupTestStack({ features: [userFeature] });

  await createEntityTable(stack.db.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
  featurePostSaveLog.length = 0;
});

// =============================================================================
// CRUD
// =============================================================================

describe("full stack: CRUD", () => {
  test("create and read back", async () => {
    const data = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "marc@test.de",
        firstName: "Marc",
        lastName: "Test",
      },
      adminUser,
    );
    expect(data["isNew"]).toBe(true);

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "users:query:user:detail",
      { id: data["id"] },
      adminUser,
    );
    expect(detail["email"]).toBe("marc@test.de");
    expect(detail["version"]).toBe(1);
  });

  test("soft delete removes from queries", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "del@test.de",
      },
      adminUser,
    );

    const del = await stack.http.writeOk(
      "users:write:user:delete",
      {
        id: created["id"],
      },
      adminUser,
    );
    expect(del).toBeDefined();

    const detail = await stack.http.queryOk<null>(
      "users:query:user:detail",
      { id: created["id"] },
      adminUser,
    );
    expect(detail).toBeNull();
  });

  test("delete triggers audit trail via postDelete hook", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "audit-del@test.de",
      },
      adminUser,
    );

    stack.events.reset();

    await stack.http.writeOk("users:write:user:delete", { id: created["id"] }, adminUser);

    const deleteEntry = stack.events.audit.find((e) => e.action === "users:write:user:delete");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry?.entityType).toBe("user");
    expect(deleteEntry?.entityId).toBe(created["id"]);
    expect(deleteEntry?.isNew).toBe(false);
  });
});

// =============================================================================
// SaveContext
// =============================================================================

describe("full stack: SaveContext changes + previous", () => {
  test("update returns exact changes and previous state", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "ctx@test.de",
        firstName: "Before",
        lastName: "Keep",
      },
      adminUser,
    );

    const updated = await stack.http.writeOk(
      "users:write:user:update",
      {
        id: created["id"],
        changes: { firstName: "After" },
      },
      adminUser,
    );

    expect(updated["isNew"]).toBe(false);
    expect(updated["changes"]).toEqual({ firstName: "After" });
    expect((updated["previous"] as Record<string, unknown>)["firstName"]).toBe("Before");
    expect((updated["previous"] as Record<string, unknown>)["lastName"]).toBe("Keep");
    expect((updated["data"] as Record<string, unknown>)["firstName"]).toBe("After");
  });
});

// =============================================================================
// Optimistic Locking
// =============================================================================

describe("full stack: optimistic locking", () => {
  test("stale version returns version_conflict", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "lock@test.de",
      },
      adminUser,
    );

    await stack.http.writeOk(
      "users:write:user:update",
      {
        id: created["id"],
        version: 1,
        changes: { firstName: "V2" },
      },
      adminUser,
    );

    const error = await stack.http.writeErr(
      "users:write:user:update",
      {
        id: created["id"],
        version: 1,
        changes: { firstName: "Stale" },
      },
      adminUser,
    );

    expect(error).toContain(ErrorCodes.versionConflict);
  });
});

// =============================================================================
// System Hooks ACTUALLY FIRE
// =============================================================================

describe("full stack: lifecycle pipeline — system hooks fire", () => {
  test("feature postSave hook receives SaveContext", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "hook@test.de",
        firstName: "Hooked",
      },
      adminUser,
    );

    expect(featurePostSaveLog).toHaveLength(1);
    expect(featurePostSaveLog[0]?.data["email"]).toBe("hook@test.de");
    expect(featurePostSaveLog[0]?.isNew).toBe(true);
  });

  test("audit trail system hook captures create", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "audit@test.de",
      },
      adminUser,
    );

    expect(stack.events.audit).toHaveLength(1);
    expect(stack.events.audit[0]?.action).toBe("users:write:user:create");
    expect(stack.events.audit[0]?.entityType).toBe("user");
    expect(stack.events.audit[0]?.isNew).toBe(true);
    expect(stack.events.audit[0]?.userId).toBe(1);
  });

  test("audit trail system hook captures update with changes + previous", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "audit-upd@test.de",
        firstName: "Old",
      },
      adminUser,
    );

    stack.events.reset();

    await stack.http.writeOk(
      "users:write:user:update",
      {
        id: created["id"],
        changes: { firstName: "New" },
      },
      adminUser,
    );

    const updateEntry = stack.events.audit.find((e) => e.action === "users:write:user:update");
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.changes["firstName"]).toBe("New");
    expect(updateEntry?.previous["firstName"]).toBe("Old");
    expect(updateEntry?.isNew).toBe(false);
  });

  test("SSE broadcast fires on create", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "sse@test.de",
      },
      adminUser,
    );

    expect(stack.events.sse).toHaveLength(1);
    expect(stack.events.sse[0]?.type).toBe("system:event:user:created");
    expect(stack.events.sse[0]?.data["id"]).toBeDefined();
  });

  test("SSE broadcast fires on update", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "sse-upd@test.de",
      },
      adminUser,
    );

    stack.events.reset();

    await stack.http.writeOk(
      "users:write:user:update",
      {
        id: created["id"],
        changes: { firstName: "SSE" },
      },
      adminUser,
    );

    const updateEvent = stack.events.sse.find((e) => e.type === "system:event:user:updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.data["changes"]).toEqual({ firstName: "SSE" });
  });

  test("search index updated via system hook after create", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "indexed@test.de",
        firstName: "Indexed",
      },
      adminUser,
    );

    const results = await stack.search.search(1, "indexed", { filterType: "user" });
    expect(results.some((r) => r.entityType === "user")).toBe(true);
  });
});

// =============================================================================
// Auth + Access + Validation + Tenant Isolation
// =============================================================================

describe("full stack: auth + access + validation", () => {
  test("unauthenticated → 401", async () => {
    const res = await stack.app.request("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "users:write:user:create", payload: { email: "x@x.de" } }),
    });
    expect(res.status).toBe(401);
  });

  test("guest → access denied", async () => {
    const error = await stack.http.writeErr(
      "users:write:user:create",
      {
        email: "guest@test.de",
      },
      guestUser,
    );
    expect(error).toContain("access");
  });

  test("other tenant cannot see data", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "secret@test.de",
      },
      adminUser,
    );

    const detail = await stack.http.queryOk<null>(
      "users:query:user:detail",
      { id: created["id"] },
      otherTenantAdmin,
    );
    expect(detail).toBeNull();
  });

  test("validation hook rejects banned domain", async () => {
    const error = await stack.http.writeErr(
      "users:write:user:create",
      {
        email: "banned@evil.com",
      },
      adminUser,
    );
    expect(error).toContain("banned_domain");
  });
});

// =============================================================================
// Search + Sort
// =============================================================================

describe("full stack: search + sort", () => {
  test("search finds via SearchAdapter", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "findable@test.de",
        firstName: "Findable",
      },
      adminUser,
    );

    const res = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "users:query:user:list",
      { search: "findable" },
      adminUser,
    );
    expect(res.rows.some((r) => r["email"] === "findable@test.de")).toBe(true);
  });

  test("sort by lastName ASC", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "sz@test.de",
        lastName: "Zebra",
      },
      adminUser,
    );
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "sa@test.de",
        lastName: "Alpha",
      },
      adminUser,
    );

    const res = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "users:query:user:list",
      { sort: "lastName", sortDirection: "asc" },
      adminUser,
    );

    const names = res.rows.map((r) => r["lastName"]).filter(Boolean);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

// =============================================================================
// Event Log + SSE Route + Health
// =============================================================================

describe("full stack: event log", () => {
  test("events logged in Redis", async () => {
    // Create at least one event first
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "eventlog@test.de",
      },
      adminUser,
    );

    const eventLog = createEventLog(stack.redis.redis, "kumiko:test:stack-log");
    const recent = await eventLog.recent(100);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.some((e) => e.type === "users:write:user:create")).toBe(true);
  });
});

describe("full stack: SSE route", () => {
  test("requires auth", async () => {
    expect((await stack.app.request("/api/sse")).status).toBe(401);
  });

  test("returns event stream", async () => {
    const token = await stack.jwt.sign(adminUser);
    const res = await stack.app.request("/api/sse", {
      headers: { Authorization: `Bearer ${token}` },
    });
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

    const res1 = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "idem@test.de",
      },
      adminUser,
      requestId,
    );
    const firstId = res1["id"];

    // Same requestId → should return cached result, NOT create a second user
    const res2 = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "idem@test.de",
      },
      adminUser,
      requestId,
    );
    expect(res2["id"]).toBe(firstId);
  });

  test("different requestIds create separate records", async () => {
    const res1 = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "idem-a@test.de",
      },
      adminUser,
      "idem-a",
    );

    const res2 = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "idem-b@test.de",
      },
      adminUser,
      "idem-b",
    );

    expect(res1["id"]).not.toBe(res2["id"]);
  });
});

// =============================================================================
// Request Context (X-Request-ID)
// =============================================================================

describe("full stack: request context", () => {
  test("response contains X-Request-ID header", async () => {
    const token = await stack.jwt.sign(adminUser);
    const res = await stack.app.request("/api/write", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "users:write:user:create",
        payload: { email: "reqid@test.de" },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-ID")).toBeDefined();
    expect(res.headers.get("X-Request-ID")?.length).toBeGreaterThan(0);
  });

  test("echoes back client-provided X-Request-ID", async () => {
    const token = await stack.jwt.sign(adminUser);
    const res = await stack.app.request("/api/write", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Request-ID": "client-req-42",
      },
      body: JSON.stringify({
        type: "users:write:user:create",
        payload: { email: "echoid@test.de" },
      }),
    });
    expect(res.headers.get("X-Request-ID")).toBe("client-req-42");
  });

  test("error responses include requestId", async () => {
    const token = await stack.jwt.sign(guestUser);
    const res = await stack.app.request("/api/write", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Request-ID": "err-req-99",
      },
      body: JSON.stringify({
        type: "users:write:user:create",
        payload: { email: "denied@test.de" },
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["requestId"]).toBe("err-req-99");
  });
});

// =============================================================================
// Entity Cache
// =============================================================================

describe("full stack: entity cache", () => {
  test("detail returns cached data after create (no second DB hit needed)", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      { email: "cached@test.de", firstName: "Cached" },
      adminUser,
    );

    // Detail should return the same data (from cache or DB — both valid)
    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "users:query:user:detail",
      { id: created["id"] },
      adminUser,
    );
    expect(detail["email"]).toBe("cached@test.de");
  });

  test("cache serves stale data until invalidated by update", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      { email: "stale@test.de", firstName: "Before" },
      adminUser,
    );
    const id = created["id"] as number;

    // First detail populates cache
    await stack.http.queryOk("users:query:user:detail", { id }, adminUser);

    // Raw DB update — bypasses cache invalidation
    const { eq } = await import("drizzle-orm");
    await stack.db.db
      .update(userTable)
      .set({ firstName: "RawDbChange" })
      .where(eq(userTable["id"], id));

    // Detail still returns cached (old) value
    const stale = await stack.http.queryOk<Record<string, unknown>>(
      "users:query:user:detail",
      { id },
      adminUser,
    );
    expect(stale["firstName"]).toBe("Before");

    // Update via API — invalidates cache
    await stack.http.writeOk(
      "users:write:user:update",
      { id, changes: { firstName: "AfterUpdate" } },
      adminUser,
    );

    // Now detail returns fresh data
    const fresh = await stack.http.queryOk<Record<string, unknown>>(
      "users:query:user:detail",
      { id },
      adminUser,
    );
    expect(fresh["firstName"]).toBe("AfterUpdate");
  });

  test("delete invalidates cache", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      { email: "delcache@test.de" },
      adminUser,
    );
    const id = created["id"] as number;

    // Populate cache
    await stack.http.queryOk("users:query:user:detail", { id }, adminUser);

    // Delete via API
    await stack.http.writeOk("users:write:user:delete", { id }, adminUser);

    // Detail returns null (soft deleted + cache invalidated)
    const gone = await stack.http.queryOk<null>("users:query:user:detail", { id }, adminUser);
    expect(gone).toBeNull();
  });
});

// =============================================================================
// Health
// =============================================================================

describe("full stack: health", () => {
  test("GET /health", async () => {
    expect(await (await stack.app.request("/health")).json()).toEqual({ status: "ok" });
  });
});
