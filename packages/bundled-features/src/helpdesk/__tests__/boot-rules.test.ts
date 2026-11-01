import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createHelpdeskFeature } from "../feature.ts";

describe("helpdesk boot rules", () => {
  test("proofOfWorkBits outside the range violates invalid-proof-of-work-bits", () => {
    const error = bootRuleViolationOf(() =>
      createHelpdeskFeature({ appName: "Test", spamProtection: { proofOfWorkBits: 1000 } }),
    );
    expect(error.rule.id).toBe("helpdesk/invalid-proof-of-work-bits");
    expect(error.message).toContain("spamProtection.proofOfWorkBits must be an integer between");
  });
});
