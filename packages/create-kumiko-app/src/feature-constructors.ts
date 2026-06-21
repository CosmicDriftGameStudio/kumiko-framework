// Static map: feature.name (from the manifest) → ScaffoldFeatureEntry that
// scaffoldApp consumes to render run-config.ts imports + APP_FEATURES.
//
// Limited to the 8 picker-MVP features so the first ship is atomic. The
// other bundled features stay invisible in the picker until they get an
// entry here (mechanical fast-follow — pattern is one entry per feature).
//
// Naming inconsistency is intentional and historical: most features expose
// `create<Pascal>Feature` factories, two (billing-foundation,
// mail-transport-inmemory) export the FeatureDefinition object directly.
// The callExpression captures that: `()` for factories, bare name for objects.

import type { ScaffoldFeatureEntry } from "@cosmicdrift/kumiko-dev-server";

export const FEATURE_CONSTRUCTORS: Readonly<Record<string, ScaffoldFeatureEntry>> = {
  tenant: {
    name: "tenant",
    importPath: "@cosmicdrift/kumiko-bundled-features/tenant",
    exportName: "createTenantFeature",
    callExpression: "createTenantFeature()",
  },
  user: {
    name: "user",
    importPath: "@cosmicdrift/kumiko-bundled-features/user",
    exportName: "createUserFeature",
    callExpression: "createUserFeature()",
  },
  sessions: {
    name: "sessions",
    importPath: "@cosmicdrift/kumiko-bundled-features/sessions",
    exportName: "createSessionsFeature",
    callExpression: "createSessionsFeature()",
  },
  "auth-email-password": {
    name: "auth-email-password",
    importPath: "@cosmicdrift/kumiko-bundled-features/auth-email-password",
    exportName: "createAuthEmailPasswordFeature",
    callExpression: "createAuthEmailPasswordFeature()",
  },
  "user-profile": {
    name: "user-profile",
    importPath: "@cosmicdrift/kumiko-bundled-features/user-profile",
    exportName: "createUserProfileFeature",
    callExpression: "createUserProfileFeature()",
  },
  files: {
    name: "files",
    importPath: "@cosmicdrift/kumiko-bundled-features/files",
    exportName: "createFilesFeature",
    callExpression: "createFilesFeature()",
  },
  delivery: {
    name: "delivery",
    importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
    exportName: "createDeliveryFeature",
    callExpression: "createDeliveryFeature()",
  },
  "mail-transport-inmemory": {
    name: "mail-transport-inmemory",
    importPath: "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory",
    exportName: "mailTransportInMemoryFeature",
    callExpression: "mailTransportInMemoryFeature",
  },
  "billing-foundation": {
    name: "billing-foundation",
    importPath: "@cosmicdrift/kumiko-bundled-features/billing-foundation",
    exportName: "billingFoundationFeature",
    callExpression: "billingFoundationFeature",
  },
};

export function isPickable(featureName: string): boolean {
  return Object.hasOwn(FEATURE_CONSTRUCTORS, featureName);
}
