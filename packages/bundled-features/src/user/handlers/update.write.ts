import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSystemUser,
  defineWriteHandler,
  findForbiddenRoleAssignment,
  hasAccess,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ConflictError,
  InternalError,
  NotFoundError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isValidIanaTimeZone } from "@cosmicdrift/kumiko-framework/time";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { UserErrors } from "../constants";
import { USER_STATUS, userEntity, userTable } from "../schema/user";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

const REVOKE_ALL_SESSIONS_QN = "sessions:write:user-session:revoke-all-for-user";

// Users can update their OWN profile; SystemAdmin/system can update anyone.
// Handler-level access is openToAll — the row guard below is the actual gate,
// and field-level access (passwordHash/email write-locked to "privileged")
// stops any write that shouldn't touch an identity column.
export const updateWrite = defineWriteHandler({
  name: "user:update",
  schema: z.object({
    id: z.uuid(),
    // Clients must send the version they read. The CrudExecutor rejects
    // missing versions with version_conflict — see optimistic-locking in
    // crud-executor.ts.
    version: z.number(),
    changes: z.object({
      displayName: z.string().min(1).max(100).optional(),
      locale: z.string().min(2).max(10).optional(),
      timezone: z.string().max(64).refine(isValidIanaTimeZone, "invalid IANA time zone").optional(),
      email: z.email().optional(),
      passwordHash: z.string().optional(),
      lastActiveTenantId: z.string().optional(),
      emailVerified: z.boolean().optional(),
      // Globale Rollen — JSON-encoded string[] oder string[]. Field-level
      // write-access ist privileged (siehe userEntity.roles), und der
      // handler prüft explizit auf Privileged-Actor + Elevation-Guard.
      roles: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  }),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const isSelf = event.payload.id === event.user.id;
    const isPrivileged = hasAccess(event.user, { roles: access.privileged });
    if (!isSelf && !isPrivileged) {
      return writeFailure(
        new AccessDeniedError({
          message: "cannot edit other user",
          i18nKey: "user.errors.cannotEditOtherUser",
          details: { reason: UserErrors.cannotEditOtherUser, targetUserId: event.payload.id },
        }),
      );
    }

    if (event.payload.changes.roles !== undefined && !isPrivileged) {
      return writeFailure(
        new AccessDeniedError({
          message: "cannot modify global roles",
          i18nKey: "user.errors.cannotModifyGlobalRoles",
          details: { reason: UserErrors.cannotModifyGlobalRoles },
        }),
      );
    }

    if (!ctx.systemDb) {
      throw new InternalError({ message: "user:update requires r.systemScope()" });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "user rows are tenant-agnostic identity records; self/admin update needs no tenant filter",
    );

    if (event.payload.changes.roles !== undefined) {
      const targetUser = await fetchOne<{
        id: string;
        roles: string | null;
        status: string | null;
      }>(db, userTable, { id: event.payload.id });

      if (!targetUser) {
        return writeFailure(
          new NotFoundError("user", event.payload.id, {
            i18nKey: "user.errors.notFound",
            i18nParams: { id: event.payload.id },
          }),
        );
      }

      const newRoles = parseRoles(event.payload.changes.roles);
      const targetCurrentRoles = parseRoles(targetUser.roles);
      const actorRoles = event.user.roles;

      const forbidden = findForbiddenRoleAssignment(actorRoles, newRoles, targetCurrentRoles);
      if (forbidden !== undefined) {
        return writeFailure(
          new AccessDeniedError({
            message: `role "${forbidden}" cannot be assigned by this actor`,
            i18nKey: "user.errors.roleElevationForbidden",
            details: { reason: UserErrors.roleElevationForbidden, role: forbidden },
          }),
        );
      }

      const wasActiveSystemAdmin =
        targetCurrentRoles.includes("SystemAdmin") &&
        (targetUser.status === USER_STATUS.Active || !targetUser.status);
      const willBeSystemAdmin = newRoles.includes("SystemAdmin");

      if (wasActiveSystemAdmin && !willBeSystemAdmin) {
        const allUsers = await selectMany<{
          id: string;
          roles: string | null;
          status: string | null;
        }>(db, userTable);

        const otherActiveSystemAdmins = allUsers.filter(
          (u) =>
            u.id !== event.payload.id &&
            (u.status === USER_STATUS.Active || !u.status) &&
            parseRoles(u.roles).includes("SystemAdmin"),
        );

        if (otherActiveSystemAdmins.length === 0) {
          return writeFailure(
            new ConflictError({
              message: "cannot demote the last active SystemAdmin",
              i18nKey: "user.errors.cannotDemoteLastSystemAdmin",
              details: {
                reason: UserErrors.cannotDemoteLastSystemAdmin,
                targetUserId: event.payload.id,
              },
            }),
          );
        }
      }

      // Invalidate target user sessions before applying role change
      const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
      if (revoker) {
        await ctx.writeAs(
          createSystemUser(event.user.tenantId ?? SYSTEM_TENANT_ID),
          REVOKE_ALL_SESSIONS_QN,
          {
            userId: event.payload.id,
          },
        );
      }

      const normalizedChanges = {
        ...event.payload.changes,
        roles: JSON.stringify(newRoles),
      };

      return crud.update({ ...event.payload, changes: normalizedChanges }, event.user, db);
    }

    return crud.update(event.payload, event.user, db);
  },
});
