import { defineQueryHandler, filterReadFields } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { contactEntity, contactTable } from "../entities/contact";

export const contactDetail = defineQueryHandler({
  name: "contact:detail",
  schema: z.object({ id: z.uuid() }),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const [row] = await ctx.db.selectMany(contactTable, { id: query.payload.id });
    if (!row) return null;
    return filterReadFields(contactEntity, row as Record<string, unknown>, query.user);
  },
});
