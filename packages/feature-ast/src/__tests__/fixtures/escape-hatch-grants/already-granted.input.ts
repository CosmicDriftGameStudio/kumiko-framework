import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("granted", (r) => {
  r.writeHandler({
    name: "granted:write:one",
    schema,
    access,
    escapeHatch: { reason: "already named", grants: ["unsafeRaw"] },
    handler: async (event, ctx) => ctx.db.global(table),
  });
  r.queryHandler({
    name: "granted:query:two",
    schema,
    access,
    escapeHatch: {
      reason: "already named too",
      grants: ["crossTenantReads"],
    },
    handler: async () => [],
  });
});
