import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("geo", (r) => {
  r.writeHandler({
    name: "geo:write:seed",
    schema,
    access,
    escapeHatch: { reason: "seeds the shared country table", grants: ["globalWrites"] },
    handler: async (event, ctx) => {
      await ctx.db.global(countryTable).insert(rows);
      return ok();
    },
  });
  r.writeHandler({
    name: "geo:write:mirror",
    schema,
    access,
    escapeHatch: { reason: "mirrors other tenants", grants: ["globalWrites", "crossTenantReads"] },
    handler: async (event, ctx) => {
      const rows = await ctx.db.crossTenantReads(sourceTable);
      await ctx.db.global(countryTable).insert(rows);
      return ok();
    },
  });
});
