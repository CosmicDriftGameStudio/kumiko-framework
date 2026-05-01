import { createEventStoreExecutor } from "@kumiko/framework/db";
import { access, defineWriteHandler, hasAccess } from "@kumiko/framework/engine";
import { AccessDeniedError, writeFailure } from "@kumiko/framework/errors";
import { z } from "zod";
import { UserErrors } from "../constants";
import { userEntity, userTable } from "../schema/user";

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
      email: z.email().optional(),
      passwordHash: z.string().optional(),
      lastActiveTenantId: z.string().optional(),
      emailVerified: z.boolean().optional(),
      // Globale Rollen — JSON-encoded string[]. Field-level write-access
      // ist privileged (siehe userEntity.roles), d.h. ein non-privileged
      // Caller sieht hier zwar einen 200, aber das Field-Guard im
      // executor blockt die Spalte vorm Schreiben (silent strip). Schema
      // akzeptiert das field damit der SystemAdmin-Pfad explizit
      // existiert; der Privilege-Escalation-Schutz greift im
      // FieldAccessFilter, nicht im Schema.
      roles: z.string().optional(),
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
    return crud.update(event.payload, event.user, ctx.db);
  },
});
