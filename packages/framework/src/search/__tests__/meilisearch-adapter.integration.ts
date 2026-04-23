import type { TenantId } from "@kumiko/framework/engine";
import { generateId as uuid } from "@kumiko/framework/utils";
import { Meilisearch } from "meilisearch";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createMeilisearchAdapter } from "../meilisearch-adapter";
import type { SearchAdapter } from "../types";

const MEILI_URL = process.env["MEILI_URL"] ?? "http://localhost:17700";
const MEILI_KEY = process.env["MEILI_MASTER_KEY"] ?? "kumiko-dev-key";

// Use a fake tenantId to get a unique index name
const TENANT = uuid();

let adapter: SearchAdapter;
let client: Meilisearch;
let indexPrefix: string;

// Mirrors meilisearch-adapter.ts's tenantIndex() — used by tests that need
// to talk to Meilisearch directly (e.g. stats before/after a no-op).
const tenantIndex = (prefix: string, tenantId: TenantId): string => `${prefix}t${tenantId}`;

beforeAll(async () => {
  client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  indexPrefix = `test_${uuid().slice(-6)}_`;
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
  // Clean up all test indices
  const indices = await client.getIndexes();
  for (const idx of indices.results) {
    if (idx.uid.startsWith("test_")) {
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
    const index = client.index(tenantIndex(indexPrefix, TENANT));
    const before = await index.getStats();
    await expect(adapter.indexBatch?.(TENANT, [])).resolves.toBeUndefined();
    const after = await index.getStats();
    expect(after.numberOfDocuments).toBe(before.numberOfDocuments);
    expect(after.isIndexing).toBe(false);
  });
});
