// Static map: feature.name (from the manifest) → ScaffoldFeatureEntry that
// scaffoldApp consumes to render run-config.ts imports + APP_FEATURES.
//
// One entry per bundled feature whose constructor takes zero required args
// (or only opts with defaults). Features requiring caller-supplied
// transports/providers (channel-email, channel-push, subscription-stripe,
// subscription-mollie, file-provider-s3, managed-pages, tier-engine) are
// intentionally absent — the picker hides them, the user wires them by
// hand after scaffold.

import type { ScaffoldFeatureEntry } from "@cosmicdrift/kumiko-dev-server";

function zeroArgEntry(name: string, exportName: string): ScaffoldFeatureEntry {
  return {
    name,
    importPath: `@cosmicdrift/kumiko-bundled-features/${name}`,
    exportName,
    callExpression: `${exportName}()`,
  };
}

export const FEATURE_CONSTRUCTORS: Readonly<Record<string, ScaffoldFeatureEntry>> = {
  // --- Identity ---
  tenant: zeroArgEntry("tenant", "createTenantFeature"),
  user: zeroArgEntry("user", "createUserFeature"),
  "auth-foundation": zeroArgEntry("auth-foundation", "createAuthFoundationFeature"),
  "personal-access-tokens": {
    name: "personal-access-tokens",
    importPath: "@cosmicdrift/kumiko-bundled-features/personal-access-tokens",
    exportName: "createPersonalAccessTokensFeature",
    callExpression: "createPersonalAccessTokensFeature({ scopes: {} })",
    callArgs: [{ scopes: {} }],
  },
  sessions: zeroArgEntry("sessions", "createSessionsFeature"),
  "auth-email-password": zeroArgEntry("auth-email-password", "createAuthEmailPasswordFeature"),
  // Only meaningful alongside auth.signup — composeFeatures auto-mounts it
  // when signup is set; listed so scaffolds can pick it explicitly.
  "auth-self-registration": {
    name: "auth-self-registration",
    importPath: "@cosmicdrift/kumiko-bundled-features/auth-email-password",
    exportName: "createAuthSelfRegistrationToggleFeature",
    callExpression: "createAuthSelfRegistrationToggleFeature()",
  },
  "user-profile": zeroArgEntry("user-profile", "createUserProfileFeature"),

  // --- Infrastructure ---
  config: zeroArgEntry("config", "createConfigFeature"),
  secrets: zeroArgEntry("secrets", "createSecretsFeature"),
  "cap-counter": zeroArgEntry("cap-counter", "createCapCounterFeature"),

  // --- Storage ---
  files: {
    name: "files",
    importPath: "@cosmicdrift/kumiko-framework/files",
    exportName: "createFilesFeature",
    callExpression: "createFilesFeature()",
  },
  "file-foundation": zeroArgEntry("file-foundation", "createFileFoundationFeature"),
  "file-provider-inmemory": zeroArgEntry(
    "file-provider-inmemory",
    "createFileProviderInMemoryFeature",
  ),

  // --- Notifications ---
  delivery: zeroArgEntry("delivery", "createDeliveryFeature"),
  "mail-foundation": zeroArgEntry("mail-foundation", "createMailFoundationFeature"),
  "mail-transport-inmemory": zeroArgEntry(
    "mail-transport-inmemory",
    "createMailTransportInMemoryFeature",
  ),
  "mail-transport-smtp": zeroArgEntry("mail-transport-smtp", "createMailTransportSmtpFeature"),
  "channel-in-app": zeroArgEntry("channel-in-app", "createChannelInAppFeature"),
  "renderer-foundation": zeroArgEntry("renderer-foundation", "createRendererFoundationFeature"),
  "template-resolver": zeroArgEntry("template-resolver", "createTemplateResolverFeature"),

  // --- Billing ---
  "billing-foundation": zeroArgEntry("billing-foundation", "createBillingFoundationFeature"),

  // --- Compliance ---
  audit: zeroArgEntry("audit", "createAuditFeature"),
  "compliance-profiles": zeroArgEntry("compliance-profiles", "createComplianceProfilesFeature"),
  "data-retention": zeroArgEntry("data-retention", "createDataRetentionFeature"),
  // Listing entry only (pickability, manifest checks); the scaffold renders
  // scaffoldEntryFor("user-data-rights", appName), which names the app.
  "user-data-rights": zeroArgEntry("user-data-rights", "createUserDataRightsFeature"),
  "user-data-rights-defaults": zeroArgEntry(
    "user-data-rights-defaults",
    "createUserDataRightsDefaultsFeature",
  ),

  // --- Operations ---
  "feature-toggles": zeroArgEntry("feature-toggles", "createFeatureTogglesFeature"),
  jobs: zeroArgEntry("jobs", "createJobsFeature"),
  "rate-limiting": zeroArgEntry("rate-limiting", "createRateLimitingFeature"),
  readiness: zeroArgEntry("readiness", "createReadinessFeature"),

  // --- Content ---
  "legal-pages": zeroArgEntry("legal-pages", "createLegalPagesFeature"),

  // --- Data ---
  "custom-fields": zeroArgEntry("custom-fields", "createCustomFieldsFeature"),
};

// The default GDPR mails need an app name as soon as a mail transport is
// mounted (boot rule user-data-rights/mail-app-name-missing), and the app name
// only exists per scaffold run.
function userDataRightsEntry(appName: string): ScaffoldFeatureEntry {
  return {
    name: "user-data-rights",
    importPath: "@cosmicdrift/kumiko-bundled-features/user-data-rights",
    exportName: "createUserDataRightsFeature",
    callExpression: userDataRightsCallExpression(JSON.stringify(appName)),
    callArgs: [{ mailDefaults: { appName } }],
  };
}

// The scaffolded app's Biome lineWidth (dev-server MAX_LINE_WIDTH); importing it
// would load the dev-server barrel on --help.
const SCAFFOLD_LINE_WIDTH = 100;

// Wrapped the way Biome prints it as an APP_FEATURES item (two-space indent,
// trailing comma), so a long app name still leaves run-config.ts lint-clean.
// App names are capped at 63 characters (they double as the k8s namespace),
// so the wrapped mailDefaults line always fits.
function userDataRightsCallExpression(appNameLiteral: string): string {
  const oneLine = `createUserDataRightsFeature({ mailDefaults: { appName: ${appNameLiteral} } })`;
  if (`  ${oneLine},`.length <= SCAFFOLD_LINE_WIDTH) return oneLine;
  return `createUserDataRightsFeature({\n    mailDefaults: { appName: ${appNameLiteral} },\n  })`;
}

export function scaffoldEntryFor(
  featureName: string,
  appName: string,
): ScaffoldFeatureEntry | undefined {
  if (featureName === "user-data-rights") return userDataRightsEntry(appName);
  return FEATURE_CONSTRUCTORS[featureName];
}

export function isPickable(featureName: string): boolean {
  return Object.hasOwn(FEATURE_CONSTRUCTORS, featureName);
}
