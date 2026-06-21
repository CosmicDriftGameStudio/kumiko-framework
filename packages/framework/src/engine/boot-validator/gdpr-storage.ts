import type { FeatureDefinition } from "../types";

// Providers whose bytes do not survive a process restart. Only "inmemory"
// today; extend if another ephemeral bundled provider lands.
const EPHEMERAL_PROVIDERS: ReadonlySet<string> = new Set(["inmemory"]);

// Env vars file-provider-s3-env reads (see files-provider-s3/env-helper).
// Missing any → createS3ProviderFromEnv throws on the first file op.
const S3_ENV_REQUIRED = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

// Cross-feature GDPR storage guard (V1). Catches the failure class we shipped
// to prod: user-data-rights mounted but exports land in an ephemeral / missing
// store (lost on restart → the download 500s), and — once s3-env is the GDPR
// store — its env vars unset (the provider throws lazily on the first export
// inside the cron instead of failing loud at boot).
//
// Registry-only signal: validateBoot can't see the app's effective `provider`
// config-override, so it reasons from the registered fileProvider plugins. A
// false negative is possible (mount a persistent provider, then override the
// config back to inmemory) — accepted; the common shape (no persistent store)
// is caught, and this is a WARN, not a hard gate.
export function validateGdprStoragePersistence(features: readonly FeatureDefinition[]): void {
  const featureNames = new Set(features.map((f) => f.name));
  if (!featureNames.has("user-data-rights")) {
    // skip: this guard only applies to apps that mount user-data-rights
    return;
  }

  const registeredProviders = new Set<string>();
  for (const f of features) {
    for (const usage of f.extensionUsages) {
      if (usage.extensionName === "fileProvider") registeredProviders.add(usage.entityName);
    }
  }

  const persistent = [...registeredProviders].filter((p) => !EPHEMERAL_PROVIDERS.has(p));

  if (persistent.length === 0) {
    // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
    console.warn(
      "[kumiko:boot] user-data-rights is mounted but no persistent file provider is — GDPR exports use an ephemeral/in-memory store and are LOST on restart (the download then 500s). Mount file-provider-s3 or file-provider-s3-env and select it via the file-foundation provider config.",
    );
    // skip: ephemeral store already warned; the s3-env env-var check below is moot
    return;
  }

  // s3-env is the sole persistent store → it's the effective GDPR store. Its
  // credentials come from env; a missing var only surfaces at the first file op
  // (inside the export cron). Surface it at boot instead.
  if (persistent.length === 1 && persistent[0] === "s3-env") {
    const missing = S3_ENV_REQUIRED.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
      console.warn(
        `[kumiko:boot] file-provider-s3-env is the GDPR file store but these env vars are unset: ${missing.join(", ")}. The provider throws on the first export (inside the cron), not here — set them so GDPR storage works.`,
      );
    }
  }
}
