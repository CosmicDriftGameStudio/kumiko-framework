import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  acquireNamespacedAdvisoryLock,
  createEventStoreExecutor,
  type DbRow,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  defineWriteHandler,
  findForbiddenRoleAssignment,
  withResponseData,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { TenantErrors } from "../constants";
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

// Serializes last-TenantAdmin demotion checks per tenant inside the write TX
// (dispatcher batch wraps handlers in transaction — xact lock holds through update).
const LAST_TENANT_ADMIN_LOCK_NAMESPACE = 0x7461646d; // 'tadm'

export const updateMemberRolesWrite = defineWriteHandler({
  name: "updateMemberRoles",
  schema: z.object({
    userId: z.string(),
    tenantId: z.string().optional(),
    roles: z.array(z.string()).min(1),
  }),
  // "system" + access.admin ("TenantAdmin", "Admin", "SystemAdmin").
  // The system user (createSystemUser, roles=["system"]) and SystemAdmin
  // manage memberships cross-tenant (payload.tenantId). TenantAdmin is strictly
  // session-scoped (event.user.tenantId).
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
    // SystemAdmin may pass payload.tenantId for cross-tenant ops; the members
    // actionForm only sends userId+roles, so fall back to the active session
    // tenant (same as TenantAdmin). Require one of the two — bare SystemAdmin
    // with no tenant context still gets a clear validation error.
    const targetTenantId = isSystem
      ? (event.payload.tenantId ?? event.user.tenantId)
      : event.user.tenantId;
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
      // Lock before count+update so two concurrent demotions cannot both
      // observe adminCount === 2 and leave the tenant with zero TenantAdmins.
      await acquireNamespacedAdvisoryLock(db, LAST_TENANT_ADMIN_LOCK_NAMESPACE, targetTenantId);
      const allMemberships = await selectMany(db, tenantMembershipsTable, {
        tenantId: targetTenantId,
      });
      const adminCount = allMemberships.filter((m) =>
        parseRoles(m["roles"]).includes("TenantAdmin"),
      ).length;
      if (adminCount <= 1) {
        return writeFailure(
          new ConflictError({
            message: "cannot demote the last tenant admin",
            i18nKey: "tenant.errors.cannotDemoteLastTenantAdmin",
            details: {
              reason: TenantErrors.lastTenantAdmin,
              userId: event.payload.userId,
              tenantId: targetTenantId,
            },
          }),
        );
      }
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
    const result = await executor.update(
      {
        id: row["id"] as string, // @cast-boundary db-row
        version: row["version"] as number, // @cast-boundary db-row
        changes: { roles: JSON.stringify(event.payload.roles) },
      },
      createSystemUser(targetTenantId),
      db,
    );

    return withResponseData(result, { ...event.payload, tenantId: targetTenantId });
  },
});
