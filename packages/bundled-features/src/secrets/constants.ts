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

// Error i18n keys of the secrets write path. Shared by the write gate, the
// bundled translations and callers that need to recognise a specific failure.
export const SECRETS_ERROR_KEYS = {
  unknownKey: "secrets.errors.unknownKey",
  writeDenied: "secrets.errors.writeDenied",
  invalidValue: "secrets.errors.invalidValue",
} as const;

export const INVALID_SECRET_VALUE_CODE = "invalid_secret_value" as const;
