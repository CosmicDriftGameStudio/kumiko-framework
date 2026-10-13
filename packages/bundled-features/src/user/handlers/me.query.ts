import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { userEntity, userTable } from "../schema/user.js";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// Returns the currently signed-in user's profile. Field-level read access
// strips out the passwordHash automatically (configured on the entity).
// `effectiveTimeZone` is the effective IANA zone of the caller.
export const meQuery = defineQueryHandler({
  name: "user:me",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "each signed-in user reads only their own identity record; the detail lookup " +
        "is by the caller's own id",
    },
  },
  rateLimit: {
    disabled: true,
    reason:
      "self-scoped read of the caller's own user record, hit on every page load; per-tenant " +
      "bucket would throttle the whole tenant, L1 IP limit still applies",
  },
  description:
    "Returns the signed-in caller's own identity record, with the password hash stripped by field-level read access; use it whenever the current user's own profile data is needed.",
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({ message: "user:me requires r.systemScope()" });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "user rows are tenant-agnostic identity records; self-lookup by id needs no tenant filter",
    );
    const row = await crud.detail({ id: query.user.id }, query.user, db);
    // `timezone` on the row is only the stored override (often unset); clients
    // need the effective zone (override, else tenant, else UTC) to compute "today".
    return row === null ? row : { ...row, effectiveTimeZone: ctx.tz.user };
  },
});
