import { createEventStoreExecutor, type DbRow, fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler, withResponseData } from "@kumiko/framework/engine";
import { NotFoundError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
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

    // fetchOne already gave us the stream version — hand it to the executor
    // instead of skipping the lock. Race window (another SystemAdmin writing
    // between this read and append) surfaces as version_conflict rather than
    // silent overwrite. Per-membership parallelism is rare; if it happens,
    // the client retries on the error.
    const row = existing as DbRow;
    const result = await executor.update(
      {
        id: row["id"] as string,
        version: row["version"] as number,
        changes: { roles: JSON.stringify(event.payload.roles) },
      },
      event.user,
      db,
    );
    return withResponseData(result, event.payload);
  },
});
