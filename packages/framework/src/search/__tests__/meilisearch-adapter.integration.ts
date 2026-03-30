import { MeiliSearch } from "meilisearch";
import { v4 as uuid } from "uuid";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createMeilisearchAdapter } from "../meilisearch-adapter";
import type { SearchAdapter } from "../types";

const MEILI_URL = process.env["MEILI_URL"] ?? "http://localhost:17700";
const MEILI_KEY = process.env["MEILI_MASTER_KEY"] ?? "kumiko-dev-key";

let adapter: SearchAdapter;
let client: MeiliSearch;
let testIndex: string;

beforeAll(async () => {
  testIndex = `test_${uuid().slice(0, 8)}`;
  client = new MeiliSearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  adapter = createMeilisearchAdapter({ url: MEILI_URL, apiKey: MEILI_KEY });

  // Configure with ranked searchable fields (email > firstName > lastName)
  await adapter.configure(testIndex, {
    searchableFields: ["email", "firstName", "lastName", "notes"],
    rankingFields: ["email", "firstName", "lastName", "notes"],
  });

  // Seed test data
  await adapter.index(testIndex, 1, {
    email: "marc.weber@company.de",
    firstName: "Marc",
    lastName: "Weber",
    notes: "Senior developer",
  });
  await adapter.index(testIndex, 2, {
    email: "anna.schmidt@company.de",
    firstName: "Anna",
    lastName: "Schmidt",
    notes: "Project manager",
  });
  await adapter.index(testIndex, 3, {
    email: "marc.mueller@other.de",
    firstName: "Marc",
    lastName: "Mueller",
    notes: "Junior developer",
  });
  await adapter.index(testIndex, 4, {
    email: "beta@test.de",
    firstName: "Beta",
    lastName: "Tester",
    notes: "QA",
  });
  await adapter.index(testIndex, 5, {
    email: "admin@company.de",
    firstName: "Admin",
    lastName: "User",
    notes: "System administrator",
  });
});

afterAll(async () => {
  try {
    await client.index(testIndex).delete().waitTask();
  } catch {
    // Index might not exist
  }
});

// --- Basic search ---

describe("basic search", () => {
  test("finds by name", async () => {
    const results = await adapter.search(testIndex, "anna");
    expect(results).toContain(2);
  });

  test("finds by email domain", async () => {
    const results = await adapter.search(testIndex, "company");
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  test("returns empty for no match", async () => {
    const results = await adapter.search(testIndex, "zzzznonexistent99999");
    expect(results).toEqual([]);
  });
});

// --- Partial / prefix matching ---

describe("partial matching", () => {
  test("finds by prefix", async () => {
    const results = await adapter.search(testIndex, "mar");
    // Should find both Marcs
    expect(results).toContain(1);
    expect(results).toContain(3);
  });

  test("finds by partial email", async () => {
    const results = await adapter.search(testIndex, "weber");
    expect(results).toContain(1);
  });
});

// --- Typo tolerance (Meilisearch native) ---

describe("typo tolerance", () => {
  test("finds despite typos", async () => {
    const results = await adapter.search(testIndex, "schmit"); // missing 'd'
    expect(results).toContain(2);
  });

  test("finds with swapped letters", async () => {
    const results = await adapter.search(testIndex, "developre"); // typo
    // Should find entries with "developer" in notes
    expect(results.length).toBeGreaterThan(0);
  });
});

// --- Scoring / relevance ---

describe("scoring and relevance", () => {
  test("email match ranks higher than notes match for 'admin'", async () => {
    // User 5 has "admin" in email (highest ranked field)
    // User 5 also has "administrator" in notes
    const results = await adapter.search(testIndex, "admin");
    expect(results[0]).toBe(5); // email match first
  });

  test("searching 'marc' returns both Marcs", async () => {
    const results = await adapter.search(testIndex, "marc");
    expect(results).toContain(1);
    expect(results).toContain(3);
    expect(results).toHaveLength(2);
  });
});

// --- Limit ---

describe("limit", () => {
  test("respects limit option", async () => {
    const results = await adapter.search(testIndex, "company", { limit: 2 });
    expect(results).toHaveLength(2);
  });
});

// --- Remove ---

describe("remove", () => {
  test("removed document is no longer found", async () => {
    const tempIndex = `temp_${uuid().slice(0, 8)}`;
    await adapter.configure(tempIndex, { searchableFields: ["name"] });
    await adapter.index(tempIndex, 100, { name: "Temporary" });

    let results = await adapter.search(tempIndex, "temporary");
    expect(results).toContain(100);

    await adapter.remove(tempIndex, 100);

    results = await adapter.search(tempIndex, "temporary");
    expect(results).not.toContain(100);

    // Cleanup
    try {
      await client.index(tempIndex).delete().waitTask();
    } catch {
      // ok
    }
  });
});

// --- Data types ---

describe("different data types", () => {
  test("number fields are searchable as strings", async () => {
    const typeIndex = `types_${uuid().slice(0, 8)}`;
    await adapter.configure(typeIndex, { searchableFields: ["code", "label"] });
    await adapter.index(typeIndex, 1, { code: 42, label: "Answer" });

    // Meilisearch can search numbers
    const results = await adapter.search(typeIndex, "42");
    expect(results).toContain(1);

    try {
      await client.index(typeIndex).delete().waitTask();
    } catch {
      // ok
    }
  });
});
