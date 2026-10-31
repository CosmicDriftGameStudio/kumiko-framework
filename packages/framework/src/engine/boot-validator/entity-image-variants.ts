import type { BlurRegion, VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";
import { VARIANT_NAME_PATTERN } from "../../derivatives/variant-key.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_SELECT_IMAGE_RULES } from "./entity-select-image-rules.ts";

// --- Image variant validation ---

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// Renderers cap dimensions in practice (sharp refuses output above 0x1000000
// pixels); 8192 per edge is generously above any real thumbnail/preview use
// and keeps a boot-declared spec from becoming a memory-exhaustion vector.
const MAX_VARIANT_EDGE_PX = 8192;
// sharp's blur() accepts a sigma of 0.3..1000; anything above that throws at
// render time, months after boot, on the first request for that variant.
const MAX_BLUR_SIGMA = 1000;

function isValidBlurRegion(region: BlurRegion): boolean {
  const { x, y, width, height } = region;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    x >= 0 &&
    y >= 0 &&
    width >= 0 &&
    height >= 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

// kumiko-lint-ignore complexity-budget blur/size bounds added for boot-time DoS guard
function assertValidVariantSpec(name: string, spec: VariantSpec, where: string): void {
  if (!VARIANT_NAME_PATTERN.test(name)) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantName, {
      message: `Image variant "${name}" ${where} must match ${VARIANT_NAME_PATTERN.source} — the name becomes part of a storage key and a URL segment.`,
    });
  }
  if (spec.size !== undefined && spec.maxEdge !== undefined) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantSizeAndMaxEdge, {
      message: `Image variant "${name}" ${where} sets both "size" and "maxEdge" — pick one.`,
    });
  }
  if (
    spec.size !== undefined &&
    !(
      isPositiveInt(spec.size.width) &&
      isPositiveInt(spec.size.height) &&
      spec.size.width <= MAX_VARIANT_EDGE_PX &&
      spec.size.height <= MAX_VARIANT_EDGE_PX
    )
  ) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantSizeInvalid, {
      message: `Image variant "${name}" ${where} has an invalid "size" (${spec.size.width}x${spec.size.height}) — must be a positive integer up to ${MAX_VARIANT_EDGE_PX}px per edge.`,
    });
  }
  if (
    spec.maxEdge !== undefined &&
    !(isPositiveInt(spec.maxEdge) && spec.maxEdge <= MAX_VARIANT_EDGE_PX)
  ) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantMaxEdgeInvalid, {
      message: `Image variant "${name}" ${where} has an invalid "maxEdge" (${spec.maxEdge}) — must be a positive integer up to ${MAX_VARIANT_EDGE_PX}px.`,
    });
  }
  if (spec.quality !== undefined && !(isPositiveInt(spec.quality) && spec.quality <= 100)) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantQualityInvalid, {
      message: `Image variant "${name}" ${where} has "quality" ${spec.quality} — must be an integer in 1..100.`,
    });
  }
  if (
    spec.blur !== undefined &&
    !(Number.isFinite(spec.blur) && spec.blur > 0 && spec.blur <= MAX_BLUR_SIGMA)
  ) {
    throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantBlurInvalid, {
      message: `Image variant "${name}" ${where} has "blur" ${spec.blur} — must be a finite number in (0, ${MAX_BLUR_SIGMA}].`,
    });
  }
  if (spec.blurRegions !== undefined) {
    for (const region of spec.blurRegions) {
      if (!isValidBlurRegion(region)) {
        throw bootRuleError(ENTITY_SELECT_IMAGE_RULES.imageVariantBlurRegionInvalid, {
          message: `Image variant "${name}" ${where} has an invalid "blurRegions" entry ${JSON.stringify(region)} — x/y/width/height must be within 0..1 and x+width/y+height must not exceed 1.`,
        });
      }
    }
  }
}

// A bad spec is only visible when someone finally requests that variant —
// possibly months later, in production. Catch it at boot instead.
export function validateImageVariants(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type !== "image" && field.type !== "images") continue;
      if (field.variants === undefined) continue;
      const where = `on "${entityName}.${fieldName}" in feature "${feature.name}"`;
      for (const [name, spec] of Object.entries(field.variants)) {
        assertValidVariantSpec(name, spec, where);
      }
    }
  }
}
