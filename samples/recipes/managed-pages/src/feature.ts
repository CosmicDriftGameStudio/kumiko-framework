import {
  createBrandingCssFeature,
  createBrandingFeature,
} from "@cosmicdrift/kumiko-bundled-features/branding";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

// branding declares `r.requires({ features: ["config"] })` for its keys — the
// config feature must be in the stack (runProdApp auto-mounts it; setupTestStack
// does not, so the recipe lists it explicitly).
export const configFeature = createConfigFeature();

// Single-tenant: every host maps to the system tenant. A multi-tenant app with
// host-routing (or another tenant resolver) omits resolveApexTenant; the route
// then uses the server's host resolution.
export const managedPagesFeature = createManagedPagesFeature({
  resolveApexTenant: () => SYSTEM_TENANT_ID,
});

// Per-tenant branding lives in its own feature; managed-pages reads it at render time.
export const brandingFeature = createBrandingFeature({ allowCustomCss: true });

// Companion per-tenant toggle for the CSS-inject capability. Compose it and wire
// feature-toggles to gate custom CSS per tier; without a toggle runtime,
// `ctx.hasFeature` fails open and CSS stays on (the render-time sanitizer is the
// safety boundary regardless).
export const brandingCssFeature = createBrandingCssFeature();
