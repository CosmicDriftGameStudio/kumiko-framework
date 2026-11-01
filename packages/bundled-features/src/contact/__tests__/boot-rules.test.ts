import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createContactFeature } from "../feature.ts";

describe("contact boot rules", () => {
  test("proofOfWorkBits outside the range violates invalid-proof-of-work-bits", () => {
    const error = bootRuleViolationOf(() =>
      createContactFeature({ appName: "Test", spamProtection: { proofOfWorkBits: 1000 } }),
    );
    expect(error.rule.id).toBe("contact/invalid-proof-of-work-bits");
    expect(error.message).toContain("spamProtection.proofOfWorkBits must be an integer between");
  });
});
