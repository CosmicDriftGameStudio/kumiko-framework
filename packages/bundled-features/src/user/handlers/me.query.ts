import { createEventStoreExecutor } from "@kumiko/framework/db";
import { defineQueryHandler } from "@kumiko/framework/engine";
import { z } from "zod";
import { userEntity, userTable } from "../user-entity";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// Returns the currently signed-in user's profile. Field-level read access
// strips out the passwordHash automatically (configured on the entity).
export const meQuery = defineQueryHandler({
  name: "user:me",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => crud.detail({ id: query.user.id }, query.user, ctx.db),
});
