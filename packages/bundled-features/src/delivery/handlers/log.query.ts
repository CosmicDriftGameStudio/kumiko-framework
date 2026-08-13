import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
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
    if (!ctx.systemDb) {
      throw new InternalError({ message: "delivery log handler requires ctx.systemDb" });
    }
    // delivery is r.systemScope()'d, so the TenantDb is system-mode (reads
    // unfiltered). assertTenantMatch is a self-check on the caller's own
    // tenantId, not a query filter — it returns that same unfiltered db, so
    // the explicit `where` below still does the actual tenant scoping.
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const rows = await selectMany(
      db,
      deliveryAttemptsTable,
      { tenantId: query.user.tenantId },
      {
        orderBy: { col: "createdAt", direction: "desc" },
        limit: query.payload.limit,
      },
    );
    // recipientAddress is stored encrypted under the recipient's DEK (#799)
    // — decrypt for the admin log view; forgotten subjects show [[erased]].
    return {
      rows: await Promise.all(
        rows.map(async (row) => ({
          ...row,
          recipientAddress:
            typeof row["recipientAddress"] === "string"
              ? await decryptStoredPii(row["recipientAddress"], "recipientAddress", "delivery-log")
              : row["recipientAddress"],
        })),
      ),
    };
  },
});
