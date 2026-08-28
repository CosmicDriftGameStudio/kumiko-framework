import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type DbRow } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  withResponseData,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { assertNotLastTenantAdmin } from "../last-tenant-admin";
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
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:removeMember requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "SystemAdmin manages memberships across tenants",
    );
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

    const currentRoles = parseRoles((existing as DbRow)["roles"]);
    if (currentRoles.includes("TenantAdmin")) {
      const lastAdmin = await assertNotLastTenantAdmin(
        db,
        event.payload.tenantId,
        event.payload.userId,
      );
      if (lastAdmin !== undefined) return lastAdmin;
    }

    // Revoke THIS tenant's sessions BEFORE the delete — a removed member must
    // not keep a valid session for the window between the delete and a
    // post-delete revoke. Best-effort cross-feature call: sessions may not be
    // mounted (registry lookup, see above). If the delete then fails, the
    // member is logged out but the membership is intact — safe direction.
    const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
    if (revoker) {
      await ctx.writeAs(createSystemUser(event.payload.tenantId), REVOKE_ALL_SESSIONS_QN, {
        userId: event.payload.userId,
        tenantId: event.payload.tenantId,
      });
    }

    const result = await executor.delete(
      { id: (existing as DbRow)["id"] as string }, // @cast-boundary db-row
      event.user,
      db,
    );

    return withResponseData(result, event.payload);
  },
});
