// kumiko-feature-version: 1

import { defineFeature, EXT_DERIVATIVE_RENDERER } from "@cosmicdrift/kumiko-framework/engine";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import { renderImage } from "./render";

const FEATURE_NAME = "derivatives-sharp";

export const derivativesSharpFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Registers an `image/*` renderer against the `derivativeRenderer` extension point declared by `file-derivatives`, backed by sharp. Supports resize/fit (cover, inside, contain), format conversion with quality (webp, avif, jpeg), whole-image blur, and blurring individual regions burned in before resize (see BlurRegion). EXIF orientation is applied and then normalized away, and all other EXIF (including GPS) is dropped. Server-only: sharp is a native binding — never import this from client code.",
  );
  r.uiHints({
    displayLabel: "File Derivatives · Sharp",
    category: "storage",
    recommended: false,
  });
  r.requires("file-derivatives");

  const plugin: DerivativeRendererPlugin = { render: renderImage };
  r.useExtension(EXT_DERIVATIVE_RENDERER, "image/*", plugin);
});
