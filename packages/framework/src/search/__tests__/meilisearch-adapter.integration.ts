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
});

afterAll(async () => {
  try {
    await client.index(testIndex).delete().waitTask();
  } catch {
    // Index might not exist
  }
});

describe("MeilisearchAdapter", () => {
  test("indexes and searches documents", async () => {
    await adapter.index(testIndex, 1, { email: "marc@test.de", firstName: "Marc" });
    await adapter.index(testIndex, 2, { email: "anna@test.de", firstName: "Anna" });
    await adapter.index(testIndex, 3, { email: "beta@test.de", firstName: "Beta" });

    const results = await adapter.search(testIndex, "marc");
    expect(results).toContain(1);
    expect(results).not.toContain(2);
  });

  test("search is fuzzy and typo-tolerant", async () => {
    await adapter.index(testIndex, 10, { name: "Philadelphia" });

    // Meilisearch handles typos
    const results = await adapter.search(testIndex, "philadelpha");
    expect(results).toContain(10);
  });

  test("remove deletes from index", async () => {
    await adapter.index(testIndex, 20, { name: "ToDelete" });

    let results = await adapter.search(testIndex, "ToDelete");
    expect(results).toContain(20);

    await adapter.remove(testIndex, 20);

    results = await adapter.search(testIndex, "ToDelete");
    expect(results).not.toContain(20);
  });

  test("search returns empty for no matches", async () => {
    const results = await adapter.search(testIndex, "zzzznonexistent12345");
    expect(results).toEqual([]);
  });
});
