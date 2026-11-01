import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createLegalPagesFeature } from "../feature.ts";

describe("legal-pages boot rules", () => {
  test("a route without a leading slash violates invalid-route", () => {
    const error = bootRuleViolationOf(() =>
      createLegalPagesFeature({
        routes: [{ path: "x", slug: "imprint", lang: "de", titleFallback: "T" }],
        requiredBlocks: [],
      }),
    );
    expect(error.rule.id).toBe("legal-pages/invalid-route");
    expect(error.message).toContain('route path must start with "/"');
  });

  test("a repeated route path violates duplicate-route-path", () => {
    const error = bootRuleViolationOf(() =>
      createLegalPagesFeature({
        routes: [
          { path: "/x", slug: "imprint", lang: "de", titleFallback: "T" },
          { path: "/x", slug: "privacy", lang: "de", titleFallback: "T" },
        ],
        requiredBlocks: [],
      }),
    );
    expect(error.rule.id).toBe("legal-pages/duplicate-route-path");
    expect(error.message).toContain('duplicate route path "/x"');
  });

  test("custom routes without requiredBlocks violate routes-without-required-blocks", () => {
    const error = bootRuleViolationOf(() =>
      createLegalPagesFeature({
        routes: [{ path: "/x", slug: "other", lang: "de", titleFallback: "T" }],
      }),
    );
    expect(error.rule.id).toBe("legal-pages/routes-without-required-blocks");
    expect(error.message).toContain("custom `routes` without `requiredBlocks`");
  });
});
