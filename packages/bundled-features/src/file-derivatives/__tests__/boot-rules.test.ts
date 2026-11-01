import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createFileDerivativesFeature } from "../feature.ts";

describe("file-derivatives boot rules", () => {
  test("publicTenantResolution without resolveApexTenant violates public-tenant-resolution-without-apex-resolver", () => {
    const error = bootRuleViolationOf(() =>
      createFileDerivativesFeature({ publicTenantResolution: "host" }),
    );
    expect(error.rule.id).toBe("file-derivatives/public-tenant-resolution-without-apex-resolver");
    expect(error.message).toContain("publicTenantResolution requires resolveApexTenant");
  });
});
