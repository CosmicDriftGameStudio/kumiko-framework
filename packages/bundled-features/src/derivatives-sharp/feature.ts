// kumiko-feature-version: 1

import { defineFeature, EXT_DERIVATIVE_RENDERER } from "@cosmicdrift/kumiko-framework/engine";
import type { DerivativeRendererPlugin } from "@cosmicdrift/kumiko-types/derivatives-types";
import { RENDERABLE_SOURCE_MIME_TYPES, renderImage } from "./render.ts";

const FEATURE_NAME = "derivatives-sharp";

export function createDerivativesSharpFeature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        "Registers a renderer for JPEG, PNG, WebP, AVIF, GIF and TIFF sources against the `derivativeRenderer` extension point declared by `file-derivatives`, backed by sharp. Other image types (HEIC, HEIF, BMP, SVG) get no renderer, so a variant request for them answers 415, or 404 on the public route. Supports resize/fit (cover, inside, contain), format conversion with quality (webp, avif, jpeg), whole-image blur, and blurring individual regions burned in before resize (see BlurRegion). EXIF orientation is applied and then normalized away, and all other EXIF (including GPS) is dropped. Server-only: sharp is a native binding — never import this from client code.",
      );
      r.uiHints({
        displayLabel: "File Derivatives · Sharp",
        category: "storage",
        recommended: false,
      });
      r.requires({ features: ["file-derivatives"] });

      const plugin: DerivativeRendererPlugin = {
        render: renderImage,
        sourceMimeTypes: RENDERABLE_SOURCE_MIME_TYPES,
      };
      // The wildcard stays so an exact app renderer wins regardless of mount order. sourceMimeTypes keeps heic, heif,
      // bmp and svg out, so the variant routes answer 415 or 404 without reading an original sharp cannot decode.
      r.applyExtension({ name: EXT_DERIVATIVE_RENDERER, entity: "image/*", ...plugin });
    },
    { dedupeOptions: {} },
  );
}
