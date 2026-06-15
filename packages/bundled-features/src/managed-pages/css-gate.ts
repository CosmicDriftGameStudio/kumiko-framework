import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { MANAGED_PAGES_CSS_FEATURE } from "./branding";

// Per-tenant toggle gate for the managed-pages custom-CSS capability. Declares
// no handlers/entities — composing it simply registers `managed-pages-css` as a
// `toggleable` feature (default OFF), which an operator/tier can enable per
// tenant via feature-toggles. managed-pages' branding query reads
// `ctx.hasFeature("managed-pages-css")` and only emits raw tenant CSS when this
// toggle is on AND the app passed `allowCustomCss: true`.
//
// Without a feature-toggles/tier-engine runtime wired, ctx.hasFeature returns
// true (apps without tier-cuts treat all features on), so `allowCustomCss`
// alone governs. To per-tenant tier-gate CSS-inject, compose this feature AND
// wire feature-toggles; the render-time sanitizer is the safety boundary either
// way. Compose alongside managed-pages (it `requires` it).
export function createManagedPagesCssFeature(): FeatureDefinition {
  return defineFeature(MANAGED_PAGES_CSS_FEATURE, (r) => {
    r.describe(
      'Per-tenant toggle gate for the managed-pages custom-CSS (raw tenant CSS-inject) capability. Handler-less: composing it makes `managed-pages-css` a toggleable feature defaulting OFF, so an operator/tier can grant raw CSS-inject per tenant. managed-pages reads `ctx.hasFeature("managed-pages-css")` in its branding query and emits tenant CSS only when this toggle is on AND the app passed `allowCustomCss: true`. The tenant CSS is allowlist-sanitized + scoped at render regardless; this gate is the commercial/operator control, not the safety boundary.',
    );
    r.requires("managed-pages");
    r.toggleable({ default: false });
  });
}
