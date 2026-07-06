import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { deliveryAttemptsTable } from "../tables";

export const logQuery = defineQueryHandler({
  name: "log",
  schema: z.object({
    limit: z.number().min(1).max(100).default(50),
  }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const rows = await selectMany(ctx.db, deliveryAttemptsTable, undefined, {
      orderBy: { col: "createdAt", direction: "desc" },
      limit: query.payload.limit,
    });
    // recipientAddress is stored encrypted under the recipient's DEK (#799)
    // — decrypt for the admin log view; forgotten subjects show [[erased]].
    return {
      rows: await Promise.all(
        rows.map(async (row) => ({
          ...row,
          recipientAddress:
            typeof row["recipientAddress"] === "string"
              ? await decryptStoredPii(row["recipientAddress"], "delivery-log")
              : row["recipientAddress"],
        })),
      ),
    };
  },
});
