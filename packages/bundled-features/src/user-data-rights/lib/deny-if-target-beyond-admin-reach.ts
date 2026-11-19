import {
  findForbiddenRoleAssignment,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import type { CrossTenantReads } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { userTable } from "../../user/index.ts";
import { isAdminActor, isSystemAdminActor } from "./is-admin-actor.ts";

export const TARGET_USER_NOT_IN_ADMIN_TENANT = "target_user_not_in_admin_tenant" as const;
export const TARGET_USER_IN_OTHER_TENANTS = "target_user_in_other_tenants" as const;
export const TARGET_USER_OUTRANKS_ACTOR = "target_user_outranks_actor" as const;

type MembershipRow = { readonly tenantId: string; readonly roles: unknown };

export type AdminReach =
  | { readonly kind: "within-reach" }
  | {
      readonly kind: "beyond-reach";
      readonly denial: WriteFailure;
      // No membership in any tenant: not a real user, e.g. a share-token recipient.
      readonly hasNoMembership: boolean;
    };

const WITHIN_REACH: AdminReach = { kind: "within-reach" };

function beyondReach(reason: string, hasNoMembership = false): AdminReach {
  return {
    kind: "beyond-reach",
    denial: writeFailure(new AccessDeniedError({ details: { reason } })),
    hasNoMembership,
  };
}

/**
 * The user row, its sessions and its KMS key are global, so a tenant-scoped admin may only act
 * on a target who is a member of the admin's tenant alone and does not outrank the admin.
 * SystemAdmin skips. Without the user feature there is no user row, so the global-role checks
 * are skipped and only the membership-derived checks apply.
 */
export async function resolveAdminReachOverUser(
  reads: CrossTenantReads,
  actor: SessionUser,
  targetUserId: string,
  userFeatureMounted: boolean,
): Promise<AdminReach> {
  if (isSystemAdminActor(actor)) return WITHIN_REACH;

  const [memberships, userRow] = await Promise.all([
    reads.selectMany<MembershipRow>(tenantMembershipsTable, { userId: targetUserId }),
    userFeatureMounted
      ? reads.fetchOne<{ roles: unknown }>(userTable, { id: targetUserId })
      : undefined,
  ]);
  if (memberships.length === 0) return beyondReach(TARGET_USER_NOT_IN_ADMIN_TENANT, true);

  const actorMembership = memberships.find((m) => m.tenantId === actor.tenantId);
  if (!actorMembership) return beyondReach(TARGET_USER_NOT_IN_ADMIN_TENANT);
  if (memberships.length > 1) return beyondReach(TARGET_USER_IN_OTHER_TENANTS);

  // SystemAdmin is a global role on the user row, invisible to the membership checks above.
  const globalRoles = userRow ? parseRoles(userRow.roles) : [];
  if (isSystemAdminActor({ roles: globalRoles })) return beyondReach(TARGET_USER_OUTRANKS_ACTOR);

  // A DPO has no rank (rank -1 would make every member outrank it); only platform roles are off limits.
  if (!isAdminActor(actor)) return WITHIN_REACH;

  const outrankingRole = findForbiddenRoleAssignment(
    actor.roles,
    [],
    [...globalRoles, ...parseRoles(actorMembership.roles)],
  );
  if (outrankingRole !== undefined) return beyondReach(TARGET_USER_OUTRANKS_ACTOR);

  return WITHIN_REACH;
}

export async function denyIfTargetBeyondAdminReach(
  reads: CrossTenantReads,
  actor: SessionUser,
  targetUserId: string,
  userFeatureMounted: boolean,
): Promise<WriteFailure | undefined> {
  const reach = await resolveAdminReachOverUser(reads, actor, targetUserId, userFeatureMounted);
  return reach.kind === "beyond-reach" ? reach.denial : undefined;
}
