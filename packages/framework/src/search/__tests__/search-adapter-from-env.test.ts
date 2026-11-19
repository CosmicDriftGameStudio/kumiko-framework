import { describe, expect, spyOn, test } from "bun:test";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { createSearchAdapterFromEnv } from "../meilisearch-adapter.ts";
import { MEILI_INDEX_PREFIX_ENV } from "../meilisearch-adapter-internals.ts";
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

  test("builds a Meilisearch adapter on the given index prefix when both variables are set", async () => {
    await withEnv({ [MEILI_INDEX_PREFIX_ENV]: undefined }, async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ hits: [] }));
      try {
        const adapter = createSearchAdapterFromEnv(
          { MEILI_URL: "http://meili.test:7700", MEILI_MASTER_KEY: "master-key" },
          { indexPrefix: "app_" },
        );

        expect(await adapter.search(TENANT, "marc")).toEqual([]);
        const requestedUrls = fetchSpy.mock.calls.map(([input]) =>
          input instanceof Request ? input.url : String(input),
        );
        expect(requestedUrls).toEqual([`http://meili.test:7700/indexes/app_t${TENANT}/search`]);
      } finally {
        fetchSpy.mockRestore();
      }
    });
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
