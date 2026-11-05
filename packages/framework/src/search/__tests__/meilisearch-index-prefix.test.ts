import { describe, expect, test } from "bun:test";
import {
  MEILI_INDEX_PREFIX_ENV,
  resolveMeilisearchIndexPrefix,
} from "../meilisearch-adapter-internals.ts";

describe("resolveMeilisearchIndexPrefix", () => {
  test("without env and option it stays on the default prefix of existing deployments", () => {
    expect(resolveMeilisearchIndexPrefix(undefined, {})).toBe("kumiko_");
  });

  test("the option applies without env", () => {
    expect(resolveMeilisearchIndexPrefix("app_", {})).toBe("app_");
  });

  test("the env beats the option", () => {
    expect(resolveMeilisearchIndexPrefix("app_", { [MEILI_INDEX_PREFIX_ENV]: "e2e_run_" })).toBe(
      "e2e_run_",
    );
  });

  test("an empty env counts as unset, it would match every index on the instance", () => {
    expect(resolveMeilisearchIndexPrefix(undefined, { [MEILI_INDEX_PREFIX_ENV]: "" })).toBe(
      "kumiko_",
    );
  });
});
