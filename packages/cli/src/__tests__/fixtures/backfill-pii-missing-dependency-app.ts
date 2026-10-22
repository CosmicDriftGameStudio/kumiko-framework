import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import backfillApp from "./backfill-pii-app";

// createRegistry throws on the unregistered dependency, after the KMS is already wired.
export default {
  features: [
    ...backfillApp.features,
    defineFeature("clibfbroken", (r) => {
      r.requires({ features: ["clibf-not-registered"] });
    }),
  ],
};
