import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { TenantErrors } from "./constants.js";
import { findForbiddenMembershipRole, reservedMembershipRoleError } from "./membership-roles.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "./membership-table.js";
import { seedTenantMembership } from "./seeding.js";

const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  { entityName: "tenant-membership" },
);

export type InvitedMembershipOptions = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly role: string;
  readonly invitation: InvitationIssuance;
};

export type InvitationIssuance = {
  readonly membershipVersion: number | null;
  readonly insertedAt: Temporal.Instant;
  readonly modifiedAt: Temporal.Instant | null;
};

type MembershipRow = {
  readonly id: string;
  readonly version: number;
  readonly roles: string;
  readonly insertedAt: Temporal.Instant;
  readonly modifiedAt: Temporal.Instant | null;
};

const MEMBERSHIP_CREATED_VERSION = 1;

// 0 = the user has no membership in the tenant yet.
export async function membershipVersionOf(
  db: Pick<TenantDb, "fetchOne">,
  tenantId: string,
  userId: string,
): Promise<number> {
  const membership = await db.fetchOne<{ readonly version: number }>(tenantMembershipsTable, {
    tenantId,
    userId,
  });
  return membership?.version ?? 0;
}

// Add-only, so unlike updateMemberRoles no session revoke or last-TenantAdmin check.
// Read unfiltered: tenant:query:memberships hides disabled tenants.
export async function grantInvitedMembershipRole(db: DbRunner, options: InvitedMembershipOptions) {
  const forbiddenRole = findForbiddenMembershipRole([options.role]);
  if (forbiddenRole !== undefined) return writeFailure(reservedMembershipRoleError(forbiddenRole));

  const existing = await fetchOne<MembershipRow>(db, tenantMembershipsTable, {
    userId: options.userId,
    tenantId: options.tenantId,
  });
  if (!existing) {
    await seedTenantMembership(db, {
      userId: options.userId,
      tenantId: options.tenantId,
      roles: [options.role],
    });
    return grantedMembership(false, [options.role]);
  }

  // A membership decision made after the invitation was issued wins over it.
  if (isSupersededByMembership(existing, options.invitation)) {
    return writeFailure(invitationSupersededError());
  }

  const currentRoles = parseRoles(existing.roles);
  if (currentRoles.includes(options.role)) return grantedMembership(true, currentRoles);

  const roles = [...currentRoles, options.role];
  const updateResult = await membershipExecutor.update(
    { id: existing.id, version: existing.version, changes: { roles: JSON.stringify(roles) } },
    createSystemUser(options.tenantId),
    createTenantDb(db, options.tenantId, "system"),
  );
  if (!updateResult.isSuccess) return updateResult;
  return grantedMembership(true, roles);
}

// The pinned version is the membership's version when the invitation was issued
// (0 = none yet). A different version now means the membership was decided after
// the invite. Pin 0: a membership that appeared afterwards is an additive grant
// only while it is untouched since its creation (version 1). A role change bumps
// the version above 1 and counts as a decision. A removal in between hard-deletes
// the row and cancels the invitation (remove-member), so it never reaches this check.
// Rows issued before the pin existed (null) fall back to wall-clock timestamps,
// which can misjudge changes within the same millisecond but is all they carry.
function isSupersededByMembership(
  membership: MembershipRow,
  invitation: InvitationIssuance,
): boolean {
  if (invitation.membershipVersion !== null) {
    if (invitation.membershipVersion === 0) {
      return membership.version > MEMBERSHIP_CREATED_VERSION;
    }
    return membership.version !== invitation.membershipVersion;
  }
  // Resend reuses the invitation row, so its last modification is the latest issuance.
  const issuedAt = invitation.modifiedAt ?? invitation.insertedAt;
  const lastChangedAt = membership.modifiedAt ?? membership.insertedAt;
  return Temporal.Instant.compare(lastChangedAt, issuedAt) > 0;
}

function invitationSupersededError(): ConflictError {
  return new ConflictError({
    message: "the membership changed after this invitation was issued",
    i18nKey: "tenant.errors.invitationSuperseded",
    details: { reason: TenantErrors.invitationSuperseded },
  });
}

function grantedMembership(alreadyMember: boolean, roles: readonly string[]) {
  return { isSuccess: true, data: { alreadyMember, roles } } as const;
}
