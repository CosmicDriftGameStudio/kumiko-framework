import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";

// Gate for the screens: a flat answer with one boolean the screens test with `eq`.
export const ticketCapabilitiesQuery = defineQueryHandler({
  name: "ticket:capabilities",
  schema: z.object({}),
  outputSchema: z.object({ canClose: z.boolean() }),
  handler: async (query) => ({ canClose: query.user.roles.includes("Admin") }),
  access: readerRoles,
});
