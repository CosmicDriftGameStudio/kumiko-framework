import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("reports", (r) => {
  r.writeHandler({
    name: "reports:write:rebuild",
    schema,
    access,
    escapeHatch: { reason: "rebuilds the report table", grants: ["unsafeRaw"] },
    handler: async (event, ctx) => {
      const raw = ctx.db.unsafeRaw();
      return ok(raw);
    },
  });
  r.queryHandler({
    name: "reports:query:export",
    schema,
    access,
    escapeHatch: {
      reason: "streams raw rows",
      grants: ["unsafeRaw"],
    },
    handler: exportRows,
  });
});

async function exportRows(event, ctx) {
  return ctx.db.unsafeRaw().select();
}
