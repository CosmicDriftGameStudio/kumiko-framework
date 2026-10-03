import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type SessionUser,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ConflictError,
  InternalError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { TenantErrors } from "../constants.js";
import { findForbiddenMembershipRole, reservedMembershipRoleError } from "../membership-roles.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table.js";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

// Both halves: test stacks can mint JWTs with the "system" role, but only the
// framework operator carries SYSTEM_USER_ID.
function isFrameworkSystemUser(user: SessionUser): boolean {
  return user.id === SYSTEM_USER_ID && user.roles.includes(SYSTEM_ROLE);
}

export const addMemberWrite = defineWriteHandler({
  name: "addMember",
  schema: z.object({
    userId: z.string(),
    tenantId: z.string(),
    roles: z.array(z.string()).min(1),
  }),
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  description:
    "Grants an existing user membership in a tenant with the given roles, refusing reserved role names and a user who is already a member; use it to add someone to a workspace without going through an invitation.",
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:addMember requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "SystemAdmin manages memberships across tenants",
    );
    if (!isFrameworkSystemUser(event.user) && event.payload.tenantId !== event.user.tenantId) {
      return writeFailure(
        new AccessDeniedError({
          message: "only the system context may add members to another tenant",
          details: { reason: TenantErrors.crossTenantMembershipDenied },
        }),
      );
    }
    const forbidden = findForbiddenMembershipRole(event.payload.roles);
    if (forbidden !== undefined) return writeFailure(reservedMembershipRoleError(forbidden));
    const existing = await fetchOne(db, tenantMembershipsTable, {
      userId: event.payload.userId,
      tenantId: event.payload.tenantId,
    });
    if (existing) {
      return writeFailure(
        new ConflictError({
          message: "membership already exists",
          i18nKey: "tenant.errors.membershipAlreadyExists",
          details: {
            reason: TenantErrors.membershipAlreadyExists,
            userId: event.payload.userId,
            tenantId: event.payload.tenantId,
          },
        }),
      );
    }

    return executor.create(
      {
        userId: event.payload.userId,
        tenantId: event.payload.tenantId,
        roles: JSON.stringify(event.payload.roles),
      },
      event.user,
      db,
    );
  },
});
