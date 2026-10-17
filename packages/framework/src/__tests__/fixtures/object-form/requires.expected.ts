import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const SHARED_FEATURES = ["users", "tenants"] as const;

export const feature = defineFeature("orders", (r) => {
  r.requires({ features: ["users"] });
  r.requires({ features: ["users", "tenants"] });
  r.requires({ features: [CONSTANT_FEATURE] });
  r.requires({ features: [...SHARED_FEATURES, "mail"] });
  r.requires({ features: [`${PREFIX}-files`] });
  r.requires.projection("order-summary");
  r.optionalRequires("billing");
  r.requires({ features: ["already-object-form"] });
});
