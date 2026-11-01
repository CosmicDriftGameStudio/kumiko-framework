import { describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { validateScopeEventContracts } from "../scope-events-check.ts";

describe("personal-access-tokens boot rules", () => {
  test("a scope event without a public contract violates scope-event-without-contract", () => {
    const app = defineFeature("pat-rule-app", () => {});
    const error = bootRuleViolationOf(() =>
      validateScopeEventContracts(
        { support: { label: "Support", read: [], events: ["ghost.created"] } },
        [app],
      ),
    );
    expect(error.rule.id).toBe("personal-access-tokens/scope-event-without-contract");
    expect(error.message).toContain('lists event "ghost.created" without a public contract');
  });
});
