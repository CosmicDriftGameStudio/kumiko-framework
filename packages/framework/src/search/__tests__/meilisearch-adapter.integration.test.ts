import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateId as uuid } from "@cosmicdrift/kumiko-framework/utils";
import { Meilisearch } from "meilisearch";
import { createMeilisearchAdapter, meilisearchTenantIndex } from "../meilisearch-adapter.js";
import type { SearchAdapter } from "../types.js";

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

// skipIf when compose Meili is down — unit tests still cover index/doc id shaping.
// In a dedicated integration job (REQUIRE_MEILI=1) a down Meili is a hard
// failure, not a silent skip — the compose service is expected to be up there.
const MEILI_UP = await meiliAvailable();
if (!MEILI_UP) {
  if (process.env["REQUIRE_MEILI"] === "1") {
    throw new Error(
      `REQUIRE_MEILI=1 but Meilisearch not reachable at ${MEILI_URL} — integration job misconfigured`,
    );
  }
  console.warn(
    `Meilisearch not reachable at ${MEILI_URL} — skipping live adapter tests ` +
      `(docker compose up -d meilisearch, default port 17700)`,
  );
}

// Use a fake tenantId to get a unique index name
const TENANT = uuid();

let adapter: SearchAdapter;
let client: Meilisearch;
let indexPrefix: string;

describe.skipIf(!MEILI_UP)("meilisearch adapter (live)", () => {
  beforeAll(async () => {
    client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
    indexPrefix = `test_${uuid()}_`;
    adapter = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix,
    });

    await adapter.configure(TENANT, {
      searchableFields: ["email", "firstName", "lastName", "notes", "_roles"],
      rankingFields: ["email", "firstName", "lastName", "notes", "_roles"],
    });

    // Seed data with different entity types and weights
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: {
        email: "marc.weber@company.de",
        firstName: "Marc",
        lastName: "Weber",
        notes: "Senior developer",
        _roles: "Admin, Developer",
      },
    });
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 2,
      weight: 10,
      fields: {
        email: "anna.schmidt@company.de",
        firstName: "Anna",
        lastName: "Schmidt",
        notes: "Project manager",
      },
    });
    await adapter.index(TENANT, {
      entityType: "user",
      entityId: 3,
      weight: 10,
      fields: {
        email: "admin@company.de",
        firstName: "Admin",
        lastName: "User",
        notes: "System administrator",
      },
    });
    await adapter.index(TENANT, {
      entityType: "role",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Admin" },
    });
    await adapter.index(TENANT, {
      entityType: "role",
      entityId: 2,
      weight: 1,
      fields: { firstName: "Developer" },
    });
    await adapter.index(TENANT, {
      entityType: "department",
      entityId: 1,
      weight: 5,
      fields: { firstName: "Engineering" },
    });
  });

  afterAll(async () => {
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

  // --- Basic search ---

  describe("basic search", () => {
    test("finds user by name", async () => {
      const results = await adapter.search(TENANT, "anna");
      expect(results.some((r) => r.entityId === 2 && r.entityType === "user")).toBe(true);
    });

    test("returns empty for no match", async () => {
      const results = await adapter.search(TENANT, "zzzznonexistent99999");
      expect(results).toEqual([]);
    });
  });

  // --- Partial matching ---

  describe("partial matching", () => {
    test("finds by prefix", async () => {
      const results = await adapter.search(TENANT, "mar");
      expect(results.some((r) => r.entityId === 1 && r.entityType === "user")).toBe(true);
    });
  });

  // --- Typo tolerance ---

  describe("typo tolerance", () => {
    test("finds despite typos", async () => {
      const results = await adapter.search(TENANT, "schmit");
      expect(results.some((r) => r.entityId === 2)).toBe(true);
    });
  });

  // --- Filter by entity type (list search) ---

  describe("list search (filterType)", () => {
    test("only returns specified entity type", async () => {
      const results = await adapter.search(TENANT, "admin", { filterType: "user" });
      expect(results.every((r) => r.entityType === "user")).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    test("role filter returns only roles", async () => {
      const results = await adapter.search(TENANT, "admin", { filterType: "role" });
      expect(results.every((r) => r.entityType === "role")).toBe(true);
    });
  });

  // --- Global search with weight ---

  describe("global search with searchWeight", () => {
    test("user (weight 10) ranks before role (weight 1) for same query", async () => {
      const results = await adapter.search(TENANT, "admin");
      const userIdx = results.findIndex((r) => r.entityType === "user");
      const roleIdx = results.findIndex((r) => r.entityType === "role");
      // User should appear before Role due to _weight:desc sort
      if (userIdx >= 0 && roleIdx >= 0) {
        expect(userIdx).toBeLessThan(roleIdx);
      }
    });
  });

  // --- Resolved relation data ---

  describe("relation data in search", () => {
    test("finds user by role name in _roles field", async () => {
      const results = await adapter.search(TENANT, "developer", { filterType: "user" });
      expect(results.some((r) => r.entityId === 1)).toBe(true);
    });
  });

  // --- Remove ---

  describe("remove", () => {
    test("removed document not found", async () => {
      // Create temp doc
      await adapter.index(TENANT, {
        entityType: "temp",
        entityId: 999,
        weight: 1,
        fields: { firstName: "DeleteMe" },
      });
      let results = await adapter.search(TENANT, "deleteme");
      expect(results.some((r) => r.entityId === 999)).toBe(true);

      await adapter.remove(TENANT, "temp", 999);
      results = await adapter.search(TENANT, "deleteme");
      expect(results.some((r) => r.entityId === 999)).toBe(false);
    });
  });

  // --- Batch variants ---

  describe("indexBatch / removeBatch", () => {
    test("indexBatch indexes multiple docs in a single task", async () => {
      const docs = Array.from({ length: 5 }, (_, i) => ({
        entityType: "batch" as const,
        entityId: 1000 + i,
        weight: 1,
        fields: { firstName: `Bulk${i}`, notes: "batchtoken" },
      }));
      await adapter.indexBatch?.(TENANT, docs);

      const hits = await adapter.search(TENANT, "batchtoken", { limit: 20, filterType: "batch" });
      expect(hits.length).toBe(5);
      const ids = hits.map((h) => h.entityId).sort();
      expect(ids).toEqual([1000, 1001, 1002, 1003, 1004]);
    });

    test("removeBatch removes multiple docs in a single task", async () => {
      await adapter.removeBatch?.(
        TENANT,
        [1000, 1001, 1002, 1003, 1004].map((id) => ({ entityType: "batch", entityId: id })),
      );
      const hits = await adapter.search(TENANT, "batchtoken", { limit: 20, filterType: "batch" });
      expect(hits.length).toBe(0);
    });

    test("indexBatch no-ops on empty array — no Meilisearch task created", async () => {
      // We verify the "no-op" contract by peeking at Meilisearch's own
      // IndexStats.numberOfDocuments + isIndexing directly. If the adapter had
      // accidentally sent an addDocuments request (even with an empty body),
      // isIndexing would flip to true or a task would land in the queue.
      // numberOfDocuments must also stay unchanged — the empty batch must not
      // replace, delete, or otherwise touch existing docs.
      const index = client.index(meilisearchTenantIndex(indexPrefix, TENANT));
      const before = await index.getStats();
      await expect(adapter.indexBatch?.(TENANT, [])).resolves.toBeUndefined();
      const after = await index.getStats();
      expect(after.numberOfDocuments).toBe(before.numberOfDocuments);
      expect(after.isIndexing).toBe(false);
    });
  });

  test("a search never returns more than maxTotalHits (1000), however high the limit is asked", async () => {
    const capTenant = uuid();
    await adapter.configure(capTenant, { searchableFields: ["firstName"] });
    await adapter.indexBatch?.(
      capTenant,
      Array.from({ length: 1001 }, (_, i) => ({
        entityType: "cap",
        entityId: i,
        weight: 1,
        fields: { firstName: "widget" },
      })),
    );

    try {
      const results = await adapter.search(capTenant, "widget", { filterType: "cap", limit: 1001 });
      expect(results).toHaveLength(1000);
    } finally {
      await client.index(meilisearchTenantIndex(indexPrefix, capTenant)).delete().waitTask();
    }
  });
});

// Lazy tenant-index configuration off setDefaultConfig, with no
// explicit per-tenant configure() call from the app.
describe.skipIf(!MEILI_UP)("meilisearch adapter — lazy default config", () => {
  let lazyClient: Meilisearch;
  let lazyPrefix: string;

  beforeAll(() => {
    lazyClient = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
    lazyPrefix = `test_lazy_${uuid()}_`;
  });

  afterAll(async () => {
    const indices = await lazyClient.getIndexes();
    for (const idx of indices.results) {
      if (idx.uid.startsWith(lazyPrefix)) {
        try {
          await lazyClient.index(idx.uid).delete().waitTask();
        } catch {
          /* ok */
        }
      }
    }
  });

  test("first access via index() configures the tenant index off the default config", async () => {
    const tenant = uuid();
    const lazyAdapter = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix: lazyPrefix,
    });
    lazyAdapter.setDefaultConfig?.({ searchableFields: ["firstName"] });

    await lazyAdapter.index(tenant, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { firstName: "Lazy" },
    });

    // Mutation-check target: without ensureConfigured() in index(), Meili
    // auto-creates the index on addDocuments but never sets filterable/
    // searchable attributes — assert those directly instead of relying on
    // adapter.search(), which would itself lazily configure the index and
    // mask the mutation.
    const index = lazyClient.index(meilisearchTenantIndex(lazyPrefix, tenant));
    expect(await index.getFilterableAttributes()).toEqual(
      expect.arrayContaining(["_type", "_weight"]),
    );
    expect(await index.getSearchableAttributes()).toEqual(["firstName"]);

    const results = await lazyAdapter.search(tenant, "lazy", { filterType: "user" });
    expect(results.some((r) => r.entityId === 1 && r.entityType === "user")).toBe(true);
  });

  test("first access via search() with filterType on a never-written tenant returns empty, not an error", async () => {
    const tenant = uuid();
    const lazyAdapter = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix: lazyPrefix,
    });
    lazyAdapter.setDefaultConfig?.({ searchableFields: ["firstName"] });

    const results = await lazyAdapter.search(tenant, "anything", { filterType: "user" });
    expect(results).toEqual([]);
  });

  test("remove/removeBatch on a never-indexed tenant do not create an index", async () => {
    const tenant = uuid();
    const lazyAdapter = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix: lazyPrefix,
    });
    lazyAdapter.setDefaultConfig?.({ searchableFields: ["firstName"] });

    await lazyAdapter.remove(tenant, "user", 1);
    await lazyAdapter.removeBatch?.(tenant, [{ entityType: "user", entityId: 2 }]);

    await expect(
      lazyClient.getIndex(meilisearchTenantIndex(lazyPrefix, tenant)),
    ).rejects.toMatchObject({ cause: { code: "index_not_found" } });
  });

  test("explicit configure() wins over a later setDefaultConfig() — never overwritten", async () => {
    const tenant = uuid();
    const lazyAdapter = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix: lazyPrefix,
    });

    await lazyAdapter.configure(tenant, { searchableFields: ["a"] });
    lazyAdapter.setDefaultConfig?.({ searchableFields: ["b"] });

    await lazyAdapter.index(tenant, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { a: "value" },
    });

    const index = lazyClient.index(meilisearchTenantIndex(lazyPrefix, tenant));
    expect(await index.getSearchableAttributes()).toEqual(["a"]);
  });

  test("an explicit configure() survives an adapter restart: the lazy default does not overwrite stored settings", async () => {
    const tenant = uuid();
    const options = { url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix: lazyPrefix };
    await createMeilisearchAdapter(options).configure(tenant, { searchableFields: ["a"] });

    // New adapter instance = fresh process memory after a pod restart.
    const restarted = createMeilisearchAdapter(options);
    restarted.setDefaultConfig?.({ searchableFields: ["b"] });
    await restarted.index(tenant, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { a: "value" },
    });

    const index = lazyClient.index(meilisearchTenantIndex(lazyPrefix, tenant));
    expect(await index.getSearchableAttributes()).toEqual(["a"]);
  });

});

describe.skipIf(!MEILI_UP)("meilisearch adapter — dropAllIndexes", () => {
  const dropClient = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  const createdPrefixes: string[] = [];

  function adapterWithFreshPrefix(): { adapter: SearchAdapter; prefix: string } {
    const prefix = `test_drop_${uuid()}_`;
    createdPrefixes.push(prefix);
    const created = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix: prefix,
    });
    created.setDefaultConfig?.({ searchableFields: ["firstName"] });
    return { adapter: created, prefix };
  }

  async function indexUids(prefix: string): Promise<string[]> {
    const all = await dropClient.getIndexes({ limit: 1000 });
    return all.results.map((i) => i.uid).filter((uid) => uid.startsWith(prefix));
  }

  afterAll(async () => {
    for (const prefix of createdPrefixes) {
      for (const uid of await indexUids(prefix)) {
        await dropClient.deleteIndex(uid).waitTask();
      }
    }
  });

  const doc = { entityType: "user", entityId: 1, weight: 1, fields: { firstName: "Dropme" } };

  test("drops only this adapter's prefix and returns the count", async () => {
    const { adapter: dropAdapter, prefix } = adapterWithFreshPrefix();
    const { adapter: foreignAdapter, prefix: foreignPrefix } = adapterWithFreshPrefix();
    await dropAdapter.index(uuid(), doc);
    await dropAdapter.index(uuid(), doc);
    await foreignAdapter.index(uuid(), doc);

    expect(await dropAdapter.dropAllIndexes?.()).toBe(2);

    expect(await indexUids(prefix)).toEqual([]);
    expect(await indexUids(foreignPrefix)).toHaveLength(1);
  });

  test("keeps indexes of a longer sibling prefix and non-tenant indexes", async () => {
    const base = `test_nest_${uuid()}_`;
    createdPrefixes.push(base, `${base}x_`);
    const make = (indexPrefix: string): SearchAdapter => {
      const created = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY, indexPrefix });
      created.setDefaultConfig?.({ searchableFields: ["firstName"] });
      return created;
    };
    const shortAdapter = make(base);
    await shortAdapter.index(uuid(), doc);
    await make(`${base}x_`).index(uuid(), doc);
    await dropClient.createIndex(`${base}notes`).waitTask();

    expect(await shortAdapter.dropAllIndexes?.()).toBe(1);

    const remaining = await indexUids(base);
    expect(remaining).toHaveLength(2);
    expect(remaining.some((uid) => uid.startsWith(`${base}x_t`))).toBe(true);
    expect(remaining).toContain(`${base}notes`);
  });

  test("index and filtered search work again after a drop (configured state is reset)", async () => {
    const { adapter: dropAdapter } = adapterWithFreshPrefix();
    const tenant = uuid();
    await dropAdapter.index(tenant, doc);
    await dropAdapter.dropAllIndexes?.();

    await dropAdapter.index(tenant, doc);
    const results = await dropAdapter.search(tenant, "dropme", { filterType: "user" });
    expect(results.map((r) => r.entityId)).toEqual([1]);
  });

  test("refuses an empty prefix", async () => {
    const noPrefix = createMeilisearchAdapter({
      url: MEILI_URL,
      apiKey: MEILI_KEY,
      indexPrefix: "",
    });
    await expect(noPrefix.dropAllIndexes?.()).rejects.toThrow("empty prefix");
  });
});
