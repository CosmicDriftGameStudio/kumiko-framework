import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemorySearchAdapter,
  reindexTenantsSearch,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "read_reindex_tenants_notes",
  fields: {
    title: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteFeature = defineFeature("reindex-tenants-test", (r) => {
  r.entity({ name: "note", ...noteEntity });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [noteFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  const executor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });
  const tenantDb = createTenantDb({
    db: stack.db,
    tenantId: admin.tenantId,
    mode: "system",
    reason: "test reindex reads entity rows across tenants",
  });
  const created = await executor.create({ title: "Sweepable Note" }, admin, tenantDb);
  if (!created.isSuccess) throw new Error("seed failed");
});

afterAll(async () => {
  await stack.cleanup();
});

function failingConfigureAdapter(): SearchAdapter {
  const adapter = createInMemorySearchAdapter();
  return {
    ...adapter,
    configure: () => Promise.reject(new Error("configure boom")),
  };
}

describe("reindexTenantsSearch", () => {
  test("configures the tenant and indexes its rows into a fresh adapter", async () => {
    const adapter = createInMemorySearchAdapter();
    const result = await reindexTenantsSearch(stack.db, stack.registry, adapter, {
      tenantIds: [admin.tenantId],
      warn: () => {},
    });
    expect(result).toMatchObject({
      tenants: 1,
      indexedRows: 1,
      failedRows: 0,
      failedReindexes: 0,
      failedConfigures: 0,
    });
    const hits = await adapter.search(admin.tenantId, "sweepable", { filterType: "note" });
    expect(hits).toHaveLength(1);
  });

  test("dry run scans without writing", async () => {
    const adapter = createInMemorySearchAdapter();
    const result = await reindexTenantsSearch(stack.db, stack.registry, adapter, {
      tenantIds: [admin.tenantId],
      dryRun: true,
      warn: () => {},
    });
    expect(result.indexedRows).toBe(0);
    expect(result.failedConfigures).toBe(0);
    const hits = await adapter.search(admin.tenantId, "sweepable", { filterType: "note" });
    expect(hits).toHaveLength(0);
  });

  test("a failing configure is counted and the tenant is skipped", async () => {
    const warnings: string[] = [];
    const result = await reindexTenantsSearch(stack.db, stack.registry, failingConfigureAdapter(), {
      tenantIds: [admin.tenantId],
      warn: (message) => warnings.push(message),
    });
    expect(result.failedConfigures).toBe(1);
    expect(result.indexedRows).toBe(0);
    expect(warnings.some((message) => message.includes("configure boom"))).toBe(true);
  });

  test("a stalled configure times out instead of blocking", async () => {
    const adapter: SearchAdapter = {
      ...createInMemorySearchAdapter(),
      configure: () => new Promise<void>(() => {}),
    };
    const result = await reindexTenantsSearch(stack.db, stack.registry, adapter, {
      tenantIds: [admin.tenantId],
      configureTimeoutMs: 20,
      warn: () => {},
    });
    expect(result.failedConfigures).toBe(1);
  });

  test("a failing reindex is counted, not thrown", async () => {
    const adapter: SearchAdapter = {
      ...createInMemorySearchAdapter(),
      indexBatch: () => Promise.reject(new Error("index boom")),
    };
    const result = await reindexTenantsSearch(stack.db, stack.registry, adapter, {
      tenantIds: [admin.tenantId],
      warn: () => {},
    });
    expect(result.failedRows).toBe(1);
    expect(result.indexedRows).toBe(0);
  });

  test("a stalled reindex times out and is counted as failedReindexes", async () => {
    const adapter: SearchAdapter = {
      ...createInMemorySearchAdapter(),
      indexBatch: () => new Promise<void>(() => {}),
    };
    const result = await reindexTenantsSearch(stack.db, stack.registry, adapter, {
      tenantIds: [admin.tenantId],
      timeoutMs: 20,
      warn: () => {},
    });
    expect(result.failedReindexes).toBeGreaterThanOrEqual(1);
    expect(result.indexedRows).toBe(0);
  });
});
