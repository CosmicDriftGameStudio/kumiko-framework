import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { open } from "../access";

export const leaseKennzahlenQuery = defineQueryHandler({
  name: "lease:kennzahlen",
  schema: z.object({}),
  handler: async () => ({
    debt: "123.456 €",
    debtSub: "nach 10 Jahren",
    debtDelta: "15 %",
    debtDeltaDirection: "down",
    rent: "48.200 €",
    rentSub: "319 Verträge",
  }),
  ...open,
});
