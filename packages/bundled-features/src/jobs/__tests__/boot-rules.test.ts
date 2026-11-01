import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createJobsFeature } from "../feature.ts";

describe("jobs boot rules", () => {
  test("anonymous in readRoles violates anonymous-read-role", () => {
    const error = bootRuleViolationOf(() => createJobsFeature({ readRoles: ["anonymous"] }));
    expect(error.rule.id).toBe("jobs/anonymous-read-role");
    expect(error.message).toContain('readRoles must not contain "anonymous"');
  });
});
