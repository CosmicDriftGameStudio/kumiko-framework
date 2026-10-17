import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const SHARED_FEATURES = ["users", "tenants"] as const;

export const feature = defineFeature("orders", (r) => {
  r.requires("users");
  r.requires("users", "tenants");
  r.requires(CONSTANT_FEATURE);
  r.requires(...SHARED_FEATURES, "mail");
  r.requires(`${PREFIX}-files`);
  r.requires.projection("order-summary");
  r.optionalRequires("billing");
  r.requires({ features: ["already-object-form"] });
});
