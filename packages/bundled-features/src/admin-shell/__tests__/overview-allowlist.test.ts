import { describe, expect, test } from "bun:test";
import { JobQueries } from "../../jobs/constants";
import { TenantQueries } from "../../tenant/constants";
import {
  isOverviewQueryAllowed,
  PLATFORM_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "../overview-allowlist";

describe("overview query allowlist", () => {
  test("tenant allowlist excludes platform-only queries", () => {
    for (const forbidden of TENANT_OVERVIEW_FORBIDDEN_QUERIES) {
      expect(isOverviewQueryAllowed("tenant", forbidden)).toBe(false);
      expect(TENANT_OVERVIEW_ALLOWED_QUERIES).not.toContain(forbidden);
    }
  });

  test("tenant allowlist includes members, invitations, readiness", () => {
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toContain(TenantQueries.members);
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toContain(TenantQueries.invitations);
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toContain("config:query:readiness");
  });

  test("platform allowlist is tenant:list + jobs:list only", () => {
    expect(PLATFORM_OVERVIEW_ALLOWED_QUERIES).toEqual([TenantQueries.list, JobQueries.list]);
  });

  test("platform queries are not tenant-allowlisted", () => {
    expect(isOverviewQueryAllowed("tenant", TenantQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", JobQueries.list)).toBe(false);
  });
});
