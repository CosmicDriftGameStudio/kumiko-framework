import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("manual", (r) => {
  r.writeHandler({
    name: "manual:write:broad",
    schema,
    access,
    escapeHatch: { reason: "does something broad" },
    handler: async (event, ctx) => ok(),
  });
});
