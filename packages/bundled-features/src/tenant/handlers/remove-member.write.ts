import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type DbRow } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  withResponseData,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

// Literal QN, not an import off the sessions feature — tenant is
// foundational and must boot without sessions mounted (no r.requires/
// r.usesApi here, unlike user-data-rights:restrict-account's hard dep).
const REVOKE_ALL_SESSIONS_QN = "sessions:write:user-session:revoke-all-for-user";

export const removeMemberWrite = defineWriteHandler({
  name: "removeMember",
  schema: z.object({ userId: z.string(), tenantId: z.string() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const existing = await fetchOne(db, tenantMembershipsTable, {
      userId: event.payload.userId,
      tenantId: event.payload.tenantId,
    });
    if (!existing) {
      return writeFailure(
        new NotFoundError("membership", undefined, {
          i18nKey: "tenant.errors.membershipNotFound",
          i18nParams: { userId: event.payload.userId, tenantId: event.payload.tenantId },
        }),
      );
    }

    const result = await executor.delete(
      { id: (existing as DbRow)["id"] as string }, // @cast-boundary db-row
      event.user,
      db,
    );

    // Revoke only this tenant's sessions — a multi-tenant user stays logged
    // in to tenants they're still a member of. Best-effort cross-feature
    // call: sessions may not be mounted (registry lookup, see above).
    if (result.isSuccess) {
      const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
      if (revoker) {
        await ctx.writeAs(createSystemUser(event.payload.tenantId), REVOKE_ALL_SESSIONS_QN, {
          userId: event.payload.userId,
          tenantId: event.payload.tenantId,
        });
      }
    }
    return withResponseData(result, event.payload);
  },
});
