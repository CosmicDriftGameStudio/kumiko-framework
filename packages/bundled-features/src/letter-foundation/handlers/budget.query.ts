import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { ConfigKeyHandle } from "@cosmicdrift/kumiko-types/config";
import * as z from "zod";
import { LETTER_ROLES } from "../constants.ts";
import { type LetterBudget, readLetterBudget } from "../letter-usage.ts";

export function createBudgetQuery(limitKey: ConfigKeyHandle<"number">) {
  return defineQueryHandler({
    name: "budget",
    schema: z.object({}),
    access: { roles: [LETTER_ROLES.approver, ...access.admin] },
    description:
      "Returns the tenant's monthly letter cost limit and what is already committed this month, in cents.",
    handler: async (_query, ctx): Promise<LetterBudget> => readLetterBudget(ctx, limitKey),
  });
}
