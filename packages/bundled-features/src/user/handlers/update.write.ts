import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler, hasAccess } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  InternalError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isValidIanaTimeZone } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { UserErrors } from "../constants";
import { userEntity, userTable } from "../schema/user";
import { applyUserRolesUpdate } from "./update-roles";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

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
      // Global roles — JSON-encoded string[] or string[]. Field-level write
      // access is privileged (see userEntity.roles); handler also requires a
      // privileged actor and runs the elevation guard.
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

    const roles = event.payload.changes.roles;
    if (roles !== undefined) {
      return applyUserRolesUpdate(
        {
          ...event,
          payload: {
            ...event.payload,
            changes: { ...event.payload.changes, roles },
          },
        },
        ctx,
        db,
      );
    }

    return crud.update(event.payload, event.user, db);
  },
});
