import { describe, expect, test } from "vitest";
import { createInMemorySearchAdapter } from "../in-memory-adapter";
import type { SearchAdapter } from "../types";

describe("SearchAdapter interface", () => {
  test("InMemorySearchAdapter implements SearchAdapter", () => {
    const adapter: SearchAdapter = createInMemorySearchAdapter();
    expect(typeof adapter.index).toBe("function");
    expect(typeof adapter.search).toBe("function");
    expect(typeof adapter.remove).toBe("function");
  });
});

describe("InMemorySearchAdapter", () => {
  test("indexes and searches documents", async () => {
    const adapter = createInMemorySearchAdapter();

    await adapter.index("user", 1, { email: "marc@test.de", firstName: "Marc" });
    await adapter.index("user", 2, { email: "anna@test.de", firstName: "Anna" });
    await adapter.index("user", 3, { email: "beta@test.de", firstName: "Beta" });

    const results = await adapter.search("user", "marc");
    expect(results).toEqual([1]);
  });

  test("search is case-insensitive", async () => {
    const adapter = createInMemorySearchAdapter();
    await adapter.index("user", 1, { name: "Marc" });

    expect(await adapter.search("user", "MARC")).toEqual([1]);
    expect(await adapter.search("user", "marc")).toEqual([1]);
  });

  test("search across multiple fields", async () => {
    const adapter = createInMemorySearchAdapter();
    await adapter.index("user", 1, { email: "admin@test.de", name: "Admin" });

    // Should find by email
    expect(await adapter.search("user", "admin")).toEqual([1]);
    // Should find by name
    expect(await adapter.search("user", "Admin")).toEqual([1]);
  });

  test("remove deletes from index", async () => {
    const adapter = createInMemorySearchAdapter();
    await adapter.index("user", 1, { name: "Marc" });
    await adapter.remove("user", 1);

    expect(await adapter.search("user", "marc")).toEqual([]);
  });

  test("searches only within specified entity", async () => {
    const adapter = createInMemorySearchAdapter();
    await adapter.index("user", 1, { name: "Marc" });
    await adapter.index("post", 2, { title: "Marc's Post" });

    expect(await adapter.search("user", "marc")).toEqual([1]);
    expect(await adapter.search("post", "marc")).toEqual([2]);
  });

  test("returns empty array for no matches", async () => {
    const adapter = createInMemorySearchAdapter();
    await adapter.index("user", 1, { name: "Marc" });

    expect(await adapter.search("user", "nonexistent")).toEqual([]);
  });
});
