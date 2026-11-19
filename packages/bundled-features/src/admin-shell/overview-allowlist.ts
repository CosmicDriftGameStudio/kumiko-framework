// The queries each overview-home panel set is expected to call, checked by the
// admin-shell tests. Not enforced at runtime: the security boundary is each
// query's own access.roles.

import { CapOverviewQueries } from "../cap-overview/index.ts";
import { JobQueries } from "../jobs/index.ts";
import { METRICS_FEATURE, METRICS_SYSTEM_FEATURE } from "../metrics/index.ts";

export type OverviewWorkspaceKind = "tenant" | "platform";

/** Queries the tenant workspace overview panels call. */
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

/** Queries the platform workspace overview panels call. */
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
