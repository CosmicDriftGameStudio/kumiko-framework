import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildSampleIndex,
  extractReadmeSummary,
  INDEX_PATH,
  serializeSampleIndex,
} from "../../scripts/gen-sample-index";

describe("sample-index", () => {
  test("committed sample-index.json is up to date", () => {
    const fresh = serializeSampleIndex(buildSampleIndex());
    const committed = readFileSync(INDEX_PATH, "utf-8");
    expect(committed).toBe(fresh);
  });

  test("pilot overrides are present for docgen", () => {
    const index = buildSampleIndex();
    const delivery = index.features["delivery"];
    expect(delivery?.primarySample).toBe("recipes-delivery-notifications");
    expect(delivery?.whenToUse).toContain("notify");
    expect(delivery?.screenshot).toBeNull();
    expect(delivery?.readmeSummary).toBeDefined();

    const config = index.features["config"];
    expect(config?.primarySample).toBe("recipes-encrypted-tenant-config");
    expect(config?.hasVisualOutput).toBe(true);
  });

  test("extractReadmeSummary reads delivery-notifications intro", () => {
    const summary = extractReadmeSummary(
      `${import.meta.dir}/../../../../recipes/delivery-notifications/README.md`,
    );
    expect(summary).toContain("notifications");
  });
});
