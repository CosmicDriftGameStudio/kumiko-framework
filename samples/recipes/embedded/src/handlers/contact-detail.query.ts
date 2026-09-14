import { defineQueryHandler, filterReadFields } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { contactEntity, contactTable } from "../entities/contact";

export const contactDetail = defineQueryHandler({
  name: "contact:detail",
  schema: z.object({ id: z.uuid() }),
  access: {
    openToAll: {
      reason:
        "demo recipe: any signed-in user may look up any contact by id, subject to " +
        "the entity's own field-level read access on restricted sub-fields like billingAddress.vatId",
    },
  },
  handler: async (query, ctx) => {
    const [row] = await ctx.db.selectMany(contactTable, { id: query.payload.id });
    if (!row) return null;
    return filterReadFields(contactEntity, row as Record<string, unknown>, query.user);
  },
});
