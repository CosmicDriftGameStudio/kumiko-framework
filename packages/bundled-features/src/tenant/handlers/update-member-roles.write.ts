import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, type DbRow } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  defineWriteHandler,
  findForbiddenRoleAssignment,
  withResponseData,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  NotFoundError,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { assertNotLastTenantAdmin } from "../last-tenant-admin";
import {
  findForbiddenMembershipRole,
  reservedMembershipRoleError,
  unassignableMembershipRoleError,
} from "../membership-roles";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

// Literal QN, not an import off the sessions feature — tenant is
// foundational and must boot without sessions mounted (no r.requires/
// r.usesApi here, unlike user-data-rights:restrict-account's hard dep).
const REVOKE_ALL_SESSIONS_QN = "sessions:write:user-session:revoke-all-for-user";

/** SystemAdmin may pass payload.tenantId (cross-tenant); the members actionForm
 *  only sends userId+roles, so fall back to the active session tenant. */
function resolveTargetTenantId(
  isSystem: boolean,
  payloadTenantId: string | undefined,
  sessionTenantId: string | undefined,
): string | undefined {
  return isSystem ? (payloadTenantId ?? sessionTenantId) : sessionTenantId;
}

export const updateMemberRolesWrite = defineWriteHandler({
  name: "updateMemberRoles",
  schema: z.object({
    userId: z.string().min(1),
    tenantId: z.string().optional(),
    roles: z.array(z.string()).min(1),
  }),
  // "system" + access.admin ("TenantAdmin", "Admin", "SystemAdmin").
  // The system user (createSystemUser, roles=["system"]) and SystemAdmin
  // manage memberships cross-tenant (payload.tenantId). TenantAdmin and Admin
  // are session-scoped (event.user.tenantId).
  access: { roles: ["system", ...access.admin] },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:updateMemberRoles requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }

    const isSystem =
      event.user.roles.includes("SystemAdmin") || event.user.roles.includes("system");
    const targetTenantId = resolveTargetTenantId(
      isSystem,
      event.payload.tenantId,
      event.user.tenantId,
    );
    if (!targetTenantId) {
      return writeFailure(
        new ValidationError({
          fields: [
            {
              path: "tenantId",
              code: "required",
              i18nKey: "errors.validation.required",
            },
          ],
        }),
      );
    }
    const db = isSystem
      ? ctx.systemDb.acknowledgeCrossTenant("SystemAdmin manages memberships across tenants")
      : ctx.systemDb.assertTenantMatch(event.user.tenantId);

    const forbidden = findForbiddenMembershipRole(event.payload.roles);
    if (forbidden !== undefined) return writeFailure(reservedMembershipRoleError(forbidden));

    const existing = await fetchOne(db, tenantMembershipsTable, {
      userId: event.payload.userId,
      tenantId: targetTenantId,
    });
    if (!existing) {
      return writeFailure(
        new NotFoundError("membership", undefined, {
          i18nKey: "tenant.errors.membershipNotFound",
          i18nParams: { userId: event.payload.userId, tenantId: targetTenantId },
        }),
      );
    }

    const row = existing as DbRow; // @cast-boundary generic-record
    const currentTargetRoles = parseRoles(row["roles"]);

    if (!event.user.roles.includes("system")) {
      const forbiddenElevation = findForbiddenRoleAssignment(
        event.user.roles,
        event.payload.roles,
        currentTargetRoles,
      );
      if (forbiddenElevation !== undefined) {
        return writeFailure(unassignableMembershipRoleError(forbiddenElevation));
      }
    }

    const targetIsTenantAdmin = currentTargetRoles.includes("TenantAdmin");
    const willBeTenantAdmin = event.payload.roles.includes("TenantAdmin");

    if (targetIsTenantAdmin && !willBeTenantAdmin) {
      const lastAdmin = await assertNotLastTenantAdmin(db, targetTenantId, event.payload.userId);
      if (lastAdmin !== undefined) return lastAdmin;
    }

    // fetchOne already gave us the stream version — hand it to the executor
    // instead of skipping the lock. Race window (another admin writing
    // between this read and append) surfaces as version_conflict rather than
    // silent overwrite. Per-membership parallelism is rare; if it happens,
    // the client retries on the error.
    //
    // A role change can be security-relevant (e.g. demoting an Admin) — the
    // user must re-authenticate with the new roles, everywhere. Revoke BEFORE
    // the update closes the window where the demoted user keeps a valid
    // session until the revoke write lands. Best-effort cross-feature call:
    // sessions may not be mounted (registry lookup instead of a hard
    // requires, see above).
    const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
    if (revoker) {
      await ctx.writeAs(createSystemUser(targetTenantId), REVOKE_ALL_SESSIONS_QN, {
        userId: event.payload.userId,
        tenantId: targetTenantId,
      });
    }

    // Stream tenant follows the actor via streamTenantFor — use the
    // membership tenant so SystemAdmin/cross-tenant and TenantAdmin paths
    // hit the same stream seedTenantMembership/invite-accept wrote.
    // Keep the real actor for audit metadata; only override tenantId so
    // streamTenantFor writes into the membership tenant (#2401).
    const result = await executor.update(
      {
        id: row["id"] as string, // @cast-boundary db-row
        version: row["version"] as number, // @cast-boundary db-row
        changes: { roles: JSON.stringify(event.payload.roles) },
      },
      { ...event.user, tenantId: targetTenantId },
      db,
    );

    return withResponseData(result, { ...event.payload, tenantId: targetTenantId });
  },
});
