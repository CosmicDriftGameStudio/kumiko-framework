import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createMetricsFeature } from "../feature.ts";
import { defineMetric } from "../types.ts";
import { filesTable } from "./metrics-fixtures.ts";

const metric = defineMetric({
  id: "files-total",
  description: "Files",
  source: filesTable,
  measure: { fn: "count" },
  scopes: ["tenant"],
});

describe("metrics boot rules", () => {
  test("a repeated metric id violates duplicate-metric-id", () => {
    const error = bootRuleViolationOf(() => createMetricsFeature({ metrics: [metric, metric] }));
    expect(error.rule.id).toBe("metrics/duplicate-metric-id");
    expect(error.message).toContain('duplicate metric id "files-total"');
  });

  test("a non-kebab id violates invalid-metric", () => {
    const error = bootRuleViolationOf(() =>
      createMetricsFeature({ metrics: [{ ...metric, id: "FilesTotal" }] }),
    );
    expect(error.rule.id).toBe("metrics/invalid-metric");
    expect(error.message).toContain("has an id that is not kebab-case");
  });
});
