import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { MIN_HMAC_SECRET_LENGTH } from "../web/constants.ts";

describe("auth-email-password boot rules", () => {
  test("a short hmacSecret violates hmac-secret-too-short", () => {
    const error = bootRuleViolationOf(() =>
      createAuthEmailPasswordFeature({
        accountUnlock: {
          hmacSecret: "x".repeat(MIN_HMAC_SECRET_LENGTH - 1),
          appUrl: "https://app.example.com/flow",
        },
      }),
    );
    expect(error.rule.id).toBe("auth-email-password/hmac-secret-too-short");
    expect(error.message).toContain("accountUnlock.hmacSecret must be");
  });
});
