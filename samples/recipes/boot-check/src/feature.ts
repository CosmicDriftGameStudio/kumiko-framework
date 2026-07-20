// Boot-Check Sample
// Shows: how a feature declares its own mount-invariant via r.bootCheck,
// for conditional cross-feature requirements r.requires can't express.

import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// The prompt-store trap (kumiko-enterprise#229): a feature with a PII field
// was mounted without its required companion feature, and nothing caught
// it at boot. r.requires("user-data-hook") can't express this — it would
// fail even for a prompt-store variant with no PII fields at all.
const promptFields = { text: createTextField({ pii: true }) };

export const promptStoreFeature = defineFeature("prompt-store", (r) => {
  r.entity("prompt", createEntity({ fields: promptFields }));
  r.bootCheck(({ features }) => {
    const hasPiiField = Object.values(promptFields).some((field) => field.pii);
    const hasUserDataHook = features.some((f) => f.name === "user-data-hook");
    if (hasPiiField && !hasUserDataHook) {
      throw new Error("prompt-store has PII fields but no user-data-hook feature is mounted");
    }
  });
});

export const userDataHookFeature = defineFeature("user-data-hook", () => {});
