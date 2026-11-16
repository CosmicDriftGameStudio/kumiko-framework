import { describe, expect, test } from "bun:test";
import { createSearchAdapterFromEnv } from "../meilisearch-adapter.ts";
import type { SearchAdapter } from "../types.ts";

const TENANT = "00000000-0000-4000-8000-000000000001";

async function indexAndFind(adapter: SearchAdapter): Promise<void> {
  await adapter.configure(TENANT, {
    searchableFields: ["firstName"],
    rankingFields: ["firstName"],
  });
  await adapter.index(TENANT, {
    entityType: "user",
    entityId: 1,
    weight: 10,
    fields: { firstName: "Marc" },
  });
  const results = await adapter.search(TENANT, "marc");
  expect(results).toHaveLength(1);
  expect(results[0]?.entityId).toBe(1);
}

describe("createSearchAdapterFromEnv", () => {
  test("falls back to the in-memory adapter when neither variable is set", async () => {
    await indexAndFind(createSearchAdapterFromEnv({}));
  });

  test("treats whitespace-only values as unset", async () => {
    await indexAndFind(createSearchAdapterFromEnv({ MEILI_URL: "  ", MEILI_MASTER_KEY: "" }));
  });

  test("throws when only MEILI_URL is set", () => {
    expect(() => createSearchAdapterFromEnv({ MEILI_URL: "http://localhost:7700" })).toThrow(
      /MEILI_MASTER_KEY is not set/,
    );
  });

  test("throws when only MEILI_MASTER_KEY is set", () => {
    expect(() => createSearchAdapterFromEnv({ MEILI_MASTER_KEY: "secret" })).toThrow(
      /MEILI_URL is not set/,
    );
  });
});
