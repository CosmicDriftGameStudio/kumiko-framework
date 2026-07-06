// @runtime client
// Hard-coded query allowlists for overview-home screens — security boundary
// against privilege escalation via accidental cross-workspace fetches.

export type OverviewWorkspaceKind = "tenant" | "platform";

/** Tenant workspace overview may only call these queries. */
export const TENANT_OVERVIEW_ALLOWED_QUERIES = [
  "tenant:query:invitations",
  "tenant:query:members",
  "config:query:readiness",
  "cap-counter:query:get-counter",
] as const;

/** Platform workspace overview may only call these queries. */
export const PLATFORM_OVERVIEW_ALLOWED_QUERIES = [
  "tenant:query:list",
  "jobs:query:list",
] as const;

/** Regression guard — TenantAdmin overview must never touch these (HTTP 403). */
export const TENANT_OVERVIEW_FORBIDDEN_QUERIES = [
  "tenant:query:list",
  "jobs:query:list",
  "feature-toggles:query:list",
  "feature-toggles:query:registered",
] as const;

export function overviewAllowedQueries(kind: OverviewWorkspaceKind): readonly string[] {
  return kind === "tenant" ? TENANT_OVERVIEW_ALLOWED_QUERIES : PLATFORM_OVERVIEW_ALLOWED_QUERIES;
}

export function isOverviewQueryAllowed(kind: OverviewWorkspaceKind, queryName: string): boolean {
  return overviewAllowedQueries(kind).includes(queryName);
}
