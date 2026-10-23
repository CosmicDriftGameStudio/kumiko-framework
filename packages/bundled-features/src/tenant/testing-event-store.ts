import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  deleteRowViaEventStore,
  updateRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import { tenantInvitationEntity, tenantInvitationsTable } from "./invitation-table.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "./membership-table.ts";
import { tenantEntity, tenantTable } from "./schema/tenant.ts";

const membershipTarget = {
  table: tenantMembershipsTable,
  entity: tenantMembershipEntity,
  entityName: "tenant-membership",
} as const;

const tenantTarget = { table: tenantTable, entity: tenantEntity, entityName: "tenant" } as const;

type MembershipKey = { readonly userId: string; readonly tenantId: TenantId };

// The membership stream lives on the membership's own tenant, so actor and stream tenant both use it.
export function setMembershipRolesViaEventStore(
  db: DbConnection,
  params: MembershipKey & { readonly roles: readonly string[] },
): Promise<void> {
  const { userId, tenantId, roles } = params;
  return updateRowViaEventStore(
    db,
    membershipTarget,
    { userId, tenantId },
    { roles: JSON.stringify(roles) },
    { tenantId, streamTenantId: tenantId },
  );
}

export function deleteMembershipViaEventStore(db: DbConnection, key: MembershipKey): Promise<void> {
  return deleteRowViaEventStore(
    db,
    membershipTarget,
    { userId: key.userId, tenantId: key.tenantId },
    { tenantId: key.tenantId, streamTenantId: key.tenantId },
  );
}

// Tenant streams live on the creator's tenant, which is the seed SystemAdmin's for every tenant a test creates.
export function updateTenantViaEventStore(
  db: DbConnection,
  tenantId: TenantId,
  changes: Readonly<Record<string, unknown>>,
  actorTenantId: TenantId = TestUsers.systemAdmin.tenantId,
): Promise<void> {
  return updateRowViaEventStore(db, tenantTarget, { id: tenantId }, changes, {
    tenantId: actorTenantId,
  });
}

// Invitation streams live on the inviting tenant.
export function updateInvitationViaEventStore(
  db: DbConnection,
  email: string,
  changes: Readonly<Record<string, unknown>>,
  tenantId: TenantId,
): Promise<void> {
  return updateRowViaEventStore(
    db,
    {
      table: tenantInvitationsTable,
      entity: tenantInvitationEntity,
      entityName: "tenant-invitation",
    },
    { email },
    changes,
    { tenantId },
  );
}
