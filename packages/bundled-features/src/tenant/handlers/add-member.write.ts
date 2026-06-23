import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { TenantErrors } from "../constants";
import { findForbiddenMembershipRole, reservedMembershipRoleError } from "../membership-roles";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

export const addMemberWrite = defineWriteHandler({
  name: "addMember",
  schema: z.object({
    userId: z.string(),
    tenantId: z.string(),
    roles: z.array(z.string()).min(1),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
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
