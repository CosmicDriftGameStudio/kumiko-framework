import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type DbRow } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  withResponseData,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { findForbiddenMembershipRole, reservedMembershipRoleError } from "../membership-roles";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

// Literal QN, not an import off the sessions feature — tenant is
// foundational and must boot without sessions mounted (no r.requires/
// r.usesApi here, unlike user-data-rights:restrict-account's hard dep).
const REVOKE_ALL_SESSIONS_QN = "sessions:write:user-session:revoke-all-for-user";

export const updateMemberRolesWrite = defineWriteHandler({
  name: "updateMemberRoles",
  schema: z.object({
    userId: z.string(),
    tenantId: z.string(),
    roles: z.array(z.string()).min(1),
  }),
  // "system" + "SystemAdmin" — symmetric to tenant:write:create. The
  // system user (createSystemUser, roles=["system"]) needs access for
  // seed migrations and other ops-tooling paths. SystemAdmin is the real
  // human-operator path via the UI.
  access: { roles: ["system", "SystemAdmin"] },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:updateMemberRoles requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "SystemAdmin manages memberships across tenants",
    );
    const forbidden = findForbiddenMembershipRole(event.payload.roles);
    if (forbidden !== undefined) return writeFailure(reservedMembershipRoleError(forbidden));
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

    // fetchOne already gave us the stream version — hand it to the executor
    // instead of skipping the lock. Race window (another SystemAdmin writing
    // between this read and append) surfaces as version_conflict rather than
    // silent overwrite. Per-membership parallelism is rare; if it happens,
    // the client retries on the error.
    const row = existing as DbRow; // @cast-boundary generic-record
    // A role change can be security-relevant (e.g. demoting an Admin) — the
    // user must re-authenticate with the new roles, everywhere. Revoke BEFORE
    // the update closes the window where the demoted user keeps a valid
    // session until the revoke write lands. Best-effort cross-feature call:
    // sessions may not be mounted (registry lookup instead of a hard
    // requires, see above).
    const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
    if (revoker) {
      await ctx.writeAs(createSystemUser(event.user.tenantId), REVOKE_ALL_SESSIONS_QN, {
        userId: event.payload.userId,
      });
    }

    const result = await executor.update(
      {
        id: row["id"] as string, // @cast-boundary db-row
        version: row["version"] as number, // @cast-boundary db-row
        changes: { roles: JSON.stringify(event.payload.roles) },
      },
      event.user,
      db,
    );

    return withResponseData(result, event.payload);
  },
});
