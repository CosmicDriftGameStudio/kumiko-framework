import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { requireSystemDb } from "../../shared/index.ts";
import { decryptTenantNames, tenantTable } from "../../tenant/index.ts";

type TenantRow = { readonly id: string; readonly name: string };

export const tenantOptionsQuery = defineQueryHandler({
  name: "tenant-options",
  description:
    "Returns all tenants as id/name option pairs sorted by name; use it to populate the tenant picker of a platform-wide overview.",
  schema: z.object({}),
  access: { roles: ["SystemAdmin"] },
  handler: async (_query, ctx) => {
    const systemDb = requireSystemDb(ctx, "cap-overview:query:tenant-options");
    const db = systemDb.acknowledgeCrossTenant(
      "cap-overview:tenant-options — SystemAdmin dashboard tenant-filter options",
    );
    const tenants = await decryptTenantNames(
      // Destroyed tenants decrypt to the erased sentinel, which the picker would show verbatim.
      await selectMany<TenantRow>(db, tenantTable, { destroyedAt: null }),
      "cap-overview:tenant-options",
    );
    const sorted = [...tenants].sort((a, b) => a.name.localeCompare(b.name));
    return { rows: sorted.map((tenant) => ({ value: tenant.id, label: tenant.name })) };
  },
});
