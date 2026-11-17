import { describe, expect, test } from "bun:test";
import { resolveSearchOption, searchAdapterContext } from "../search-option.ts";

const MEILI_ENV = { MEILI_URL: "http://127.0.0.1:1", MEILI_MASTER_KEY: "test-key" };

describe("search option", () => {
  test("builds the Meilisearch adapter from MEILI_URL and MEILI_MASTER_KEY", async () => {
    const adapter = await resolveSearchOption({ provider: "meili-env" }, MEILI_ENV);
    expect(adapter).toBeDefined();
    expect(typeof adapter.search).toBe("function");
  });

  test("names every missing env variable", async () => {
    await expect(resolveSearchOption({ provider: "meili-env" }, {})).rejects.toThrow(
      /missing: MEILI_URL, MEILI_MASTER_KEY/,
    );
    await expect(
      resolveSearchOption({ provider: "meili-env" }, { MEILI_URL: "http://127.0.0.1:1" }),
    ).rejects.toThrow(/missing: MEILI_MASTER_KEY/);
  });

  test("searchAdapterContext adds the adapter", async () => {
    const adapter = await resolveSearchOption({ provider: "meili-env" }, MEILI_ENV);
    expect(searchAdapterContext(adapter, {}, "runProdApp")).toEqual({ searchAdapter: adapter });
  });

  test("searchAdapterContext is empty without an adapter", () => {
    expect(searchAdapterContext(undefined, { searchAdapter: 1 }, "runProdApp")).toEqual({});
  });

  test("searchAdapterContext throws when extraContext also sets searchAdapter", async () => {
    const adapter = await resolveSearchOption({ provider: "meili-env" }, MEILI_ENV);
    expect(() => searchAdapterContext(adapter, { searchAdapter: adapter }, "runWorkerApp")).toThrow(
      /\[runWorkerApp\] the search option and extraContext.searchAdapter/,
    );
  });
});
