import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createManagedPagesCssFeature,
  createManagedPagesFeature,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";

// managed-pages declares `r.requires("config")` for its branding keys — the
// config feature must be in the stack (runProdApp auto-mounts it; setupTestStack
// does not, so the recipe lists it explicitly).
export const configFeature = createConfigFeature();

// Single-tenant apex: every request maps to the one system tenant. A multi-
// tenant app resolves the tenant from the request Host (subdomain / custom
// domain) and returns the matching tenantId instead — see README.
export const managedPagesFeature = createManagedPagesFeature({
  resolveApexTenant: () => SYSTEM_TENANT_ID,
  allowCustomCss: true,
});

// Companion per-tenant toggle for the CSS-inject capability. Compose it and wire
// feature-toggles to gate custom CSS per tier; without a toggle runtime,
// `ctx.hasFeature` fails open and CSS stays on (the render-time sanitizer is the
// safety boundary regardless).
export const managedPagesCssFeature = createManagedPagesCssFeature();
