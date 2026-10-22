import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const deps = { features: ["auth"] };

export const feature = defineFeature("orders", (r) => {
  r.requires(deps);
  r.requires(CONSTANT_FEATURE);
});
