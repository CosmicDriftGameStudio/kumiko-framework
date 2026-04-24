import { createEventStoreExecutor, type DbRow, fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { NotFoundError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { membershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, membershipEntity, {
  entityName: "tenantMembership",
});

export const updateMemberRolesWrite = defineWriteHandler({
  name: "updateMemberRoles",
  schema: z.object({
    userId: z.string(),
    tenantId: z.string(),
    roles: z.array(z.string()).min(1),
  }),
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

    const result = await executor.update(
      {
        id: (existing as DbRow)["id"] as string,
        changes: { roles: JSON.stringify(event.payload.roles) },
      },
      event.user,
      db,
      // Handler schema carries no version — we trust the fetchOne above.
      // Pre-ES this was a plain UPDATE with no locking; keeping that
      // contract means we opt out of the executor's version check.
      { skipOptimisticLock: true },
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true, data: event.payload };
  },
});
