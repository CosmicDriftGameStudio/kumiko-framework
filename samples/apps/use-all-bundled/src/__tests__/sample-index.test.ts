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
    expect(delivery?.sampleBlurb).toContain("r.notification");
    expect(delivery?.screenshot).toBeNull();
    expect(delivery?.readmeSummary).toBeDefined();

    const config = index.features["config"];
    expect(config?.primarySample).toBe("recipes-encrypted-tenant-config");
    expect(config?.hasVisualOutput).toBe(true);
  });

  test("every override entry has sampleBlurb", () => {
    const overrides = JSON.parse(
      readFileSync(`${import.meta.dir}/../../../../sample-index.overrides.json`, "utf-8"),
    ) as Record<string, { sampleBlurb: string }>;
    const index = buildSampleIndex();
    for (const [name, row] of Object.entries(overrides)) {
      expect(row.sampleBlurb.length).toBeGreaterThan(20);
      expect(index.features[name]?.sampleBlurb).toBe(row.sampleBlurb);
    }
  });

  test("extractReadmeSummary reads delivery-notifications intro", () => {
    const summary = extractReadmeSummary(
      `${import.meta.dir}/../../../../recipes/delivery-notifications/README.md`,
    );
    expect(summary).toContain("notifications");
  });

  test("extractReadmeSummary accumulates a multi-line first bullet instead of truncating at the first physical line", () => {
    // Regression (636/1): the section-branch used to `return` on the first
    // line it saw — a summary bullet that wrapped onto a second physical
    // line in the source README (common markdown formatting) got cut off
    // mid-sentence.
    const summary = extractReadmeSummary(
      `${import.meta.dir}/../../../../recipes/tags-basic/README.md`,
    );
    expect(summary).toContain("Zero host changes");
    expect(summary).toContain("tag awareness");
    expect(summary).toContain("own tables");
  });
});
