import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { BRANDING_CSS_FEATURE, BRANDING_FEATURE } from "./constants.ts";

// Per-tenant toggle gate for the branding custom-CSS capability. Declares
// no handlers/entities — composing it simply registers `branding-css` as a
// `toggleable` feature (default OFF), which an operator/tier can enable per
// tenant via feature-toggles. The branding tokens query reads
// `ctx.hasFeature("branding-css")` and only emits raw tenant CSS when this
// toggle is on AND the app passed `allowCustomCss: true`.
//
// Without a feature-toggles/tier-engine runtime wired, ctx.hasFeature returns
// true (apps without tier-cuts treat all features on), so `allowCustomCss`
// alone governs. To per-tenant tier-gate CSS-inject, compose this feature AND
// wire feature-toggles; the render-time sanitizer is the safety boundary either
// way. Compose alongside branding (it `requires` it).
export function createBrandingCssFeature(): FeatureDefinition {
  return defineFeature(BRANDING_CSS_FEATURE, (r) => {
    r.describe(
      'Per-tenant toggle gate for the branding custom-CSS (raw tenant CSS-inject) capability. Handler-less: composing it makes `branding-css` a toggleable feature defaulting OFF, so an operator/tier can grant raw CSS-inject per tenant. The branding tokens query reads `ctx.hasFeature("branding-css")` and emits tenant CSS only when this toggle is on AND the app passed `allowCustomCss: true` to createBrandingFeature. The tenant CSS is allowlist-sanitized + scoped at render regardless; this gate is the commercial/operator control, not the safety boundary.',
    );
    r.requires({ features: [BRANDING_FEATURE] });
    r.toggleable({ default: false });
  });
}
