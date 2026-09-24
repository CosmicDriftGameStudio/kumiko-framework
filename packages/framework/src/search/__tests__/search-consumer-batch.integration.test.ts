// #3227 — the search consumer's batchHandler against a real Meilisearch:
// N created events collapse into one indexBatch task, and same-turn
// collisions on one aggregate resolve to the LAST op (update-then-delete
// removes, delete-then-restore indexes the restored state).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId as uuid } from "@cosmicdrift/kumiko-framework/utils";
import { Meilisearch } from "meilisearch";
import * as z from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine";
import type { ConsumerStateRow, StoredEventRow } from "../../pipeline/event-dispatcher-delivery";
import { deliverEvents } from "../../pipeline/event-dispatcher-delivery";
import { createSearchEventConsumer } from "../../pipeline/system-hooks";
import { setupTestStack, type TestStack } from "../../stack";
import { createMeilisearchAdapter, meilisearchTenantIndex } from "../meilisearch-adapter";
import type { SearchAdapter } from "../types";

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
if (!MEILI_UP) {
  if (process.env["REQUIRE_MEILI"] === "1") {
    throw new Error(
      `REQUIRE_MEILI=1 but Meilisearch not reachable at ${MEILI_URL} — integration job misconfigured`,
    );
  }
  console.warn(
    `Meilisearch not reachable at ${MEILI_URL} — skipping live batch-consumer tests ` +
      `(docker compose up -d meilisearch, default port 17700)`,
  );
}

const docEntity = createEntity({
  table: "read_batch_search_docs",
  fields: {
    label: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
      searchable: true,
    }),
  },
});

const batchSearchFeature = defineFeature("batch-search", (r) => {
  r.entity("doc", docEntity);
  r.defineEvent("noop", z.object({}), { piiFields: "none" });
});

const TENANT = uuid();

let client: Meilisearch;
let indexPrefix: string;
let meiliAdapter: SearchAdapter;
let stack: TestStack;
let consumer: ReturnType<typeof createSearchEventConsumer>;
let nextId = 1n;

function stubState(): ConsumerStateRow {
  return {
    name: "search",
    instanceId: "shared",
    lastProcessedEventId: 0n,
    status: "idle",
    attempts: 0,
    rearmCount: 0,
    pendingGaps: [],
    lastError: null,
    updatedAt: Temporal.Now.instant(),
  };
}

function eventRow(
  aggregateId: string,
  type: "created" | "updated" | "deleted" | "restored",
  payload: Record<string, unknown>,
): StoredEventRow {
  return {
    id: nextId++,
    aggregateId,
    aggregateType: "doc",
    tenantId: TENANT,
    version: 1,
    type: `doc.${type}`,
    eventVersion: 1,
    payload,
    metadata: { userId: "system" },
    createdAt: Temporal.Now.instant(),
    createdBy: "system",
  };
}

async function deliverBatch(rows: readonly StoredEventRow[]): Promise<void> {
  const outcome = await deliverEvents(
    consumer,
    rows,
    { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
    10,
    stubState(),
  );
  if (outcome.failed > 0) throw new Error(`test setup: delivery failed (${outcome.lastError})`);
}

async function taskCountSince(baselineUid: number, types: readonly string[]): Promise<number> {
  const indexUid = meilisearchTenantIndex(indexPrefix, TENANT);
  const page = await client.tasks.getTasks({
    indexUids: [indexUid],
    types: types as ("documentAdditionOrUpdate" | "documentDeletion")[],
    limit: 100,
  });
  return page.results.filter((task) => task.uid > baselineUid).length;
}

async function highestTaskUid(): Promise<number> {
  const indexUid = meilisearchTenantIndex(indexPrefix, TENANT);
  const page = await client.tasks.getTasks({ indexUids: [indexUid], limit: 1 });
  return page.results[0]?.uid ?? -1;
}

describe.skipIf(!MEILI_UP)("search consumer batchHandler (live Meilisearch)", () => {
  beforeAll(async () => {
    client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
    indexPrefix = `test_batch_${uuid()}_`;
    meiliAdapter = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix });

    stack = await setupTestStack({ features: [batchSearchFeature], systemHooks: [] });
    consumer = createSearchEventConsumer(meiliAdapter, stack.registry);

    await meiliAdapter.configure(TENANT, { searchableFields: ["label"] });
  });

  afterAll(async () => {
    await stack.cleanup();
    const indices = await client.getIndexes();
    for (const idx of indices.results) {
      if (idx.uid.startsWith(indexPrefix)) {
        try {
          await client.index(idx.uid).delete().waitTask();
        } catch {
          /* ok */
        }
      }
    }
  });

  test("5 created events for one tenant produce exactly one indexing task and 5 searchable docs", async () => {
    const baseline = await highestTaskUid();
    const rows = Array.from({ length: 5 }, (_, i) =>
      eventRow(uuid(), "created", { label: `batchdoc-${i}` }),
    );

    await deliverBatch(rows);

    const indexTasks = await taskCountSince(baseline, ["documentAdditionOrUpdate"]);
    expect(indexTasks).toBe(1);

    const hits = await meiliAdapter.search(TENANT, "batchdoc", { limit: 20, filterType: "doc" });
    expect(hits.length).toBe(5);
  });

  test("update-then-delete of the same aggregate in one batch leaves the doc absent", async () => {
    const aggregateId = uuid();
    await deliverBatch([eventRow(aggregateId, "created", { label: "collapse-update-delete" })]);
    expect(
      (await meiliAdapter.search(TENANT, "collapse-update-delete", { filterType: "doc" })).some(
        (h) => h.entityId === aggregateId,
      ),
    ).toBe(true);

    await deliverBatch([
      eventRow(aggregateId, "updated", {
        previous: { label: "collapse-update-delete" },
        changes: { label: "collapse-update-delete-updated" },
      }),
      eventRow(aggregateId, "deleted", {}),
    ]);

    const hits = await meiliAdapter.search(TENANT, "collapse-update-delete", {
      filterType: "doc",
    });
    expect(hits.some((h) => h.entityId === aggregateId)).toBe(false);
  });

  test("delete-then-restore of the same aggregate in one batch indexes the restored state", async () => {
    const aggregateId = uuid();
    await deliverBatch([eventRow(aggregateId, "created", { label: "collapse-delete-restore" })]);

    await deliverBatch([
      eventRow(aggregateId, "deleted", {}),
      eventRow(aggregateId, "restored", { previous: { label: "collapse-delete-restore-back" } }),
    ]);

    const hits = await meiliAdapter.search(TENANT, "collapse-delete-restore-back", {
      filterType: "doc",
    });
    expect(hits.some((h) => h.entityId === aggregateId)).toBe(true);
  });

  test("a batch mixing creates and deletes produces at most one index task and one deletion task", async () => {
    const toDelete = uuid();
    await deliverBatch([eventRow(toDelete, "created", { label: "mixed-batch-to-delete" })]);

    const baseline = await highestTaskUid();
    await deliverBatch([
      eventRow(uuid(), "created", { label: "mixed-batch-created-1" }),
      eventRow(uuid(), "created", { label: "mixed-batch-created-2" }),
      eventRow(toDelete, "deleted", {}),
    ]);

    const indexTasks = await taskCountSince(baseline, ["documentAdditionOrUpdate"]);
    const deletionTasks = await taskCountSince(baseline, ["documentDeletion"]);
    expect(indexTasks).toBe(1);
    expect(deletionTasks).toBe(1);
  });

  test("remove and removeBatch on a tenant whose index was never created resolve", async () => {
    const tenantWithoutIndex = uuid();
    await expect(meiliAdapter.remove(tenantWithoutIndex, "doc", uuid())).resolves.toBeUndefined();
    await expect(
      meiliAdapter.removeBatch?.(tenantWithoutIndex, [{ entityType: "doc", entityId: uuid() }]),
    ).resolves.toBeUndefined();
  });

  test("indexBatch rejects when one doc in the batch fails on the Meilisearch side", async () => {
    // Meilisearch caps document identifiers at 511 bytes — meilisearchDocId
    // prefixes with `${entityType}_`, so an id this long overflows that
    // limit and the server fails the whole task with invalid_document_id.
    const oversizedId = `${uuid()}${"a".repeat(520)}`;
    await expect(
      meiliAdapter.indexBatch?.(TENANT, [
        { entityType: "doc", entityId: uuid(), weight: 1, fields: { label: "valid-doc" } },
        { entityType: "doc", entityId: oversizedId, weight: 1, fields: { label: "poison-doc" } },
      ]),
    ).rejects.toThrow(/invalid_document_id/);
  });

  test("a poison doc in the batch halts the turn at the last good event; a second pass dead-letters it", async () => {
    // Real UUID aggregateIds always produce a valid Meili doc id via
    // meilisearchDocId (all illegal characters are sanitized away) — the
    // only realistic way to fail Meili's own id validation is length, so
    // event #3's aggregateId is an oversized synthetic id, not a shape
    // production ever emits.
    const poisonConsumer = {
      ...createSearchEventConsumer(meiliAdapter, stack.registry),
      errorPolicy: { maxAttempts: 2 },
    };

    const good1 = eventRow(uuid(), "created", { label: "poisondoc-1" });
    const good2 = eventRow(uuid(), "created", { label: "poisondoc-2" });
    const poisonAggregateId = `${uuid()}${"a".repeat(520)}`;
    const poison = eventRow(poisonAggregateId, "created", { label: "poisondoc-3" });
    const good4 = eventRow(uuid(), "created", { label: "poisondoc-4" });
    const good5 = eventRow(uuid(), "created", { label: "poisondoc-5" });
    const rows = [good1, good2, poison, good4, good5];

    const first = await deliverEvents(
      poisonConsumer,
      rows,
      { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
      10,
      stubState(),
    );

    expect(first.cursor).toBe(good2.id);
    expect(first.attempts).toBe(1);
    expect(first.deadLettered).toBe(false);

    const hitsAfterFirst = await meiliAdapter.search(TENANT, "poisondoc", {
      limit: 20,
      filterType: "doc",
    });
    const foundLabels = new Set(hitsAfterFirst.map((h) => h.entityId));
    expect(foundLabels.has(good1.aggregateId)).toBe(true);
    expect(foundLabels.has(good2.aggregateId)).toBe(true);
    expect(foundLabels.has(poison.aggregateId)).toBe(false);
    expect(foundLabels.has(good4.aggregateId)).toBe(false);
    expect(foundLabels.has(good5.aggregateId)).toBe(false);

    const second = await deliverEvents(
      poisonConsumer,
      rows.slice(2),
      { db: stack.db, redis: stack.redis.redis, registry: stack.registry },
      10,
      {
        ...stubState(),
        lastProcessedEventId: first.cursor,
        attempts: first.attempts,
        lastError: first.lastError,
      },
    );

    expect(second.deadLettered).toBe(true);
    expect(second.attempts).toBe(2);
    expect(second.cursor).toBe(good2.id);
  });
});
