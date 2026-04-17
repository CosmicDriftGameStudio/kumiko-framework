import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type TenantId,
} from "../../engine";
import {
  createSearchHooks,
  createSearchIndexBatchHook,
  createSearchIndexHook,
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
import { createSseBroker } from "../sse-broker";

// Integration test for the production wiring of the system-hook pipeline.
// Calls buildServer directly (NOT setupTestStack) and passes systemHooks the
// way a real consumer would. Proves that the search postSave/postSaveBatch
// hooks fire through the prod buildServer path, not just when setupTestStack
// preconfigures them.
//
// SSE doesn't live in systemHooks anymore (moved to the async event-
// dispatcher in D.3). The SSE-via-eventDispatcher wiring is covered in
// event-dispatcher.integration.ts + realtime-sse sample.

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

const itemEntity = createEntity({
  table: "system_hooks_server_items",
  fields: { label: createTextField({ required: true, searchable: true }) },
});

// Monotonically increasing synthetic ID so multiple saves in a single batch
// produce distinct SaveContexts (same id would collapse in the search index).
let nextItemId = 100;

const feature = defineFeature("system-hooks-test", (r) => {
  r.entity("item", itemEntity);
  r.writeHandler(
    "item:create",
    z.object({ label: z.string() }),
    async (event) => {
      // Return a SaveContext that triggers every wired system hook.
      // entityName + tenantId are the minimum for search/sse to fire.
      const id = nextItemId++;
      return {
        isSuccess: true,
        data: {
          kind: "save",
          id,
          entityName: "item",
          data: { id, label: event.payload.label, tenantId: TENANT_ID },
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
  test("search hook wired: save fires index", async () => {
    const searchAdapter: SearchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    const sseBroker = createSseBroker();

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

    const res = await writeItem(server.app, server.jwt, "wiring-proof");
    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`expected 200, got ${res.status}: ${body}`);
    }

    // Search: the index was populated
    const hits = await searchAdapter.search(TENANT_ID, "wiring-proof");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.entityType).toBe("item");
  });

  test("no system hooks wired: save succeeds but no side effects", async () => {
    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    const sseBroker = createSseBroker();

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
  });

  test("only search hook wired: search fires, no other postSave side effects", async () => {
    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    const sseBroker = createSseBroker();

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
  });

  test("search batch hook fires once per batch and indexes every successful save", async () => {
    const searchAdapter = createInMemorySearchAdapter();
    await searchAdapter.configure(TENANT_ID, {
      searchableFields: ["label"],
      rankingFields: ["label"],
    });

    // Instrument the batch adapter so we can count how many indexBatch calls
    // the hook made — we expect ONE per dispatcher batch, not N per save.
    let indexBatchCalls = 0;
    let lastBatchSize = 0;
    const instrumentedAdapter = {
      ...searchAdapter,
      async indexBatch(
        tenantId: TenantId,
        docs: readonly import("../../search/types").SearchDocument[],
      ) {
        indexBatchCalls++;
        lastBatchSize = docs.length;
        await searchAdapter.indexBatch?.(tenantId, docs);
      },
    };

    const sseBroker = createSseBroker();
    const server = buildServer({
      registry,
      context: { db: testDb.db, redis: testRedis.redis, registry, searchAdapter },
      jwtSecret: JWT_SECRET,
      sseBroker,
      systemHooks: {
        // No per-save search hook — use the batch variant only
        postSave: [],
        postSaveBatch: [createSearchIndexBatchHook(instrumentedAdapter, registry)],
        postDelete: [],
      },
    });

    // Three writes in a single /api/batch call — expect one indexBatch call
    // with three docs, not three separate calls.
    const token = await server.jwt.sign(TestUsers.admin);
    const res = await server.app.request("/api/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        commands: [
          { type: "system-hooks-test:write:item:create", payload: { label: "batch-1" } },
          { type: "system-hooks-test:write:item:create", payload: { label: "batch-2" } },
          { type: "system-hooks-test:write:item:create", payload: { label: "batch-3" } },
        ],
      }),
    });
    expect(res.status).toBe(200);

    expect(indexBatchCalls).toBe(1);
    expect(lastBatchSize).toBe(3);

    // Each doc actually landed in the index.
    const hits = await searchAdapter.search(TENANT_ID, "batch");
    expect(hits.length).toBe(3);
  });

  test("createSearchHooks auto-picks batch variant when adapter supports indexBatch", () => {
    const adapterWithBatch = createInMemorySearchAdapter(); // has indexBatch + removeBatch
    const hooks = createSearchHooks(adapterWithBatch, registry);
    expect(hooks.postSaveBatch).toBeDefined();
    expect(hooks.postSaveBatch).toHaveLength(1);
    expect(hooks.postDeleteBatch).toBeDefined();
    expect(hooks.postSave).toBeUndefined();
    expect(hooks.postDelete).toBeUndefined();
  });

  test("createSearchHooks falls back to per-save when adapter lacks batch APIs", () => {
    // Adapter without indexBatch/removeBatch — pretend we have an older one.
    const baseAdapter = createInMemorySearchAdapter();
    const adapterWithoutBatch = {
      configure: baseAdapter.configure.bind(baseAdapter),
      index: baseAdapter.index.bind(baseAdapter),
      search: baseAdapter.search.bind(baseAdapter),
      remove: baseAdapter.remove.bind(baseAdapter),
      // indexBatch + removeBatch intentionally omitted
    };
    const hooks = createSearchHooks(adapterWithoutBatch, registry);
    expect(hooks.postSave).toBeDefined();
    expect(hooks.postSave).toHaveLength(1);
    expect(hooks.postDelete).toBeDefined();
    expect(hooks.postSaveBatch).toBeUndefined();
    expect(hooks.postDeleteBatch).toBeUndefined();
  });
});
