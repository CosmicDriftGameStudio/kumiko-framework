import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { simpleRenderer } from "./simple-renderer";

export function createRendererSimpleFeature(): FeatureDefinition {
  return defineFeature("rendererSimple", (r) => {
    r.requires("delivery");

    r.useExtension("notificationRenderer", "simple", {
      render: simpleRenderer.render,
    });
  });
}
