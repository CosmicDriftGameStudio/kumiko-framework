import { createEventStoreExecutor, type DbRow, fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler, withResponseData } from "@kumiko/framework/engine";
import { NotFoundError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenantMembership",
});

export const removeMemberWrite = defineWriteHandler({
  name: "removeMember",
  schema: z.object({ userId: z.string(), tenantId: z.string() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const existing = await fetchOne(
      db,
      tenantMembershipsTable,
      eq(tenantMembershipsTable.userId, event.payload.userId),
      eq(tenantMembershipsTable.tenantId, event.payload.tenantId),
    );
    if (!existing) {
      return writeFailure(
        new NotFoundError("membership", undefined, {
          i18nKey: "tenant.errors.membershipNotFound",
          i18nParams: { userId: event.payload.userId, tenantId: event.payload.tenantId },
        }),
      );
    }

    const result = await executor.delete(
      { id: (existing as DbRow)["id"] as string },
      event.user,
      db,
    );
    return withResponseData(result, event.payload);
  },
});
