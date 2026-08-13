import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { userEntity, userTable } from "../schema/user";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// Returns the currently signed-in user's profile. Field-level read access
// strips out the passwordHash automatically (configured on the entity).
export const meQuery = defineQueryHandler({
  name: "user:me",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({ message: "user:me requires r.systemScope()" });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "user rows are tenant-agnostic identity records; self-lookup by id needs no tenant filter",
    );
    return crud.detail({ id: query.user.id }, query.user, db); // @wrapper-known semantic-alias
  },
});
