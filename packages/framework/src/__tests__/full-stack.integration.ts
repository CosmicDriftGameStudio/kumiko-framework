import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createCrudExecutor } from "../db/crud-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
  type HandlerContext,
  type SaveContext,
} from "../engine";
import { ErrorCodes } from "../engine/constants";
import { createEventLog, eventOutboxTable } from "../pipeline";
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

// Single source of truth for the user-created event name + payload shape.
// Every handler that touches this event goes through emitUserCreated so the
// event contract can't drift between handlers.
const USER_CREATED_EVENT = "users:event:user.created";

async function emitUserCreated(
  ctx: Pick<HandlerContext, "emit">,
  id: number,
  email: string,
): Promise<void> {
  await ctx.emit(USER_CREATED_EVENT, { id, email });
}

const userFeature = defineFeature("users", (r) => {
  const user = r.entity("user", userEntity);

  r.defineEvent("user.created", z.object({ id: z.number(), email: z.string() }));

  const createHandler = r.writeHandler(
    "user:create",
    z.object({
      email: z.email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    }),
    async (event, ctx) => {
      const result = await userCrud(ctx).create(event.payload, event.user, ctx.db);
      if (result.isSuccess) {
        await emitUserCreated(ctx, result.data.id, event.payload.email);
      }
      return result;
    },
    { access: { roles: ["Admin"] } },
  );

  // Rollback via controlled failure: writes to the user table AND emits into
  // the outbox, then deliberately returns isSuccess:false. The dispatcher
  // raises BatchRollback, the surrounding tx rolls back — so NEITHER the user
  // row NOR the outbox row survive. Proves the controlled-failure path.
  r.writeHandler(
    "user:create-rollback",
    z.object({ email: z.email() }),
    async (event, ctx) => {
      const created = await userCrud(ctx).create(event.payload, event.user, ctx.db);
      if (created.isSuccess) {
        await emitUserCreated(ctx, created.data.id, event.payload.email);
      }
      return { isSuccess: false, error: "intentional_rollback" };
    },
    { access: { roles: ["Admin"] } },
  );

  // Rollback via uncaught throw: emits TWICE, then throws. Exercises a
  // different dispatcher branch than isSuccess:false — the generic catch block
  // that wraps BatchRollback. Proves that:
  //   (a) an uncaught error rolls the tx back just like a controlled failure,
  //   (b) multiple outbox rows from the same handler roll back together.
  r.writeHandler(
    "user:create-throw",
    z.object({ email: z.email() }),
    async (event, ctx) => {
      const created = await userCrud(ctx).create(event.payload, event.user, ctx.db);
      if (!created.isSuccess) return created;
      await emitUserCreated(ctx, created.data.id, event.payload.email);
      await emitUserCreated(ctx, created.data.id, `${event.payload.email}.secondary`);
      throw new Error("unexpected_handler_failure");
    },
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

// Outbox subscriber — captures events the poller delivers. Populated inside
// beforeAll; reset per-test in beforeEach so the transactional-outbox block
// can assert exact call counts.
const outboxSubscriberCalls: Array<{ type: string; payload: unknown }> = [];

beforeAll(async () => {
  stack = await setupTestStack({ features: [userFeature], outbox: true });

  await createEntityTable(stack.db.db, userEntity);

  stack.eventBroker?.subscribe(USER_CREATED_EVENT, async (event) => {
    outboxSubscriberCalls.push(event);
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  featurePostSaveLog.length = 0;
  outboxSubscriberCalls.length = 0;
  // Every previous write emits into event_outbox too now that outbox is on.
  // Keep the table clean so per-test row counts mean what they say.
  await stack.db.db.delete(eventOutboxTable);
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

// =============================================================================
// Transactional Outbox — emit coexists with the full pipeline
// =============================================================================
//
// Isolated outbox tests prove the mechanism. This block proves the contract
// inside the real pipeline: ctx.emit runs next to the CrudExecutor write, the
// feature postSave hook, audit, SSE, search, and entity cache — and every one
// of those observes the same commit/rollback boundary as the outbox row.

describe("full stack: transactional outbox", () => {
  test("commit path: user row, outbox row, feature postSave, audit, SSE, search, subscriber — all consistent", async () => {
    const data = await stack.http.writeOk(
      "users:write:user:create",
      { email: "outbox-happy@test.de", firstName: "Happy", lastName: "Path" },
      adminUser,
    );

    // Business row committed
    expect(data["isNew"]).toBe(true);
    const userId = data["id"] as number;

    // Outbox row committed alongside
    const outboxRows = await stack.db.db.select().from(eventOutboxTable);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      tenantId: adminUser.tenantId,
      eventType: USER_CREATED_EVENT,
      publishedAt: null,
    });
    expect(outboxRows[0]?.payload).toMatchObject({ id: userId, email: "outbox-happy@test.de" });

    // Feature postSave ran
    expect(featurePostSaveLog).toHaveLength(1);
    expect(featurePostSaveLog[0]).toMatchObject({ kind: "save", id: userId, isNew: true });

    // System hooks fired: audit, SSE, search
    expect(stack.events.audit).toHaveLength(1);
    expect(stack.events.audit[0]).toMatchObject({
      action: "users:write:user:create",
      entityType: "user",
      isNew: true,
    });
    expect(stack.events.sse.some((e) => e.type.includes("user"))).toBe(true);
    const searchHits = await stack.search.search(adminUser.tenantId, "outbox-happy");
    expect(searchHits.map((h) => h.entityId)).toContain(userId);

    // Subscriber has NOT been called yet — poller hasn't run
    expect(outboxSubscriberCalls).toHaveLength(0);

    // Drain deterministically
    const drain = await stack.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 1, failed: 0 });

    // Now the subscriber saw the event and the row is marked published
    expect(outboxSubscriberCalls).toHaveLength(1);
    expect(outboxSubscriberCalls[0]).toMatchObject({
      type: USER_CREATED_EVENT,
      payload: { id: userId, email: "outbox-happy@test.de" },
    });
    const [publishedRow] = await stack.db.db.select().from(eventOutboxTable);
    expect(publishedRow?.publishedAt).not.toBeNull();
  });

  test("rollback path: handler returns isSuccess:false after emit+insert → no user, no outbox row, no side-effects", async () => {
    const res = await stack.http.write(
      "users:write:user:create-rollback",
      { email: "outbox-rollback@test.de" },
      adminUser,
    );
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.isSuccess).toBe(false);
    expect(body.error).toContain("intentional_rollback");

    // User table: the insert rolled back
    const users = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "users:query:user:list",
      { search: "outbox-rollback" },
      adminUser,
    );
    expect(users.rows.some((u) => u["email"] === "outbox-rollback@test.de")).toBe(false);

    // Outbox: the emit rolled back too
    const outboxRows = await stack.db.db.select().from(eventOutboxTable);
    expect(outboxRows).toHaveLength(0);

    // Side-effects inside the tx boundary must not have committed either.
    // Feature postSave, audit, and search all run inside executeWrite — they
    // only materialize on commit. (SSE is a network broadcast and doesn't
    // have a DB consequence; we deliberately don't assert on it here.)
    expect(featurePostSaveLog).toHaveLength(0);
    expect(stack.events.audit).toHaveLength(0);
    const searchHits = await stack.search.search(adminUser.tenantId, "outbox-rollback");
    expect(searchHits).toHaveLength(0);

    // Poller has nothing to do — proves no fire-and-forget path snuck an event out
    const drain = await stack.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 0, failed: 0 });
    expect(outboxSubscriberCalls).toHaveLength(0);
  });

  test("uncaught throw + multi-emit: both outbox rows roll back, error is reported, no side-effects", async () => {
    const res = await stack.http.write(
      "users:write:user:create-throw",
      { email: "outbox-throw@test.de" },
      adminUser,
    );
    const body = (await res.json()) as { isSuccess: boolean; error: string };
    expect(body.isSuccess).toBe(false);
    expect(body.error).toContain("unexpected_handler_failure");

    // User row rolled back
    const users = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "users:query:user:list",
      { search: "outbox-throw" },
      adminUser,
    );
    expect(users.rows.some((u) => u["email"] === "outbox-throw@test.de")).toBe(false);

    // BOTH outbox rows rolled back — multi-emit in one tx is atomic
    const outboxRows = await stack.db.db.select().from(eventOutboxTable);
    expect(outboxRows).toHaveLength(0);

    // System hooks did not commit — the generic catch path rolls them back too
    expect(featurePostSaveLog).toHaveLength(0);
    expect(stack.events.audit).toHaveLength(0);
    const searchHits = await stack.search.search(adminUser.tenantId, "outbox-throw");
    expect(searchHits).toHaveLength(0);

    // Subscriber never saw anything, poller finds nothing
    const drain = await stack.outboxPoller?.runOnce();
    expect(drain).toEqual({ processed: 0, failed: 0 });
    expect(outboxSubscriberCalls).toHaveLength(0);
  });
});
