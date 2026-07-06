// @runtime client
// Hard-coded query allowlists for overview-home screens — security boundary
// against privilege escalation via accidental cross-workspace fetches.

import { CapCounterQueries } from "../cap-counter/constants";
import { ConfigQueries } from "../config/constants";
import { JobQueries } from "../jobs/constants";
import { TenantQueries } from "../tenant/constants";

export type OverviewWorkspaceKind = "tenant" | "platform";

/** Tenant workspace overview may only call these queries. */
export const TENANT_OVERVIEW_ALLOWED_QUERIES = [
  TenantQueries.invitations,
  TenantQueries.members,
  ConfigQueries.readiness,
  CapCounterQueries.getCounter,
] as const;

/** Platform workspace overview may only call these queries. */
export const PLATFORM_OVERVIEW_ALLOWED_QUERIES = [TenantQueries.list, JobQueries.list] as const;

/** Regression guard — TenantAdmin overview must never touch these (HTTP 403). */
export const TENANT_OVERVIEW_FORBIDDEN_QUERIES = [
  TenantQueries.list,
  JobQueries.list,
  "feature-toggles:query:list",
  "feature-toggles:query:registered",
] as const;

export function overviewAllowedQueries(kind: OverviewWorkspaceKind): readonly string[] {
  return kind === "tenant" ? TENANT_OVERVIEW_ALLOWED_QUERIES : PLATFORM_OVERVIEW_ALLOWED_QUERIES;
}

export function isOverviewQueryAllowed(kind: OverviewWorkspaceKind, queryName: string): boolean {
  return overviewAllowedQueries(kind).includes(queryName);
}
