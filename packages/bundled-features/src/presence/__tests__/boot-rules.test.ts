import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createPresenceFeature } from "../feature.ts";

describe("presence boot rules", () => {
  test("a non-positive ttlSeconds violates invalid-ttl-seconds", () => {
    const error = bootRuleViolationOf(() => createPresenceFeature({ ttlSeconds: 0 }));
    expect(error.rule.id).toBe("presence/invalid-ttl-seconds");
    expect(error.message).toContain("ttlSeconds must be a positive number");
  });
});
