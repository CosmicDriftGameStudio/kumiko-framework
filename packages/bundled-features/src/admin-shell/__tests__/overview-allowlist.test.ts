import { describe, expect, test } from "bun:test";
import { JobQueries } from "../../jobs/constants";
import { TenantQueries } from "../../tenant/constants";
import { UserQueries } from "../../user/constants";
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

  test("platform allowlist is tenant:list + jobs:list + user:list", () => {
    expect(PLATFORM_OVERVIEW_ALLOWED_QUERIES).toEqual([
      TenantQueries.list,
      JobQueries.list,
      UserQueries.list,
    ]);
  });

  test("platform overview allows the user-count query (fw#891 regression)", () => {
    expect(isOverviewQueryAllowed("platform", UserQueries.list)).toBe(true);
  });

  test("platform queries are not tenant-allowlisted", () => {
    expect(isOverviewQueryAllowed("tenant", TenantQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", JobQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", UserQueries.list)).toBe(false);
  });
});
