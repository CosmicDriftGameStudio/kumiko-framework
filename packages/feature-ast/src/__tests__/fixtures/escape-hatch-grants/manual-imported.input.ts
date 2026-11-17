import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { importedHandler } from "./handler";
import { sweepAll } from "./sweep";

export const feature = defineFeature("manual", (r) => {
  r.writeHandler({
    name: "manual:write:sweep",
    schema,
    access,
    escapeHatch: { reason: "sweeps every tenant" },
    handler: async (event, ctx) => {
      await ctx.db.unsafeRaw();
      await sweepAll(ctx);
    },
  });
  r.writeHandler({
    name: "manual:write:imported",
    schema,
    access,
    escapeHatch: { reason: "handler lives elsewhere" },
    handler: importedHandler,
  });
  r.hook({
    type: "postSave",
    target: "order",
    escapeHatch: sharedHatch,
    handler: async () => {},
  });
});
