// Single source of truth for ui-walkthrough feature composition.
//
// src/app/server.ts (dev boot) and kumiko/schema.ts (schema CLI) import
// from here — migration and runtime cannot drift.

import { createManagedPagesFeature } from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createDocumentDesignerFeature } from "@cosmicdrift/kumiko-document-designer";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { billingFeature } from "./features/billing";
import { rentalFeature } from "./features/rental";
import { taskFeature } from "./features/tasks";
import { vehiclesFeature } from "./features/vehicles";

export const APP_FEATURES = [
  localeDe(),
  taskFeature,
  rentalFeature,
  vehiclesFeature,
  billingFeature,
  createTemplateResolverFeature(),
  // Only the branding rail of the layout editor needs managed-pages; the sample
  // serves no public pages, so no host resolves to a tenant.
  createManagedPagesFeature({ resolveApexTenant: () => null }),
  createDocumentDesignerFeature(),
] as const;

// runDevApp auto-mounts config/user/tenant/auth-email-password when
// `auth: { … }` is set in server.ts (composeFeatures includeBundled).
export const HAS_AUTH = true;
