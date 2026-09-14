// ctx.queryAsMember — reads a query handler as a stored tenant member. The
// resolved SessionUser never leaves this module.

import type { DbConnection, DbTx } from "../db/connection";
import { buildSessionRoles } from "../engine/membership-roles";
import type { MemberReader, SessionUser } from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types";
import type { TenantId } from "../engine/types/identifiers";
import { AccessDeniedError, FrameworkReasons, InternalError } from "../errors";
import {
  type ActiveMembershipPolicy,
  resolveActiveMembershipFn,
  resolvePrincipalPlugin,
} from "./active-membership";
import { executeQuery } from "./dispatch-query";
import { type DispatchContext, resolveAuthClaimsFn, resolveDbSource } from "./dispatch-shared";
import { isSystemIdentity } from "./system-identity-switch";

// Stricter than interactive sign-in: an unknown principal or a tenant
// mid-teardown must not resolve — there is no user-facing flow to recover.
export const BACKGROUND_READ_POLICY: ActiveMembershipPolicy = {
  allowPendingDestruction: false,
  allowUnknownPrincipal: false,
};

// Generic on purpose — details never carry which check failed, so a caller
// can't probe another user's membership state via the error shape.
function memberResolutionDenied(): AccessDeniedError {
  return new AccessDeniedError({
    message: "not permitted to read as this member",
    details: { reason: FrameworkReasons.memberResolutionDenied },
  });
}

// Membership/principal/lifecycle resolve on the root connection, outside the
// caller's tx — only the target query runs inside it (via the `tx` argument).
async function resolveMember(
  ctx: DispatchContext,
  tenantId: TenantId,
  userId: string,
): Promise<SessionUser> {
  const membership = await resolveActiveMembershipFn(ctx, userId, tenantId, BACKGROUND_READ_POLICY);
  if (membership.kind === "rejected") throw memberResolutionDenied();

  const principalPlugin = resolvePrincipalPlugin(ctx.registry);
  const dbSource = resolveDbSource(ctx, undefined);
  if (!dbSource) {
    throw new InternalError({
      message: "ctx.queryAsMember requires a database connection — none is configured.",
    });
  }
  // resolveDbSource(ctx, undefined) never returns a tx, only AppContext.db.
  const db = dbSource as DbConnection; // @cast-boundary db-operator

  const profile = await principalPlugin.resolveProfile(userId, { db });
  if (!profile) throw memberResolutionDenied();

  const roles = buildSessionRoles(profile.globalRoles, membership.membership.roles);
  const base: SessionUser = {
    id: userId,
    tenantId,
    roles,
    ...(profile.timezone !== undefined && { timezone: profile.timezone }),
    ...(profile.locale !== undefined && { locale: profile.locale }),
    origin: "member-resolution",
  };
  // Defense in depth: buildSessionRoles strips forbidden roles only from the
  // membership half, not globalRoles — a resolved principal must never be SYSTEM.
  if (isSystemIdentity(base)) throw memberResolutionDenied();

  const claims = await resolveAuthClaimsFn(ctx, base);
  return Object.keys(claims).length > 0 ? { ...base, claims } : base;
}

// One reader per handler invocation (shared with its hooks) or job run; a
// nested dispatch builds its own reader with its own cache.
export function createMemberReaderFn(
  ctx: DispatchContext,
  tenantId: TenantId,
  tx?: DbTx,
): MemberReader {
  if (tenantId === SYSTEM_TENANT_ID) {
    throw new InternalError({
      message: "queryAsMember needs a tenant-scoped context — got SYSTEM_TENANT_ID.",
    });
  }

  // Only successful resolutions are cached — a rejected/failed resolution
  // deletes its own entry so a transient error can't poison the rest of the run.
  const cache = new Map<string, Promise<SessionUser>>();

  function resolve(userId: string): Promise<SessionUser> {
    const cached = cache.get(userId);
    if (cached) return cached;
    const pending = resolveMember(ctx, tenantId, userId);
    cache.set(userId, pending);
    pending.catch(() => {
      cache.delete(userId);
    });
    return pending;
  }

  return async (userId, qn, payload) => {
    const user = await resolve(userId);
    return executeQuery(ctx, qn, payload, user, tx);
  };
}
