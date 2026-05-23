import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { notificationPreferencesTable } from "../tables";

export const preferencesQuery = defineQueryHandler({
  name: "preferences",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await selectMany(ctx.db, notificationPreferencesTable, { userId: query.user.id });

    return { rows };
  },
});
