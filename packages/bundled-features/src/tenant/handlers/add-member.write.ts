import { fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { ConflictError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { TenantErrors } from "../constants";
import { tenantMembershipsTable } from "../membership-table";

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
    const existing = await fetchOne(
      db,
      tenantMembershipsTable,
      eq(tenantMembershipsTable.userId, event.payload.userId),
      eq(tenantMembershipsTable.tenantId, event.payload.tenantId),
    );
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

    const [row] = await db
      .insert(tenantMembershipsTable)
      .values({
        userId: event.payload.userId,
        tenantId: event.payload.tenantId,
        roles: JSON.stringify(event.payload.roles),
      })
      .returning();

    return { isSuccess: true, data: row };
  },
});
