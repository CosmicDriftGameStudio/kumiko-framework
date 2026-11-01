import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createDocumentsFeature } from "../feature.ts";

describe("documents boot rules", () => {
  test("a negative expiringWithinDays violates negative-expiring-within-days", () => {
    const error = bootRuleViolationOf(() =>
      createDocumentsFeature({
        categories: ["contract"],
        linkTargets: ["tenant"],
        expiringWithinDays: -1,
      }),
    );
    expect(error.rule.id).toBe("documents/negative-expiring-within-days");
    expect(error.message).toContain("expiringWithinDays }) must not be negative");
  });

  test("a label for an unlisted category violates category-label-unknown-category", () => {
    const error = bootRuleViolationOf(() =>
      createDocumentsFeature({
        categories: ["contract"],
        linkTargets: ["tenant"],
        categoryLabels: { ghost: { de: "G", en: "G" } },
      }),
    );
    expect(error.rule.id).toBe("documents/category-label-unknown-category");
    expect(error.message).toContain('names "ghost", which is not in categories');
  });
});
