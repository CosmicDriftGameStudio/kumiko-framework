import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantTable } from "../../tenant";

type TenantRow = { readonly id: string; readonly name: string };

export const tenantOptionsQuery = defineQueryHandler({
  name: "tenant-options",
  schema: z.object({}),
  access: { roles: ["SystemAdmin"] },
  handler: async (_query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "cap-overview:query:tenant-options requires ctx.systemDb — is r.systemScope() set?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "cap-overview:tenant-options — SystemAdmin dashboard tenant-filter options",
    );
    const tenants = await selectMany<TenantRow>(
      db,
      tenantTable,
      {},
      {
        orderBy: { col: "name", direction: "asc" },
      },
    );
    return { rows: tenants.map((tenant) => ({ value: tenant.id, label: tenant.name })) };
  },
});
