// One framework-owned composition of membership / principal-status /
// tenant-lifecycle checks so login, switch-tenant and MFA completion can't independently drift.

import type { DbConnection } from "../db/connection";
import {
  isPrincipalStatusPlugin,
  isTenantLifecycleStatusPlugin,
  type PrincipalStatusPlugin,
  TENANT_TEARDOWN_STATUSES,
  type TenantLifecycleStatusPlugin,
} from "../engine/active-membership";
import { EXT_PRINCIPAL_STATUS, EXT_TENANT_LIFECYCLE_STATUS } from "../engine/extension-names";
import { createSystemUser } from "../engine/system-user";
import type { ActiveMembershipResult, Registry } from "../engine/types";
import type { TenantId } from "../engine/types/identifiers";
import { InternalError } from "../errors";
import { executeQuery } from "./dispatch-query";
import { type DispatchContext, resolveDbSource } from "./dispatch-shared";

export type ActiveMembershipPolicy = {
  // destroyRequested still counts as active — owners must be able to cancel
  // destruction; auth-middleware's own 410 gate then only admits that write.
  readonly allowPendingDestruction: boolean;
  // Whether a userId with no persisted principal row counts as active — a
  // future background caller may instead want to fail closed.
  readonly allowUnknownPrincipal: boolean;
};

export const INTERACTIVE_SIGN_IN_POLICY: ActiveMembershipPolicy = {
  allowPendingDestruction: true,
  allowUnknownPrincipal: true,
};

type RawMembershipRow = {
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly tenantName?: string;
  readonly tenantKey?: string;
};

// membershipQuery is a per-app-registered handler — engine-payload, not
// trusted shape. Structural validation instead of a blind cast.
function isMembershipRow(v: unknown): v is RawMembershipRow {
  if (typeof v !== "object" || v === null) return false;
  if (!("tenantId" in v) || typeof v.tenantId !== "string") return false;
  if (!("roles" in v) || !Array.isArray(v.roles) || !v.roles.every((r) => typeof r === "string")) {
    return false;
  }
  if ("tenantName" in v && v.tenantName !== undefined && typeof v.tenantName !== "string") {
    return false;
  }
  if ("tenantKey" in v && v.tenantKey !== undefined && typeof v.tenantKey !== "string") {
    return false;
  }
  return true;
}

async function findMembership(
  ctx: DispatchContext,
  userId: string,
  tenantId: TenantId,
): Promise<RawMembershipRow | undefined> {
  const rawMemberships = await executeQuery(
    ctx,
    ctx.membershipQuery,
    { userId },
    createSystemUser(tenantId),
  );
  if (!Array.isArray(rawMemberships) || !rawMemberships.every(isMembershipRow)) {
    throw new InternalError({
      message:
        `dispatcher.resolveActiveMembership: membershipQuery "${ctx.membershipQuery}" returned ` +
        "a malformed result — expected an array of {tenantId, roles, tenantName?, tenantKey?} rows.",
    });
  }
  return rawMemberships.find((m) => m.tenantId === tenantId);
}

// Exported so member-reader.ts (ctx.queryAsMember) can reach the registered
// PrincipalStatusPlugin's resolveProfile without duplicating this lookup.
export function resolvePrincipalPlugin(registry: Registry): PrincipalStatusPlugin {
  const usages = registry.getExtensionUsages(EXT_PRINCIPAL_STATUS);
  if (usages.length !== 1) {
    throw new InternalError({
      message:
        usages.length === 0
          ? `dispatcher.resolveActiveMembership: no "${EXT_PRINCIPAL_STATUS}" provider registered — mount the user feature.`
          : `dispatcher.resolveActiveMembership: multiple "${EXT_PRINCIPAL_STATUS}" providers registered — exactly one is expected.`,
    });
  }
  const usage = usages[0];
  if (!usage || !isPrincipalStatusPlugin(usage.options)) {
    throw new InternalError({
      message: `dispatcher.resolveActiveMembership: "${usage?.entityName}" registered under "${EXT_PRINCIPAL_STATUS}" without a resolveStatus(userId, {db}) — extension options must be a PrincipalStatusPlugin.`,
    });
  }
  return usage.options;
}

function resolveLifecyclePlugin(registry: Registry): TenantLifecycleStatusPlugin | undefined {
  const usages = registry.getExtensionUsages(EXT_TENANT_LIFECYCLE_STATUS);
  if (usages.length > 1) {
    throw new InternalError({
      message: `dispatcher.resolveActiveMembership: multiple "${EXT_TENANT_LIFECYCLE_STATUS}" providers registered — exactly one (or zero) is expected.`,
    });
  }
  const usage = usages[0];
  if (!usage) return undefined;
  if (!isTenantLifecycleStatusPlugin(usage.options)) {
    throw new InternalError({
      message: `dispatcher.resolveActiveMembership: "${usage.entityName}" registered under "${EXT_TENANT_LIFECYCLE_STATUS}" without a resolveStatus(tenantId, {db}) — extension options must be a TenantLifecycleStatusPlugin.`,
    });
  }
  return usage.options;
}

function isTeardownRejected(
  status: { readonly status: string } | null,
  policy: ActiveMembershipPolicy,
): boolean {
  return (
    status !== null &&
    TENANT_TEARDOWN_STATUSES.has(status.status) &&
    !(status.status === "destroyRequested" && policy.allowPendingDestruction)
  );
}

// Order is load-bearing: a non-member must never learn a foreign tenant's
// lifecycle/blocked state, so membership is resolved and checked FIRST.
export async function resolveActiveMembershipFn(
  ctx: DispatchContext,
  userId: string,
  tenantId: TenantId,
  policy: ActiveMembershipPolicy,
): Promise<ActiveMembershipResult> {
  const { registry } = ctx;

  const membership = await findMembership(ctx, userId, tenantId);
  if (!membership) {
    return { kind: "rejected", reason: "not_a_member" };
  }

  const principalPlugin = resolvePrincipalPlugin(registry);
  const dbSource = resolveDbSource(ctx, undefined);
  if (!dbSource) {
    throw new InternalError({
      message:
        "dispatcher.resolveActiveMembership requires a database connection — none is configured.",
    });
  }
  // resolveDbSource(ctx, undefined) never returns a tx, only AppContext.db —
  // the dispatcher boundary holds that as the root DbConnection, same as buildAuthClaimsContext.
  const db = dbSource as DbConnection; // @cast-boundary db-operator

  const principalStatus = await principalPlugin.resolveStatus(userId, { db });
  if (
    principalStatus === "blocked" ||
    (principalStatus === "unknown" && !policy.allowUnknownPrincipal)
  ) {
    return { kind: "rejected", reason: "principal_blocked" };
  }

  const lifecyclePlugin = resolveLifecyclePlugin(registry);
  if (lifecyclePlugin) {
    const lifecycle = await lifecyclePlugin.resolveStatus(tenantId, { db });
    if (isTeardownRejected(lifecycle, policy)) {
      return { kind: "rejected", reason: "tenant_teardown" };
    }
  }

  return {
    kind: "active",
    membership: {
      tenantId,
      roles: membership.roles,
      ...(membership.tenantName !== undefined ? { tenantName: membership.tenantName } : {}),
      ...(membership.tenantKey !== undefined ? { tenantKey: membership.tenantKey } : {}),
    },
  };
}
