// Static map: feature.name (from the manifest) → ScaffoldFeatureEntry that
// scaffoldApp consumes to render run-config.ts imports + APP_FEATURES.
//
// One entry per bundled feature whose constructor takes zero required args
// (or only opts with defaults). Features requiring caller-supplied
// transports/providers (channel-email, channel-push, subscription-stripe,
// subscription-mollie, file-provider-s3, managed-pages, tier-engine) are
// intentionally absent — the picker hides them, the user wires them by
// hand after scaffold.
//
// Naming inconsistency is intentional and historical: most features expose
// `create<Pascal>Feature` factories, a handful export the FeatureDefinition
// object directly. The callExpression captures that: `()` for factories,
// bare name for objects.

import type { ScaffoldFeatureEntry } from "@cosmicdrift/kumiko-dev-server";

export const FEATURE_CONSTRUCTORS: Readonly<Record<string, ScaffoldFeatureEntry>> = {
  // --- Identity ---
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

  // --- Infrastructure ---
  config: {
    name: "config",
    importPath: "@cosmicdrift/kumiko-bundled-features/config",
    exportName: "createConfigFeature",
    callExpression: "createConfigFeature()",
  },
  secrets: {
    name: "secrets",
    importPath: "@cosmicdrift/kumiko-bundled-features/secrets",
    exportName: "createSecretsFeature",
    callExpression: "createSecretsFeature()",
  },
  "cap-counter": {
    name: "cap-counter",
    importPath: "@cosmicdrift/kumiko-bundled-features/cap-counter",
    exportName: "capCounterFeature",
    callExpression: "capCounterFeature",
  },
  "step-dispatcher": {
    name: "step-dispatcher",
    importPath: "@cosmicdrift/kumiko-bundled-features/step-dispatcher",
    exportName: "createStepDispatcherFeature",
    callExpression: "createStepDispatcherFeature()",
  },

  // --- Storage ---
  files: {
    name: "files",
    importPath: "@cosmicdrift/kumiko-bundled-features/files",
    exportName: "createFilesFeature",
    callExpression: "createFilesFeature()",
  },
  "file-foundation": {
    name: "file-foundation",
    importPath: "@cosmicdrift/kumiko-bundled-features/file-foundation",
    exportName: "fileFoundationFeature",
    callExpression: "fileFoundationFeature",
  },
  "file-provider-inmemory": {
    name: "file-provider-inmemory",
    importPath: "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory",
    exportName: "fileProviderInMemoryFeature",
    callExpression: "fileProviderInMemoryFeature",
  },

  // --- Notifications ---
  delivery: {
    name: "delivery",
    importPath: "@cosmicdrift/kumiko-bundled-features/delivery",
    exportName: "createDeliveryFeature",
    callExpression: "createDeliveryFeature()",
  },
  "mail-foundation": {
    name: "mail-foundation",
    importPath: "@cosmicdrift/kumiko-bundled-features/mail-foundation",
    exportName: "mailFoundationFeature",
    callExpression: "mailFoundationFeature",
  },
  "mail-transport-inmemory": {
    name: "mail-transport-inmemory",
    importPath: "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory",
    exportName: "mailTransportInMemoryFeature",
    callExpression: "mailTransportInMemoryFeature",
  },
  "mail-transport-smtp": {
    name: "mail-transport-smtp",
    importPath: "@cosmicdrift/kumiko-bundled-features/mail-transport-smtp",
    exportName: "mailTransportSmtpFeature",
    callExpression: "mailTransportSmtpFeature",
  },
  "channel-in-app": {
    name: "channel-in-app",
    importPath: "@cosmicdrift/kumiko-bundled-features/channel-in-app",
    exportName: "createChannelInAppFeature",
    callExpression: "createChannelInAppFeature()",
  },
  "renderer-foundation": {
    name: "renderer-foundation",
    importPath: "@cosmicdrift/kumiko-bundled-features/renderer-foundation",
    exportName: "createRendererFoundationFeature",
    callExpression: "createRendererFoundationFeature()",
  },
  "renderer-simple": {
    name: "renderer-simple",
    importPath: "@cosmicdrift/kumiko-bundled-features/renderer-simple",
    exportName: "createRendererSimpleFeature",
    callExpression: "createRendererSimpleFeature()",
  },
  "template-resolver": {
    name: "template-resolver",
    importPath: "@cosmicdrift/kumiko-bundled-features/template-resolver",
    exportName: "createTemplateResolverFeature",
    callExpression: "createTemplateResolverFeature()",
  },

  // --- Billing ---
  "billing-foundation": {
    name: "billing-foundation",
    importPath: "@cosmicdrift/kumiko-bundled-features/billing-foundation",
    exportName: "billingFoundationFeature",
    callExpression: "billingFoundationFeature",
  },

  // --- Compliance ---
  audit: {
    name: "audit",
    importPath: "@cosmicdrift/kumiko-bundled-features/audit",
    exportName: "createAuditFeature",
    callExpression: "createAuditFeature()",
  },
  "compliance-profiles": {
    name: "compliance-profiles",
    importPath: "@cosmicdrift/kumiko-bundled-features/compliance-profiles",
    exportName: "createComplianceProfilesFeature",
    callExpression: "createComplianceProfilesFeature()",
  },
  "data-retention": {
    name: "data-retention",
    importPath: "@cosmicdrift/kumiko-bundled-features/data-retention",
    exportName: "createDataRetentionFeature",
    callExpression: "createDataRetentionFeature()",
  },
  "user-data-rights": {
    name: "user-data-rights",
    importPath: "@cosmicdrift/kumiko-bundled-features/user-data-rights",
    exportName: "createUserDataRightsFeature",
    callExpression: "createUserDataRightsFeature()",
  },
  "user-data-rights-defaults": {
    name: "user-data-rights-defaults",
    importPath: "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults",
    exportName: "createUserDataRightsDefaultsFeature",
    callExpression: "createUserDataRightsDefaultsFeature()",
  },

  // --- Operations ---
  "feature-toggles": {
    name: "feature-toggles",
    importPath: "@cosmicdrift/kumiko-bundled-features/feature-toggles",
    exportName: "createFeatureTogglesFeature",
    callExpression: "createFeatureTogglesFeature()",
  },
  jobs: {
    name: "jobs",
    importPath: "@cosmicdrift/kumiko-bundled-features/jobs",
    exportName: "createJobsFeature",
    callExpression: "createJobsFeature()",
  },
  "rate-limiting": {
    name: "rate-limiting",
    importPath: "@cosmicdrift/kumiko-bundled-features/rate-limiting",
    exportName: "createRateLimitingFeature",
    callExpression: "createRateLimitingFeature()",
  },
  readiness: {
    name: "readiness",
    importPath: "@cosmicdrift/kumiko-bundled-features/readiness",
    exportName: "readinessFeature",
    callExpression: "readinessFeature",
  },

  // --- Content ---
  "text-content": {
    name: "text-content",
    importPath: "@cosmicdrift/kumiko-bundled-features/text-content",
    exportName: "createTextContentFeature",
    callExpression: "createTextContentFeature()",
  },
  "legal-pages": {
    name: "legal-pages",
    importPath: "@cosmicdrift/kumiko-bundled-features/legal-pages",
    exportName: "createLegalPagesFeature",
    callExpression: "createLegalPagesFeature()",
  },

  // --- Data ---
  tags: {
    name: "tags",
    importPath: "@cosmicdrift/kumiko-bundled-features/tags",
    exportName: "tagsFeature",
    callExpression: "tagsFeature",
  },
  "custom-fields": {
    name: "custom-fields",
    importPath: "@cosmicdrift/kumiko-bundled-features/custom-fields",
    exportName: "customFieldsFeature",
    callExpression: "customFieldsFeature",
  },
};

export function isPickable(featureName: string): boolean {
  return Object.hasOwn(FEATURE_CONSTRUCTORS, featureName);
}
