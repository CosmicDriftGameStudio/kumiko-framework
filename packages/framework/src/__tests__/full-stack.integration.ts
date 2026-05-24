import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { selectMany, updateMany } from "../db/query";
import { setupTestStack, type TestStack } from "../stack";
import { createEventStoreExecutor } from "../db/event-store-executor";
import { defineFeature, type EntityId, type HandlerContext, type SaveContext } from "../engine";
import { UnprocessableError, writeFailure } from "../errors";
import { eventsTable } from "../event-store";
import {
  createTestUser,
  TestUsers,
  unsafeCreateEntityTable,
} from "../stack";
import { expectErrorIncludes, sharedUserEntity, sharedUserTable } from "../testing";

// --- Entities ---

const userEntity = sharedUserEntity;
const userTable = sharedUserTable;

// --- Feature-level hook log (not a system hook, tracked separately) ---

const featurePostSaveLog: SaveContext[] = [];

// --- Feature definition ---

function userExecutor(ctx: { searchAdapter?: unknown; entityCache?: unknown }) {
  return createEventStoreExecutor(userTable, userEntity, {
    entityName: "user",
    ...(ctx.searchAdapter
      ? { searchAdapter: ctx.searchAdapter as import("../search").SearchAdapter }
      : {}),
    ...(ctx.entityCache
      ? { entityCache: ctx.entityCache as import("../pipeline/entity-cache").EntityCache }
      : {}),
  });
}

// Single source of truth for the user-created domain-event name + payload.
// ctx.appendEvent writes this onto the user aggregate's own stream. The MSP
// below picks it up via the event-dispatcher after commit.
let USER_CREATED_EVENT: string;

// Test-level MSP capture — populated by the multiStreamProjection apply below.
// Declared here so tests can reset + assert against it across describe blocks.
const domainEventSubscriberCalls: Array<{ type: string; payload: unknown }> = [];

async function emitUserCreated(
  ctx: Pick<HandlerContext, "unsafeAppendEvent">,
  id: EntityId,
  email: string,
): Promise<void> {
  await ctx.unsafeAppendEvent({
    aggregateId: String(id),
    aggregateType: "user",
    type: USER_CREATED_EVENT,
    payload: { id, email },
  });
}

const userFeature = defineFeature("users", (r) => {
  const user = r.entity("user", userEntity);

  const userCreated = r.defineEvent("user.created", z.object({ id: z.any(), email: z.string() }));
  USER_CREATED_EVENT = userCreated.name;

  // r.multiStreamProjection: capture USER_CREATED_EVENT asynchronously via
  // the event-dispatcher. Replaces the old r.postEvent path (removed in E2).
  r.multiStreamProjection({
    name: "user-created-capture",
    apply: {
      [userCreated.name]: async (event) => {
        domainEventSubscriberCalls.push({ type: event.type, payload: event.payload });
      },
    },
  });

  const createHandler = r.writeHandler(
    "user:create",
    z.object({
      email: z.email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    }),
    async (event, ctx) => userExecutor(ctx).create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  // Variant used by the ctx.appendEvent test block — creates the user AND
  // appends a domain event (`users:event:user.created`) to the user's own
  // aggregate stream. Separate from `user:create` so the CRUD-only happy-path
  // tests don't unnecessarily bump the stream version past what the client
  // sees in the response.
  r.writeHandler(
    "user:create-and-signal",
    z.object({
      email: z.email(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    }),
    async (event, ctx) => {
      const result = await userExecutor(ctx).create(event.payload, event.user, ctx.db);
      if (result.isSuccess) {
        await emitUserCreated(ctx, result.data.id, event.payload.email);
      }
      return result;
    },
    { access: { roles: ["Admin"] } },
  );

  // Rollback via controlled failure: writes to the user table AND appends a
  // domain event, then deliberately returns isSuccess:false. The dispatcher
  // raises BatchRollback, the surrounding tx rolls back — so NEITHER the user
  // row NOR the domain event survive. Proves the controlled-failure path.
  r.writeHandler(
    "user:create-rollback",
    z.object({ email: z.email() }),
    async (event, ctx) => {
      const created = await userExecutor(ctx).create(event.payload, event.user, ctx.db);
      if (created.isSuccess) {
        await emitUserCreated(ctx, created.data.id, event.payload.email);
      }
      return writeFailure(new UnprocessableError("intentional_rollback"));
    },
    { access: { roles: ["Admin"] } },
  );

  // Rollback via uncaught throw: appends TWICE, then throws. Exercises a
  // different dispatcher branch than isSuccess:false — the generic catch block
  // that wraps BatchRollback. Proves that:
  //   (a) an uncaught error rolls the tx back just like a controlled failure,
  //   (b) multiple domain event rows from the same handler roll back together.
  r.writeHandler(
    "user:create-throw",
    z.object({ email: z.email() }),
    async (event, ctx) => {
      const created = await userExecutor(ctx).create(event.payload, event.user, ctx.db);
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
      id: z.uuid(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) => userExecutor(ctx).update(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "user:delete",
    z.object({ id: z.uuid() }),
    async (event, ctx) => userExecutor(ctx).delete(event.payload, event.user, ctx.db),
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
    async (query, ctx) => userExecutor(ctx).list(query.payload, query.user, ctx.db),
    { access: { openToAll: true } },
  );

  r.queryHandler(
    "user:detail",
    z.object({ id: z.uuid() }),
    async (query, ctx) => userExecutor(ctx).detail(query.payload, query.user, ctx.db),
    { access: { openToAll: true } },
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
const otherTenantAdmin = createTestUser({
  id: 3,
  tenantId: "00000000-0000-4000-8000-000000000002",
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [userFeature] });
  await unsafeCreateEntityTable(stack.db, userEntity, "user");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  // Advance the event-dispatcher cursor past all events from earlier tests
  // FIRST, then reset the in-memory collector. This keeps per-test SSE +
  // pubsub assertions honest — otherwise the dispatcher would replay every
  // prior test's events and inflate counts.
  await stack.eventDispatcher?.runOnce();
  stack.events.reset();
  featurePostSaveLog.length = 0;
  domainEventSubscriberCalls.length = 0;
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

    const updated = await stack.http.writeOk<{
      isNew: boolean;
      changes: { firstName: string };
      previous: { firstName: string; lastName: string };
      data: { firstName: string };
    }>(
      "users:write:user:update",
      {
        id: created["id"],
        changes: { firstName: "After" },
        version: 1,
      },
      adminUser,
    );

    expect(updated.isNew).toBe(false);
    expect(updated.changes).toEqual({ firstName: "After" });
    expect(updated.previous.firstName).toBe("Before");
    expect(updated.previous.lastName).toBe("Keep");
    expect(updated.data.firstName).toBe("After");
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

    expect(error.code).toBe("version_conflict");
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

  test("SSE broadcast fires on create (via async event-dispatcher)", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "sse@test.de",
      },
      adminUser,
    );

    // SSE runs as an async subscriber on the event-dispatcher since D.3.
    // Drain deterministically instead of sleeping.
    await stack.eventDispatcher?.runOnce();

    expect(stack.events.sse).toHaveLength(1);
    // New shape: event.type directly (no "system:event:" wrapper).
    expect(stack.events.sse[0]?.type).toBe("user.created");
    expect(stack.events.sse[0]?.data["id"]).toBeDefined();
  });

  test("SSE broadcast fires on update (via async event-dispatcher)", async () => {
    const created = await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "sse-upd@test.de",
      },
      adminUser,
    );

    // Drain the create event first, then reset + update.
    await stack.eventDispatcher?.runOnce();
    stack.events.reset();

    await stack.http.writeOk(
      "users:write:user:update",
      {
        id: created["id"],
        changes: { firstName: "SSE" },
        version: 1,
      },
      adminUser,
    );
    await stack.eventDispatcher?.runOnce();

    const updateEvent = stack.events.sse.find((e) => e.type === "user.updated");
    expect(updateEvent).toBeDefined();
    // Shape carries the full event.payload (changes + previous) under data.payload.
    const payload = updateEvent!.data["payload"] as { changes: { firstName: string } };
    expect(payload.changes).toEqual({ firstName: "SSE" });
  });

  test("search index updated via async event-dispatcher after create", async () => {
    await stack.http.writeOk(
      "users:write:user:create",
      {
        email: "indexed@test.de",
        firstName: "Indexed",
      },
      adminUser,
    );
    await stack.eventDispatcher?.runOnce();

    const results = await stack.search.search("00000000-0000-4000-8000-000000000001", "indexed", {
      filterType: "user",
    });
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
    expect(error.code).toBe("access_denied");
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
    expectErrorIncludes(error, "banned_domain");
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
    // Search indexing is async (D.4) — drain before querying.
    await stack.eventDispatcher?.runOnce();

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
// SSE Route + Health
// =============================================================================

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
    const body = (await res.json()) as { isSuccess: boolean; error: { requestId?: string } };
    expect(body.isSuccess).toBe(false);
    // requestId lives inside the serialized error body under the new contract
    expect(body.error.requestId).toBe("err-req-99");
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
    const id = created["id"] as string;

    // First detail populates cache
    await stack.http.queryOk("users:query:user:detail", { id }, adminUser);

    // Raw DB update — bypasses cache invalidation
    await updateMany(stack.db, userTable, { firstName: "RawDbChange" }, { id: id });

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
      { id, changes: { firstName: "AfterUpdate" }, version: 1 },
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
    const id = created["id"] as string;

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
// ctx.appendEvent — domain events on the user aggregate stream
// =============================================================================
//
// ctx.appendEvent writes the event onto the user aggregate's own stream (same
// aggregateId as the CRUD row). The event-dispatcher picks it up and delivers
// to r.multiStreamProjection consumers after commit. Proves the full
// TX-atomicity: user row + domain event + feature postSave + SSE + search —
// all commit-or-rollback together.

describe("full stack: ctx.appendEvent via event-dispatcher", () => {
  // Filter the appended domain-event rows by type AND payload.email — the
  // events table is shared across tests so we pick out just the ones this
  // test appended.
  async function domainEventsForEmail(email: string) {
    const rows = await selectMany(stack.db, eventsTable, {
      aggregateType: "user",
      type: USER_CREATED_EVENT,
    });
    return rows.filter((r) => (r.payload as { email?: string }).email === email);
  }

  test("commit path: user row, domain event, feature postSave, SSE, search, subscriber — all consistent", async () => {
    const data = await stack.http.writeOk(
      "users:write:user:create-and-signal",
      { email: "emit-happy@test.de", firstName: "Happy", lastName: "Path" },
      adminUser,
    );

    // Business row committed
    expect(data["isNew"]).toBe(true);
    const userId = data["id"] as string;

    // Domain event row committed on the SAME aggregate stream as the CRUD event
    const domainRows = await domainEventsForEmail("emit-happy@test.de");
    expect(domainRows).toHaveLength(1);
    expect(domainRows[0]).toMatchObject({
      tenantId: adminUser.tenantId,
      type: USER_CREATED_EVENT,
      aggregateType: "user",
      aggregateId: userId,
    });
    expect(domainRows[0]?.payload).toMatchObject({ id: userId, email: "emit-happy@test.de" });

    // Feature postSave ran inline
    expect(featurePostSaveLog).toHaveLength(1);
    expect(featurePostSaveLog[0]).toMatchObject({ kind: "save", id: userId, isNew: true });

    // System consumers + MSP subscriber fire on the next dispatcher pass
    expect(domainEventSubscriberCalls).toHaveLength(0);
    await stack.eventDispatcher?.runOnce();

    // Search + SSE saw the user.created aggregate event
    expect(stack.events.sse.some((e) => e.type === "user.created")).toBe(true);
    const searchHits = await stack.search.search(adminUser.tenantId, "emit-happy");
    expect(searchHits.map((h) => h.entityId)).toContain(userId);

    // Subscriber saw the domain event
    expect(domainEventSubscriberCalls).toHaveLength(1);
    expect(domainEventSubscriberCalls[0]).toMatchObject({
      type: USER_CREATED_EVENT,
      payload: { id: userId, email: "emit-happy@test.de" },
    });
  });

  test("rollback path: handler returns isSuccess:false after append+insert → no user, no event, no side-effects", async () => {
    const res = await stack.http.write(
      "users:write:user:create-rollback",
      { email: "emit-rollback@test.de" },
      adminUser,
    );
    const body = (await res.json()) as {
      isSuccess: boolean;
      error: { code: string; details: { reason: string } };
    };
    expect(body.isSuccess).toBe(false);
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.details.reason).toBe("intentional_rollback");

    // User table: the insert rolled back
    const users = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "users:query:user:list",
      { search: "emit-rollback" },
      adminUser,
    );
    expect(users.rows.some((u) => u["email"] === "emit-rollback@test.de")).toBe(false);

    // Domain event rolled back too — nothing in events table for this email
    expect(await domainEventsForEmail("emit-rollback@test.de")).toHaveLength(0);

    // Side-effects: feature postSave ran inline in the tx that rolled back →
    // no entry. Dispatcher drains nothing (no committed event). Subscriber
    // never saw the rolled-back append.
    expect(featurePostSaveLog).toHaveLength(0);
    await stack.eventDispatcher?.runOnce();
    const searchHits = await stack.search.search(adminUser.tenantId, "emit-rollback");
    expect(searchHits).toHaveLength(0);
    expect(domainEventSubscriberCalls).toHaveLength(0);
  });

  test("uncaught throw + multi-append: both domain events roll back, error reported, no side-effects", async () => {
    const res = await stack.http.write(
      "users:write:user:create-throw",
      { email: "emit-throw@test.de" },
      adminUser,
    );
    const body = (await res.json()) as { isSuccess: boolean; error: unknown };
    expect(body.isSuccess).toBe(false);
    // Uncaught Error → auto-wrapped to InternalError.
    expect((body.error as { code: string }).code).toBe("internal_error");

    // User row rolled back
    const users = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      "users:query:user:list",
      { search: "emit-throw" },
      adminUser,
    );
    expect(users.rows.some((u) => u["email"] === "emit-throw@test.de")).toBe(false);

    // BOTH domain event rows rolled back — multi-append in one tx is atomic.
    // Primary + secondary email variants should both be absent.
    expect(await domainEventsForEmail("emit-throw@test.de")).toHaveLength(0);
    expect(await domainEventsForEmail("emit-throw@test.de.secondary")).toHaveLength(0);

    // Subscribers + system consumers stayed idle
    expect(featurePostSaveLog).toHaveLength(0);
    await stack.eventDispatcher?.runOnce();
    const searchHits = await stack.search.search(adminUser.tenantId, "emit-throw");
    expect(searchHits).toHaveLength(0);
    expect(domainEventSubscriberCalls).toHaveLength(0);
  });
});
