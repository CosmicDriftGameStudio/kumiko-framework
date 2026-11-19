import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("sync", (r) => {
  r.writeHandler({
    name: "sync:write:push",
    schema,
    access,
    escapeHatch: { reason: "writes as the system user" },
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(systemUser, "sync:write:apply", event.payload),
  });
  r.hook({
    type: "postSave",
    target: "order",
    escapeHatch: { reason: "reads all tenants" },
    handler: async (event, ctx) => {
      await ctx.dispatch.queryAs(user, "orders:query:list", {});
      await ctx.db.unsafeRaw();
    },
  });
  r.job({
    name: "nightly",
    trigger: { cron: "0 0 * * *" },
    escapeHatch: { reason: "runs as admin" },
    handler: async (ctx) => runAs(SystemAdmin, work),
  });
  const projection = defineProjectionQueryHandler({
    name: "orders:query:all",
    unsafeAllTenants: { reason: "lists every tenant" },
    escapeHatch: { reason: "lists every tenant" },
  });
});
