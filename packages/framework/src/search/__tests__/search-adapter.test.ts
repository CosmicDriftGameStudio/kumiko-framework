import { beforeEach, describe, expect, test } from "vitest";
import { createInMemorySearchAdapter } from "../in-memory-adapter";
import type { SearchAdapter } from "../types";

let adapter: SearchAdapter;

beforeEach(async () => {
  adapter = createInMemorySearchAdapter();
  await adapter.configure("user", {
    searchableFields: ["email", "firstName", "lastName"],
    rankingFields: ["email", "firstName", "lastName"],
  });
});

// --- Basic search ---

describe("basic search", () => {
  test("finds by exact field value", async () => {
    await adapter.index("user", 1, { email: "marc@test.de", firstName: "Marc", lastName: "Weber" });
    await adapter.index("user", 2, {
      email: "anna@test.de",
      firstName: "Anna",
      lastName: "Schmidt",
    });

    expect(await adapter.search("user", "marc")).toEqual([1]);
    expect(await adapter.search("user", "anna")).toEqual([2]);
  });

  test("search is case-insensitive", async () => {
    await adapter.index("user", 1, { firstName: "Marc" });

    expect(await adapter.search("user", "MARC")).toEqual([1]);
    expect(await adapter.search("user", "marc")).toEqual([1]);
    expect(await adapter.search("user", "Marc")).toEqual([1]);
  });

  test("returns empty for no matches", async () => {
    await adapter.index("user", 1, { firstName: "Marc" });
    expect(await adapter.search("user", "nonexistent")).toEqual([]);
  });

  test("returns empty for empty index", async () => {
    expect(await adapter.search("user", "anything")).toEqual([]);
  });
});

// --- Partial / substring matching ---

describe("partial text matching", () => {
  test("finds by prefix", async () => {
    await adapter.index("user", 1, { firstName: "Alexander" });

    expect(await adapter.search("user", "alex")).toEqual([1]);
  });

  test("finds by substring", async () => {
    await adapter.index("user", 1, { email: "marc.weber@company.de" });

    expect(await adapter.search("user", "weber")).toEqual([1]);
    expect(await adapter.search("user", "company")).toEqual([1]);
  });

  test("finds by partial email", async () => {
    await adapter.index("user", 1, { email: "info@mueller-gmbh.de" });

    expect(await adapter.search("user", "mueller")).toEqual([1]);
  });
});

// --- Multi-field search ---

describe("multi-field search", () => {
  test("finds across different fields", async () => {
    await adapter.index("user", 1, { email: "x@test.de", firstName: "Marc", lastName: "Weber" });

    expect(await adapter.search("user", "marc")).toEqual([1]);
    expect(await adapter.search("user", "weber")).toEqual([1]);
    expect(await adapter.search("user", "test.de")).toEqual([1]);
  });

  test("multiple results from different documents", async () => {
    await adapter.index("user", 1, { firstName: "Marc", lastName: "Mueller" });
    await adapter.index("user", 2, { firstName: "Anna", lastName: "Mueller" });

    const results = await adapter.search("user", "mueller");
    expect(results).toContain(1);
    expect(results).toContain(2);
  });
});

// --- Scoring / ranking ---

describe("scoring and ranking", () => {
  test("email field ranks higher than lastName (configured order)", async () => {
    // rankingFields: ["email", "firstName", "lastName"] — email first = highest weight
    await adapter.index("user", 1, {
      email: "other@test.de",
      firstName: "Other",
      lastName: "Admin",
    });
    await adapter.index("user", 2, {
      email: "admin@test.de",
      firstName: "Other",
      lastName: "Other",
    });

    const results = await adapter.search("user", "admin");
    // User 2 should rank higher because "admin" is in email (higher ranked field)
    expect(results[0]).toBe(2);
  });

  test("exact match ranks higher than partial", async () => {
    await adapter.index("user", 1, { firstName: "marc" });
    await adapter.index("user", 2, { firstName: "marcello" });

    const results = await adapter.search("user", "marc");
    expect(results[0]).toBe(1); // exact match first
  });

  test("prefix match ranks higher than substring", async () => {
    await adapter.index("user", 1, { firstName: "marc" });
    await adapter.index("user", 2, { firstName: "remarc" });

    const results = await adapter.search("user", "marc");
    expect(results[0]).toBe(1); // prefix/exact match first
  });
});

// --- Entity isolation ---

describe("entity isolation", () => {
  test("different entities are isolated", async () => {
    await adapter.configure("post", { searchableFields: ["title"] });
    await adapter.index("user", 1, { firstName: "Marc" });
    await adapter.index("post", 1, { title: "Marc's Post" });

    expect(await adapter.search("user", "marc")).toEqual([1]);
    expect(await adapter.search("post", "marc")).toEqual([1]);
  });
});

// --- Remove ---

describe("remove", () => {
  test("removes document from search", async () => {
    await adapter.index("user", 1, { firstName: "Marc" });
    await adapter.index("user", 2, { firstName: "Anna" });

    await adapter.remove("user", 1);

    expect(await adapter.search("user", "marc")).toEqual([]);
    expect(await adapter.search("user", "anna")).toEqual([2]);
  });
});

// --- Limit ---

describe("limit", () => {
  test("respects limit option", async () => {
    for (let i = 1; i <= 10; i++) {
      await adapter.index("user", i, { firstName: `User${i}`, lastName: "Test" });
    }

    const results = await adapter.search("user", "test", { limit: 3 });
    expect(results).toHaveLength(3);
  });
});

// --- All data types ---

describe("all field types in search", () => {
  test("text fields are searchable", async () => {
    await adapter.configure("item", { searchableFields: ["name", "description"] });
    await adapter.index("item", 1, { name: "Widget", description: "A useful tool for everything" });

    expect(await adapter.search("item", "widget")).toEqual([1]);
    expect(await adapter.search("item", "useful")).toEqual([1]);
  });

  test("number fields are converted to string for search", async () => {
    await adapter.configure("item", { searchableFields: ["code"] });
    await adapter.index("item", 1, { code: 12345 });

    expect(await adapter.search("item", "12345")).toEqual([1]);
  });

  test("boolean fields are converted to string for search", async () => {
    await adapter.configure("item", { searchableFields: ["status"] });
    await adapter.index("item", 1, { status: true });

    expect(await adapter.search("item", "true")).toEqual([1]);
  });

  test("null and undefined fields are ignored", async () => {
    await adapter.configure("item", { searchableFields: ["name", "extra"] });
    await adapter.index("item", 1, { name: "Test", extra: null });
    await adapter.index("item", 2, { name: "Test2", extra: undefined });

    expect(await adapter.search("item", "test")).toHaveLength(2);
    expect(await adapter.search("item", "null")).toHaveLength(0);
  });
});
