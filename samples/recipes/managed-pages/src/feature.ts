import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createManagedPagesCssFeature,
  createManagedPagesFeature,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

// managed-pages declares `r.requires({ features: ["config"] })` for its branding keys — the
// config feature must be in the stack (runProdApp auto-mounts it; setupTestStack
// does not, so the recipe lists it explicitly).
export const configFeature = createConfigFeature();

// Single-tenant: every host maps to the system tenant. A multi-tenant app with
// host-routing (or another tenant resolver) omits resolveApexTenant; the route
// then uses the server's host resolution.
export const managedPagesFeature = createManagedPagesFeature({
  resolveApexTenant: () => SYSTEM_TENANT_ID,
  allowCustomCss: true,
});

// Companion per-tenant toggle for the CSS-inject capability. Compose it and wire
// feature-toggles to gate custom CSS per tier; without a toggle runtime,
// `ctx.hasFeature` fails open and CSS stays on (the render-time sanitizer is the
// safety boundary regardless).
export const managedPagesCssFeature = createManagedPagesCssFeature();
