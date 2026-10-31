import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { adminAccess, contactDb } from "../lib.ts";
import { ContactEmptySchema } from "../payloads.ts";
import { countOpenRequests } from "./open-count.ts";

export const openCountQuery = defineQueryHandler({
  name: "open-count",
  schema: ContactEmptySchema,
  access: adminAccess,
  description:
    "Counts the contact requests that still wait for a first answer, for the dashboard tile.",
  handler: async (_event, ctx) => {
    return { count: await countOpenRequests(contactDb(ctx)) };
  },
});
