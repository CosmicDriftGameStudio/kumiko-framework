import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId as uuid } from "@cosmicdrift/kumiko-framework/utils";
import { Meilisearch } from "meilisearch";
import { createMeilisearchAdapter } from "../meilisearch-adapter.ts";
import { meilisearchDocId, meilisearchTenantIndex } from "../meilisearch-adapter-internals.ts";
import { CHUNK_MAX_CHARS } from "../meilisearch-chunking.ts";
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
  throw new Error(`REQUIRE_MEILI=1 but Meilisearch not reachable at ${MEILI_URL}`);
}

const TENANT = uuid();
const ENTITY_ID = uuid();
const indexPrefix = `test_${uuid()}_`;
const index = (client: Meilisearch) => client.index(meilisearchTenantIndex(indexPrefix, TENANT));

function filler(words: number): string {
  return Array.from({ length: words }, (_, i) => `filler${i % 50}`).join(" ");
}

// Puts "straddle" across the first chunk boundary and "finalword" at the very end.
function longBody(): string {
  const head = filler(1_300);
  const beforeBoundary = head.slice(0, CHUNK_MAX_CHARS - 4);
  return `${beforeBoundary} straddleword ${filler(40_000)} finalword`;
}

describe.skipIf(!MEILI_UP)("meilisearch chunking (live)", () => {
  let adapter: SearchAdapter;
  let client: Meilisearch;

  beforeAll(async () => {
    client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
    adapter = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix });
    await adapter.configure(TENANT, { searchableFields: ["body", "title"] });
  });

  afterAll(async () => {
    const { results } = await client.getIndexes();
    for (const idx of results) {
      if (idx.uid.startsWith(indexPrefix)) await client.index(idx.uid).delete().waitTask();
    }
  });

  async function pieceCount(): Promise<number> {
    const stats = await index(client).getStats();
    return stats.numberOfDocuments;
  }

  test("a 300k character body is found at the end and across a chunk boundary, once per entity", async () => {
    const body = longBody();
    expect(body.length).toBeGreaterThan(300_000);
    await adapter.index(TENANT, {
      entityType: "note",
      entityId: ENTITY_ID,
      weight: 1,
      fields: { title: "Meeting", body },
    });
    expect(await pieceCount()).toBeGreaterThan(30);

    for (const term of ["finalword", "straddleword"]) {
      const hits = await adapter.search(TENANT, term, { filterType: "note" });
      expect(hits.map((h) => h.entityId)).toEqual([ENTITY_ID]);
    }
    // Present in every piece: distinct still returns the entity once.
    const common = await adapter.search(TENANT, "filler7", { filterType: "note" });
    expect(common.map((h) => h.entityId)).toEqual([ENTITY_ID]);
  });

  test("re-indexing a shorter text removes the surplus pieces; a short field stays findable", async () => {
    await adapter.index(TENANT, {
      entityType: "note",
      entityId: ENTITY_ID,
      weight: 1,
      fields: { title: "Meeting", body: "short body" },
    });
    expect(await pieceCount()).toBe(1);
    expect(await adapter.search(TENANT, "finalword")).toEqual([]);
    expect((await adapter.search(TENANT, "meeting")).map((h) => h.entityId)).toEqual([ENTITY_ID]);
  });

  test("remove deletes every piece; a legacy document without _chunk is overwritten and removed", async () => {
    const legacyId = uuid();
    const legacy = {
      _id: meilisearchDocId("note", legacyId),
      _type: "note",
      _weight: 1,
      _entityId: legacyId,
      body: "legacyonlyword",
    };
    await index(client).addDocuments([legacy], { primaryKey: "_id" }).waitTask();
    expect((await adapter.search(TENANT, "legacyonlyword")).map((h) => h.entityId)).toEqual([
      legacyId,
    ]);

    await adapter.index(TENANT, {
      entityType: "note",
      entityId: legacyId,
      weight: 1,
      fields: { body: `replacedword ${filler(5_000)}` },
    });
    expect(await adapter.search(TENANT, "legacyonlyword")).toEqual([]);
    expect((await adapter.search(TENANT, "replacedword")).map((h) => h.entityId)).toEqual([
      legacyId,
    ]);

    await adapter.remove(TENANT, "note", legacyId);
    await adapter.remove(TENANT, "note", ENTITY_ID);
    expect(await pieceCount()).toBe(0);
  });

  test("removeBatch removes several entities with all their pieces", async () => {
    const ids = [uuid(), uuid()];
    await adapter.indexBatch?.(
      TENANT,
      ids.map((entityId) => ({
        entityType: "note",
        entityId,
        weight: 1,
        fields: { body: filler(5_000) },
      })),
    );
    expect(await pieceCount()).toBeGreaterThan(2);
    await adapter.removeBatch?.(
      TENANT,
      ids.map((entityId) => ({ entityType: "note", entityId })),
    );
    expect(await pieceCount()).toBe(0);
  });

  test("a default-configured index from before chunking gets distinct and the new filterables", async () => {
    const tenant = uuid();
    const upgrading = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix });
    const oldIndex = client.index(meilisearchTenantIndex(indexPrefix, tenant));
    await client.createIndex(oldIndex.uid, { primaryKey: "_id" }).waitTask();
    await oldIndex.updateSearchableAttributes(["body"]).waitTask();
    await oldIndex.updateFilterableAttributes(["_type", "_weight"]).waitTask();
    await oldIndex.updateSortableAttributes(["_weight"]).waitTask();

    upgrading.setDefaultConfig?.({ searchableFields: ["body"] });
    await upgrading.index(tenant, {
      entityType: "note",
      entityId: uuid(),
      weight: 1,
      fields: { body: "upgradeword" },
    });
    const settings = await oldIndex.getSettings();
    expect(settings.distinctAttribute).toBe("_entityId");
    expect(settings.filterableAttributes).toEqual(
      expect.arrayContaining(["_type", "_weight", "_entityId", "_chunk"]),
    );
  });
});
