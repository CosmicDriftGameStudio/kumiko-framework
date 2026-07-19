// kumiko-feature-version: 1
//
// file-foundation as a Kumiko bundled feature — declares the `fileProvider`
// extension point + the per-tenant `provider` config key. Provider RESOLUTION
// (createFileProviderForTenant) + the plugin types now live in the framework
// (packages/framework/src/files/provider-resolver.ts) so the upload routes,
// `ctx.files` and the GDPR jobs resolve through ONE path — uploads, export and
// erasure hit the same store by construction. This feature re-exports the moved
// symbols unchanged so existing imports keep working.
//
// **Pattern-Vorbild:** identisch zu `mail-foundation`. Foundation deklariert
// extension-point `fileProvider`, Provider-Features (file-provider-s3, -inmemory,
// -s3-env, später -gcs/-azure-blob) registrieren sich namentlich. Tenant wählt
// zur Runtime via config-key `provider`.
//
// **Boot-Dependencies:** config (für provider-selector). Kein secrets, weil
// Foundation selbst keine Secrets hält.

import {
  access,
  createTenantConfig,
  defineFeature,
  EXT_FILE_PROVIDER,
} from "@cosmicdrift/kumiko-framework/engine";

export type {
  FileProviderContext,
  FileProviderPlugin,
} from "@cosmicdrift/kumiko-framework/files";
// Moved into the framework — re-exported here so `@cosmicdrift/kumiko-bundled-
// features/file-foundation` consumers (user-data-rights, app code) keep working.
export {
  createFileProviderForTenant,
  isFileProviderPlugin,
} from "@cosmicdrift/kumiko-framework/files";

const FEATURE_NAME = "file-foundation";

export const fileFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Defines the `fileProvider` extension point and a per-tenant `provider` config key that selects which registered storage plugin to use at runtime. Call `createFileProviderForTenant(ctx, tenantId)` to get a `FileStorageProvider` — use this feature together with at least one `file-provider-*` feature; the `files` feature builds on top of it for tracked `FileRef` entities with GDPR hooks.",
  );
  r.uiHints({
    displayLabel: "File Provider Foundation",
    category: "storage",
    recommended: false,
  });
  r.requires("config");

  r.extendsRegistrar(EXT_FILE_PROVIDER, {
    onRegister: () => {
      // No side-effects at register-time — registry stores the usage,
      // factory looks it up at request-time.
    },
  });

  const providerConfigKey = r.config(
    "provider",
    createTenantConfig("text", {
      default: "",
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );
  // Readiness gating: provider-plugins' required keys/secrets count only
  // while their plugin is the one this key selects.
  r.extensionSelector(EXT_FILE_PROVIDER, providerConfigKey);

  return { providerConfigKey };
});
