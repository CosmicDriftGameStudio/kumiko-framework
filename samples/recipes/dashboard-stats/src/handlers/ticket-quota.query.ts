import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";

export const ticketQuotaQuery = defineQueryHandler({
  name: "ticket:quota",
  schema: z.object({}),
  handler: async () => ({
    month: "November",
    period: "01.11. - 30.11.",
    rows: [{ label: "Tickets handled", used: 18, limit: 25, sub: "7 left" }],
  }),
  access: readerRoles,
});
