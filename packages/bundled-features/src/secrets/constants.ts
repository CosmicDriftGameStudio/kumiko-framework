// @runtime client
// secrets bundle constants — default RBAC for set/delete/list (#2296).

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

// Default-RBAC of the set/delete/list handlers, hard-wired to ["TenantAdmin"]
// before #2296. Apps with their own role vocabulary override via
// createSecretsFeature({ roles }) or createSecretsFeature({ access }) — the
// rotate job stays untouched, it's a manual/ops path across all tenants by
// design, not a per-tenant RBAC surface.
export const DEFAULT_SECRETS_ROLES = ["TenantAdmin"] as const;
export const DEFAULT_SECRETS_ACCESS: AccessRule = { roles: DEFAULT_SECRETS_ROLES };
