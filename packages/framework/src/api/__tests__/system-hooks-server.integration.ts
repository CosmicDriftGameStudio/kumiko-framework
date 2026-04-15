import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";
import {
  type AuditTrailEntry,
  type AuditTrailStorage,
  createAuditTrailHook,
  createSearchIndexHook,
  createSseBroadcastHook,
} from "../../pipeline/system-hooks";
import { createInMemorySearchAdapter } from "../../search";
import type { SearchAdapter } from "../../search/types";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  TestUsers,
} from "../../testing";
import type { JwtHelper } from "../jwt";
import { buildServer } from "../server";
import type { SseEvent } from "../sse-broker";
import { createSseBroker, type SseBroker } from "../sse-broker";

// Integration test for the production wiring of the system-hook pipeline.
// Calls buildServer directly (NOT setupTestStack) and passes systemHooks the
// way a real consumer would. Proves that search/sse/audit hooks fire through
// the prod buildServer path, not just when setupTestStack preconfigures them.

const TENANT_ID = 1;

const itemEntity = createEntity({
  table: "system_hooks_server_items",
  fields: { label: createTextField({ required: true, searchable: true }) },
});

const feature = defineFeature("system-hooks-test", (r) => {
  r.entity("item", itemEntity);
  r.writeHandler(
    "item:create",
    z.object({ label: z.string() }),
    async (event) => {
      // Return a SaveContext that triggers all three system hooks.
      // entityName + tenantId are the minimum for search/sse/audit to fire.
      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: 42,
          entityName: "item",
          data: { id: 42, label: event.payload.label, tenantId: TENANT_ID },
          changes: { label: event.payload.label },
          previous: {},
          isNew: true,
        },
      };
    },
    { access: { roles: ["Admin"] } },
  );
});

const registry = createRegistry([feature]);
const JWT_SECRET = "system-hooks-server-integration-secret-32-chars!!";

let testDb: TestDb;
let testRedis: TestRedis;

async function writeItem(app: Hono, jwt: JwtHelper, label: string): Promise<Response> {
  const token = await jwt.sign(TestUsers.admin);
  return app.request("/api/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      type: "system-hooks-test:write:item:create",
      payload: { label },
    }),
  });
}

beforeEach(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
});

afterEach(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

describe("buildServer system-hooks integration", () => {
  test("all three hooks wired: save fires search + sse + audit", async () => {
    const searchAdapter: SearchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    const sseBroker: SseBroker = createSseBroker();
    const sseEvents: SseEvent[] = [];
    sseBroker.addClient(
      "tenant:1",
      (e) => sseEvents.push(e),
      () => {},
    );

    const auditEntries: AuditTrailEntry[] = [];
    const auditStorage: AuditTrailStorage = {
      append: async (entry) => {
        auditEntries.push(entry);
      },
    };

    const server = buildServer({
      registry,
      context: { db: testDb.db, redis: testRedis.redis, registry, searchAdapter },
      jwtSecret: JWT_SECRET,
      sseBroker,
      systemHooks: {
        postSave: [
          createSearchIndexHook(searchAdapter, registry),
          createSseBroadcastHook(sseBroker),
          createAuditTrailHook(auditStorage),
        ],
        postDelete: [],
      },
    });

    const res = await writeItem(server.app, server.jwt, "wiring-proof");
    expect(res.status).toBe(200);

    // Search: the index was populated
    const hits = await searchAdapter.search(TENANT_ID, "wiring-proof");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.entityType).toBe("item");

    // SSE: the broadcast hook pushed an event on tenant:1
    expect(sseEvents.length).toBeGreaterThan(0);
    const created = sseEvents.find((e) => e.type.endsWith("item:created"));
    expect(created).toBeDefined();

    // Audit: the audit hook wrote an entry
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0]?.entityType).toBe("item");
    expect(auditEntries[0]?.entityId).toBe(42);
    expect(auditEntries[0]?.changes).toMatchObject({ label: "wiring-proof" });
  });

  test("no system hooks wired: save succeeds but no side effects", async () => {
    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    const sseBroker = createSseBroker();
    const sseEvents: SseEvent[] = [];
    sseBroker.addClient(
      "tenant:1",
      (e) => sseEvents.push(e),
      () => {},
    );

    const auditEntries: AuditTrailEntry[] = [];
    const _auditStorage: AuditTrailStorage = {
      append: async (entry) => {
        auditEntries.push(entry);
      },
    };

    const server = buildServer({
      registry,
      context: { db: testDb.db, redis: testRedis.redis, registry, searchAdapter },
      jwtSecret: JWT_SECRET,
      sseBroker,
      // systemHooks intentionally omitted — this is the "consumer forgot to
      // wire system hooks" scenario. Must stay silent but leave no trace.
    });

    const res = await writeItem(server.app, server.jwt, "no-hooks");
    expect(res.status).toBe(200);

    const hits = await searchAdapter.search(TENANT_ID, "no-hooks");
    expect(hits.length).toBe(0);
    expect(sseEvents.length).toBe(0);
    expect(auditEntries.length).toBe(0);
  });

  test("only search hook wired: sse + audit stay silent", async () => {
    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    const sseBroker = createSseBroker();
    const sseEvents: SseEvent[] = [];
    sseBroker.addClient(
      "tenant:1",
      (e) => sseEvents.push(e),
      () => {},
    );

    const auditEntries: AuditTrailEntry[] = [];

    const server = buildServer({
      registry,
      context: { db: testDb.db, redis: testRedis.redis, registry, searchAdapter },
      jwtSecret: JWT_SECRET,
      sseBroker,
      systemHooks: {
        postSave: [createSearchIndexHook(searchAdapter, registry)],
        postDelete: [],
      },
    });

    const res = await writeItem(server.app, server.jwt, "search-only");
    expect(res.status).toBe(200);

    const hits = await searchAdapter.search(TENANT_ID, "search-only");
    expect(hits.length).toBeGreaterThan(0);
    expect(sseEvents.length).toBe(0);
    expect(auditEntries.length).toBe(0);
  });
});
