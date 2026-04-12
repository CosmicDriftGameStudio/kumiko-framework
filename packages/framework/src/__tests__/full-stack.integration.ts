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
  type SessionUser,
} from "../engine";
import { ErrorCodes } from "../engine/constants";
import { createEventLog } from "../pipeline";
import type { SearchAdapter } from "../search";
import { createEntityTable, setupTestStack, type TestStack } from "../testing";

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
      const crud = createCrudExecutor(userTable, userEntity, {
        searchAdapter: ctx["searchAdapter"] as SearchAdapter,
        entityName: "user",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "user.update",
    z.object({ id: z.number(), version: z.number().optional(), changes: z.record(z.unknown()) }),
    async (event, ctx) => {
      const crud = createCrudExecutor(userTable, userEntity, {
        searchAdapter: ctx["searchAdapter"] as SearchAdapter,
        entityName: "user",
      });
      return crud.update(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "user.delete",
    z.object({ id: z.number() }),
    async (event, ctx) => {
      const crud = createCrudExecutor(userTable, userEntity, { entityName: "user" });
      return crud.delete(event.payload, event.user, ctx.db);
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
      const crud = createCrudExecutor(userTable, userEntity, {
        searchAdapter: ctx["searchAdapter"] as SearchAdapter,
        entityName: "user",
      });
      return crud.list(query.payload, query.user, ctx.db);
    },
  );

  r.queryHandler("user.detail", z.object({ id: z.number() }), async (query, ctx) => {
    const crud = createCrudExecutor(userTable, userEntity, {});
    return crud.detail(query.payload, query.user, ctx.db);
  });

  r.entityHook("postSave", "user", async (result) => {
    featurePostSaveLog.push(result);
  });

  r.hook("validation", "user.create", (data) => {
    if (data["email"] === "banned@evil.com") return [{ field: "email", error: "banned_domain" }];
    return null;
  });
});

// --- Stack + Users ---

let stack: TestStack;

const adminUser: SessionUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const guestUser: SessionUser = { id: 2, tenantId: 1, roles: ["Guest"] };
const otherTenantAdmin: SessionUser = { id: 3, tenantId: 2, roles: ["Admin"] };

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
      "users.user.create",
      {
        email: "marc@test.de",
        firstName: "Marc",
        lastName: "Test",
      },
      adminUser,
    );
    expect(data.isNew).toBe(true);

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "users.user.detail",
      { id: data.id },
      adminUser,
    );
    expect(detail.email).toBe("marc@test.de");
    expect(detail.version).toBe(1);
  });

  test("soft delete removes from queries", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "del@test.de",
      },
      adminUser,
    );

    const del = await stack.http.writeOk(
      "users.user.delete",
      {
        id: created.id,
      },
      adminUser,
    );
    expect(del).toBeDefined();

    const detail = await stack.http.queryOk<null>(
      "users.user.detail",
      { id: created.id },
      adminUser,
    );
    expect(detail).toBeNull();
  });

  test("delete triggers audit trail via postDelete hook", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "audit-del@test.de",
      },
      adminUser,
    );

    stack.events.reset();

    await stack.http.writeOk("users.user.delete", { id: created.id }, adminUser);

    const deleteEntry = stack.events.audit.find((e) => e.action === "users.user.delete");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry?.entityType).toBe("user");
    expect(deleteEntry?.entityId).toBe(created.id);
    expect(deleteEntry?.isNew).toBe(false);
  });
});

// =============================================================================
// SaveContext
// =============================================================================

describe("full stack: SaveContext changes + previous", () => {
  test("update returns exact changes and previous state", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "ctx@test.de",
        firstName: "Before",
        lastName: "Keep",
      },
      adminUser,
    );

    const updated = await stack.http.writeOk(
      "users.user.update",
      {
        id: created.id,
        changes: { firstName: "After" },
      },
      adminUser,
    );

    expect(updated.isNew).toBe(false);
    expect(updated.changes).toEqual({ firstName: "After" });
    expect(updated.previous["firstName"]).toBe("Before");
    expect(updated.previous["lastName"]).toBe("Keep");
    expect(updated.data["firstName"]).toBe("After");
  });
});

// =============================================================================
// Optimistic Locking
// =============================================================================

describe("full stack: optimistic locking", () => {
  test("stale version returns version_conflict", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "lock@test.de",
      },
      adminUser,
    );

    await stack.http.writeOk(
      "users.user.update",
      {
        id: created.id,
        version: 1,
        changes: { firstName: "V2" },
      },
      adminUser,
    );

    const error = await stack.http.writeErr(
      "users.user.update",
      {
        id: created.id,
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
      "users.user.create",
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
      "users.user.create",
      {
        email: "audit@test.de",
      },
      adminUser,
    );

    expect(stack.events.audit).toHaveLength(1);
    expect(stack.events.audit[0]?.action).toBe("users.user.create");
    expect(stack.events.audit[0]?.entityType).toBe("user");
    expect(stack.events.audit[0]?.isNew).toBe(true);
    expect(stack.events.audit[0]?.userId).toBe(1);
  });

  test("audit trail system hook captures update with changes + previous", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "audit-upd@test.de",
        firstName: "Old",
      },
      adminUser,
    );

    stack.events.reset();

    await stack.http.writeOk(
      "users.user.update",
      {
        id: created.id,
        changes: { firstName: "New" },
      },
      adminUser,
    );

    const updateEntry = stack.events.audit.find((e) => e.action === "users.user.update");
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.changes["firstName"]).toBe("New");
    expect(updateEntry?.previous["firstName"]).toBe("Old");
    expect(updateEntry?.isNew).toBe(false);
  });

  test("SSE broadcast fires on create", async () => {
    await stack.http.writeOk(
      "users.user.create",
      {
        email: "sse@test.de",
      },
      adminUser,
    );

    expect(stack.events.sse).toHaveLength(1);
    expect(stack.events.sse[0]?.type).toBe("user.created");
    expect(stack.events.sse[0]?.data["id"]).toBeDefined();
  });

  test("SSE broadcast fires on update", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "sse-upd@test.de",
      },
      adminUser,
    );

    stack.events.reset();

    await stack.http.writeOk(
      "users.user.update",
      {
        id: created.id,
        changes: { firstName: "SSE" },
      },
      adminUser,
    );

    const updateEvent = stack.events.sse.find((e) => e.type === "user.updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.data["changes"]).toEqual({ firstName: "SSE" });
  });

  test("search index updated via system hook after create", async () => {
    await stack.http.writeOk(
      "users.user.create",
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
      body: JSON.stringify({ type: "users.user.create", payload: { email: "x@x.de" } }),
    });
    expect(res.status).toBe(401);
  });

  test("guest → access denied", async () => {
    const error = await stack.http.writeErr(
      "users.user.create",
      {
        email: "guest@test.de",
      },
      guestUser,
    );
    expect(error).toContain("access");
  });

  test("other tenant cannot see data", async () => {
    const created = await stack.http.writeOk(
      "users.user.create",
      {
        email: "secret@test.de",
      },
      adminUser,
    );

    const detail = await stack.http.queryOk<null>(
      "users.user.detail",
      { id: created.id },
      otherTenantAdmin,
    );
    expect(detail).toBeNull();
  });

  test("validation hook rejects banned domain", async () => {
    const error = await stack.http.writeErr(
      "users.user.create",
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
      "users.user.create",
      {
        email: "findable@test.de",
        firstName: "Findable",
      },
      adminUser,
    );

    const res = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "users.user.list",
      { search: "findable" },
      adminUser,
    );
    expect(res.rows.some((r) => r["email"] === "findable@test.de")).toBe(true);
  });

  test("sort by lastName ASC", async () => {
    await stack.http.writeOk(
      "users.user.create",
      {
        email: "sz@test.de",
        lastName: "Zebra",
      },
      adminUser,
    );
    await stack.http.writeOk(
      "users.user.create",
      {
        email: "sa@test.de",
        lastName: "Alpha",
      },
      adminUser,
    );

    const res = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "users.user.list",
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
      "users.user.create",
      {
        email: "eventlog@test.de",
      },
      adminUser,
    );

    const eventLog = createEventLog(stack.redis.redis, "kumiko:test:stack-log");
    const recent = await eventLog.recent(100);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.some((e) => e.type === "users.user.create")).toBe(true);
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
      "users.user.create",
      {
        email: "idem@test.de",
      },
      adminUser,
      requestId,
    );
    const firstId = res1.id;

    // Same requestId → should return cached result, NOT create a second user
    const res2 = await stack.http.writeOk(
      "users.user.create",
      {
        email: "idem@test.de",
      },
      adminUser,
      requestId,
    );
    expect(res2.id).toBe(firstId);
  });

  test("different requestIds create separate records", async () => {
    const res1 = await stack.http.writeOk(
      "users.user.create",
      {
        email: "idem-a@test.de",
      },
      adminUser,
      "idem-a",
    );

    const res2 = await stack.http.writeOk(
      "users.user.create",
      {
        email: "idem-b@test.de",
      },
      adminUser,
      "idem-b",
    );

    expect(res1.id).not.toBe(res2.id);
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
