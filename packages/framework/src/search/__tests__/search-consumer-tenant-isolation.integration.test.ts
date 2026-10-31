// One tenant whose Meilisearch index rejects writes must not stall search indexing for every
// other tenant: the search consumer runs on one shared, strictly ordered cursor.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateId as uuid } from "@cosmicdrift/kumiko-framework/utils";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Meilisearch } from "meilisearch";
import { buildEntityTable, createEventStoreExecutor, createTenantDb } from "../../db/index.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import type { TenantId } from "../../engine/types/index.ts";
import { createEventDispatcher, type EventDispatcher } from "../../pipeline/event-dispatcher.ts";
import { getConsumerState } from "../../pipeline/event-dispatcher-admin.ts";
import { createSearchEventConsumer, SEARCH_CONSUMER_NAME } from "../../pipeline/system-hooks.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createMeilisearchAdapter } from "../meilisearch-adapter.ts";
import { meilisearchTenantIndex } from "../meilisearch-adapter-internals.ts";
import type { SearchAdapter } from "../types.ts";

const MEILI_URL = process.env["MEILI_URL"] ?? "http://localhost:17700";
const MEILI_KEY = process.env["MEILI_MASTER_KEY"] ?? "kumiko-dev-key";

async function meiliAvailable(): Promise<boolean> {
  try {
    const health = await fetch(`${MEILI_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return health.ok;
  } catch {
    return false;
  }
}

const MEILI_UP = await meiliAvailable();
if (!MEILI_UP && process.env["REQUIRE_MEILI"] === "1") {
  throw new Error(
    `REQUIRE_MEILI=1 but Meilisearch not reachable at ${MEILI_URL} — integration job misconfigured`,
  );
}

const noteEntity = createEntity({
  table: "read_search_isolation_notes",
  fields: {
    title: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
      searchable: true,
    }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteFeature = defineFeature("search-isolation", (r) => {
  r.entity({ name: "note", ...noteEntity });
});
const executor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const brokenTenantUser = TestUsers.admin;
const healthyTenantUser = TestUsers.otherTenant;

let stack: TestStack;
let client: Meilisearch;
let indexPrefix: string;
let meiliAdapter: SearchAdapter;
let dispatcher: EventDispatcher;
let clockMs = 0;
// Past the consumer's longest per-tenant retry delay.
const BEYOND_RETRY_DELAY_MS = 120_000;

type TestUser = typeof brokenTenantUser;

async function createNote(user: TestUser, title: string): Promise<string> {
  const tenantDb = createTenantDb({ db: stack.db, tenantId: user.tenantId });
  const created = await executor.create({ title }, user, tenantDb);
  if (!created.isSuccess) throw new Error("test setup: create failed");
  return String(created.data.id);
}

async function renameNote(user: TestUser, id: string, title: string): Promise<void> {
  const tenantDb = createTenantDb({ db: stack.db, tenantId: user.tenantId });
  const updated = await executor.update({ id, changes: { title } }, user, tenantDb, {
    skipOptimisticLock: true,
  });
  if (!updated.isSuccess) throw new Error("test setup: update failed");
}

// Another writer recreated the tenant's index with a foreign primary key, so every
// document write for that tenant ends as a failed Meilisearch task.
async function breakTenantIndex(tenantId: TenantId): Promise<void> {
  await client
    .createIndex(meilisearchTenantIndex(indexPrefix, tenantId), { primaryKey: "foreignKey" })
    .waitTask();
}

// Another writer recreated the index with the right primary key but factory settings, so
// document writes land while the stale-piece filter delete is rejected as not filterable.
async function recreateTenantIndexWithoutSettings(tenantId: TenantId): Promise<void> {
  const uid = meilisearchTenantIndex(indexPrefix, tenantId);
  await client.deleteIndex(uid).waitTask();
  await client.createIndex(uid, { primaryKey: "_id" }).waitTask();
}

async function repairTenantIndex(tenantId: TenantId): Promise<void> {
  await client.deleteIndex(meilisearchTenantIndex(indexPrefix, tenantId)).waitTask();
}

async function failedTaskCount(tenantId: TenantId): Promise<number> {
  const page = await client.tasks.getTasks({
    indexUids: [meilisearchTenantIndex(indexPrefix, tenantId)],
    statuses: ["failed"],
    limit: 100,
  });
  return page.results.length;
}

async function searchHitIds(tenantId: TenantId, query: string): Promise<string[]> {
  const hits = await meiliAdapter.search(tenantId, query, { filterType: "note" });
  return hits.map((hit) => String(hit.entityId));
}

describe.skipIf(!MEILI_UP)("search consumer tenant isolation (live Meilisearch)", () => {
  beforeAll(async () => {
    client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
    indexPrefix = `test_isolation_${uuid().replaceAll("-", "")}_`;
    meiliAdapter = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix });
    stack = await setupTestStack({ features: [noteFeature], systemHooks: [] });
    await unsafeCreateEntityTable(stack.db, noteEntity, "note");
    meiliAdapter.setDefaultConfig?.({ searchableFields: ["title"] });
  });

  // A fresh consumer per test: its per-tenant retry state lives in process memory.
  beforeEach(async () => {
    dispatcher = createEventDispatcher({
      db: stack.db,
      consumers: [createSearchEventConsumer(meiliAdapter, stack.registry, { now: () => clockMs })],
      context: { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
      // runOnce() drives every pass; the timer never fires a competing one.
      pollIntervalMs: 60_000,
    });
    await dispatcher.ensureRegistered();
  });

  afterEach(async () => {
    await resetEventStore({ db: stack.db, eventDispatcher: dispatcher }, [
      "read_search_isolation_notes",
    ]);
    await meiliAdapter.dropAllIndexes?.();
  });

  afterAll(async () => {
    await meiliAdapter.dropAllIndexes?.();
    await stack.cleanup();
  });

  test("a tenant whose index rejects writes does not block indexing for another tenant", async () => {
    await breakTenantIndex(brokenTenantUser.tenantId);
    await createNote(brokenTenantUser, "isolation broken tenant note");
    const healthyId = await createNote(healthyTenantUser, "isolation healthy tenant note");

    await dispatcher.runOnce();

    expect(await searchHitIds(healthyTenantUser.tenantId, "isolation")).toEqual([healthyId]);
    const state = await getConsumerState(stack.db, SEARCH_CONSUMER_NAME);
    expect(state?.status).toBe("idle");
    expect(state?.lastError).toContain(brokenTenantUser.tenantId);
    expect(state?.lastError).not.toContain("isolation broken tenant note");
  });

  test("a held tenant is not asked again before its retry delay has passed", async () => {
    // Meilisearch keeps the failed tasks of earlier tests on the same index uid.
    const failedBefore = await failedTaskCount(brokenTenantUser.tenantId);
    await breakTenantIndex(brokenTenantUser.tenantId);
    await createNote(brokenTenantUser, "backoff broken tenant note");
    await dispatcher.runOnce();
    const failedAfterFirstPass = await failedTaskCount(brokenTenantUser.tenantId);

    await dispatcher.runOnce();
    await dispatcher.runOnce();

    expect(failedAfterFirstPass).toBe(failedBefore + 1);
    expect(await failedTaskCount(brokenTenantUser.tenantId)).toBe(failedAfterFirstPass);
  });

  test("the held tenant's document is indexed once its index accepts writes again", async () => {
    await breakTenantIndex(brokenTenantUser.tenantId);
    const brokenId = await createNote(brokenTenantUser, "recovery broken tenant note");
    await dispatcher.runOnce();

    await repairTenantIndex(brokenTenantUser.tenantId);
    clockMs += BEYOND_RETRY_DELAY_MS;
    await dispatcher.runOnce();

    expect(await searchHitIds(brokenTenantUser.tenantId, "recovery")).toEqual([brokenId]);
    expect((await getConsumerState(stack.db, SEARCH_CONSUMER_NAME))?.lastError).toBeNull();
  });

  test("a change made while the tenant was held wins over the held one after recovery", async () => {
    await breakTenantIndex(brokenTenantUser.tenantId);
    const noteId = await createNote(brokenTenantUser, "ordering firsttitle");
    await dispatcher.runOnce();
    await renameNote(brokenTenantUser, noteId, "ordering secondtitle");
    await dispatcher.runOnce();

    await repairTenantIndex(brokenTenantUser.tenantId);
    clockMs += BEYOND_RETRY_DELAY_MS;
    await dispatcher.runOnce();

    expect(await searchHitIds(brokenTenantUser.tenantId, "secondtitle")).toEqual([noteId]);
    expect(await searchHitIds(brokenTenantUser.tenantId, "firsttitle")).toEqual([]);
  });

  test("a rejected stale-piece cleanup is held for the tenant and the retry restores the piece filters", async () => {
    const noteId = await createNote(brokenTenantUser, "cleanup firsttitle");
    await dispatcher.runOnce();
    await recreateTenantIndexWithoutSettings(brokenTenantUser.tenantId);
    await renameNote(brokenTenantUser, noteId, "cleanup secondtitle");
    const healthyId = await createNote(healthyTenantUser, "cleanup healthy tenant note");

    await dispatcher.runOnce();
    const heldState = await getConsumerState(stack.db, SEARCH_CONSUMER_NAME);
    clockMs += BEYOND_RETRY_DELAY_MS;
    await dispatcher.runOnce();

    expect(heldState?.status).toBe("idle");
    expect(heldState?.lastError).toContain(brokenTenantUser.tenantId);
    expect(await searchHitIds(healthyTenantUser.tenantId, "cleanup")).toEqual([healthyId]);
    const settings = await client
      .index(meilisearchTenantIndex(indexPrefix, brokenTenantUser.tenantId))
      .getSettings();
    expect(settings.filterableAttributes).toEqual(expect.arrayContaining(["_entityId", "_chunk"]));
    expect(await searchHitIds(brokenTenantUser.tenantId, "secondtitle")).toEqual([noteId]);
    expect((await getConsumerState(stack.db, SEARCH_CONSUMER_NAME))?.lastError).toBeNull();
  });
});
