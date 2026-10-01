// Hard-coded query allowlists for overview-home screens — security boundary
// against privilege escalation via accidental cross-workspace fetches.

import { CapOverviewQueries } from "../cap-overview/index.js";
import { JobQueries } from "../jobs/index.js";
import { METRICS_FEATURE, METRICS_SYSTEM_FEATURE } from "../metrics/index.js";

export type OverviewWorkspaceKind = "tenant" | "platform";

/** Tenant workspace overview may only call these queries. */
export const TENANT_OVERVIEW_ALLOWED_QUERIES = [
  JobQueries.failures,
  CapOverviewQueries.capsUsage,
] as const;

// Metric ids come from the app's metric list, so the boundary is the feature
// prefix: tenant-scope metrics for the tenant overview, system-scope for the platform one.
const METRIC_QUERY_PREFIX: Readonly<Record<OverviewWorkspaceKind, string>> = {
  tenant: `${METRICS_FEATURE}:query:`,
  platform: `${METRICS_SYSTEM_FEATURE}:query:`,
};

/** Platform workspace overview may only call these queries. */
export const PLATFORM_OVERVIEW_ALLOWED_QUERIES = [
  JobQueries.list,
  CapOverviewQueries.tenantOptions,
] as const;

/** Regression guard — TenantAdmin overview must never touch these (HTTP 403). */
export const TENANT_OVERVIEW_FORBIDDEN_QUERIES = [
  "tenant:query:list",
  "jobs:query:list",
  "feature-toggles:query:list",
  "feature-toggles:query:registered",
  "user:query:user:list",
] as const;

export function overviewAllowedQueries(kind: OverviewWorkspaceKind): readonly string[] {
  return kind === "tenant" ? TENANT_OVERVIEW_ALLOWED_QUERIES : PLATFORM_OVERVIEW_ALLOWED_QUERIES;
}

export function isOverviewQueryAllowed(kind: OverviewWorkspaceKind, queryName: string): boolean {
  return (
    overviewAllowedQueries(kind).includes(queryName) ||
    queryName.startsWith(METRIC_QUERY_PREFIX[kind])
  );
}
