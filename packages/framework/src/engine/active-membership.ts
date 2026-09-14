// principalStatus / tenantLifecycleStatus contracts consumed by
// pipeline/active-membership.ts. Kept in engine/ (extension-registry surface), same split as tier-resolver-extension.ts.

import type { DbConnection } from "../db/connection";
import type { TenantId } from "./types/identifiers";

// "unknown" = no persisted principal row for this userId — the caller
// (INTERACTIVE_SIGN_IN_POLICY.allowUnknownPrincipal) decides whether that
// counts as active or blocked; a background resolver for a stored userId
// with a since-deleted row should not silently treat it as active.
export type PrincipalStatus = "active" | "blocked" | "unknown";

// Global-roles/timezone/locale snapshot ctx.queryAsMember needs to mint a
// resolved principal's SessionUser, without exposing its own table.
export type PrincipalProfile = {
  readonly globalRoles: readonly string[];
  readonly timezone?: string;
  readonly locale?: string;
};

// Registered via r.useExtension(EXT_PRINCIPAL_STATUS, "user", principalStatusPlugin).
export type PrincipalStatusPlugin = {
  readonly resolveStatus: (
    userId: string,
    deps: { readonly db: DbConnection },
  ) => Promise<PrincipalStatus>;
  // Required so a missing provider fails closed (InternalError) instead of
  // silently minting empty global roles for ctx.queryAsMember.
  readonly resolveProfile: (
    userId: string,
    deps: { readonly db: DbConnection },
  ) => Promise<PrincipalProfile | null>;
};

// `null` means the tenant has no lifecycle row (never entered teardown).
export type TenantLifecycleStatusPlugin = {
  readonly resolveStatus: (
    tenantId: TenantId,
    deps: { readonly db: DbConnection },
  ) => Promise<{ readonly status: string } | null>;
};

// extension-usage `options` is engine-payload (unknown) — structurally
// validate instead of casting blind, same pattern as isFileProviderPlugin.
function hasResolveStatusFn(v: unknown): v is { readonly resolveStatus: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    "resolveStatus" in v &&
    typeof v.resolveStatus === "function"
  );
}

export function isPrincipalStatusPlugin(v: unknown): v is PrincipalStatusPlugin {
  return (
    hasResolveStatusFn(v) &&
    "resolveProfile" in v &&
    typeof (v as { readonly resolveProfile: unknown }).resolveProfile === "function"
  );
}

export function isTenantLifecycleStatusPlugin(v: unknown): v is TenantLifecycleStatusPlugin {
  return hasResolveStatusFn(v);
}

// Same values auth-middleware.ts used to keep as its own private
// TENANT_LIFECYCLE_BLOCKED set — moved here so the framework's active-
// membership check and the request-level 410 gate can't drift apart.
export const TENANT_TEARDOWN_STATUSES: ReadonlySet<string> = new Set([
  "destroyRequested",
  "destroying",
  "destroyFailed",
  "destroyed",
]);
