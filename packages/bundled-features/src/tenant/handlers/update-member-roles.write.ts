import { type DbRow, fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { NotFoundError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";

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

    await db
      .update(tenantMembershipsTable)
      .set({ roles: JSON.stringify(event.payload.roles), modifiedAt: Temporal.Now.instant() })
      .where(eq(tenantMembershipsTable.id, (existing as DbRow)["id"] as number));

    return { isSuccess: true, data: event.payload };
  },
});
