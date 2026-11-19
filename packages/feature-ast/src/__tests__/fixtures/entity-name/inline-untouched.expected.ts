import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("inline", (r) => {
  r.entity({ name: "inline", fields: {} });
  r.crud(inlineEntity, { read: { access } });
});
