import { describe, expect, test } from "bun:test";
import { isTenantServingPublicContent } from "../is-tenant-serving-public-content";
import { TENANT_LIFECYCLE_STATUSES, type TenantLifecycleStatus } from "../schema/tenant";

describe("isTenantServingPublicContent", () => {
  test("true only for an enabled, active tenant", () => {
    expect(isTenantServingPublicContent({ isEnabled: true, status: "active" })).toBe(true);
  });

  test("false when disabled, even if active", () => {
    expect(isTenantServingPublicContent({ isEnabled: false, status: "active" })).toBe(false);
  });

  test.each(
    TENANT_LIFECYCLE_STATUSES.filter(
      (status): status is Exclude<TenantLifecycleStatus, "active"> => status !== "active",
    ),
  )("false for enabled tenant with status '%s'", (status) => {
    expect(isTenantServingPublicContent({ isEnabled: true, status })).toBe(false);
  });
});
