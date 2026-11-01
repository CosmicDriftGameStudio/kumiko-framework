import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createCapOverviewFeature } from "../feature.ts";
import type { CapSpec } from "../types.ts";

const cap: CapSpec = { id: "widgets", label: "cap.widgets", limit: () => 5, usage: async () => 0 };

describe("cap-overview boot rules", () => {
  test("no caps violates empty-caps", () => {
    const error = bootRuleViolationOf(() => createCapOverviewFeature({ caps: [] }));
    expect(error.rule.id).toBe("cap-overview/empty-caps");
    expect(error.message).toContain("`caps` must not be empty");
  });

  test("an unknown listCaps id violates unknown-list-cap", () => {
    const error = bootRuleViolationOf(() =>
      createCapOverviewFeature({ caps: [cap], listCaps: ["ghost"] }),
    );
    expect(error.rule.id).toBe("cap-overview/unknown-list-cap");
    expect(error.message).toContain('listCaps references unknown cap id "ghost"');
  });
});
