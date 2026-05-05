// kumiko-feature-version: 1
//
// file-foundation as a Kumiko bundled feature — plugin-API shape.
//
// **Pattern-Vorbild:** identisch zu `mail-foundation`. Foundation
// deklariert extension-point `fileProvider`, Provider-Features (file-
// provider-s3, später file-provider-azure-blob, file-provider-gcs)
// registrieren sich namentlich. Tenant wählt zur Runtime via config-
// key `provider`.
//
// **Was diese Foundation NICHT mehr macht:**
//   - Keine S3-spezifischen Config-Keys mehr (bucket/region/endpoint/
//     forcePathStyle/accessKeyId) — die leben im Provider-Plugin.
//   - Kein direkter Import von `createS3Provider`. Foundation kennt
//     nur das `FileStorageProvider`-Interface (Type-Import, kein
//     runtime-coupling).
//
// **Standalone:** Foundation ist ohne tier-engine nutzbar. Existing
// `files-provider-s3` (App-wide-Library) bleibt unangetastet.
//
// **Boot-Dependencies:** config (für provider-selector). Kein secrets,
// weil Foundation selbst keine Secrets hält.

import { requireDefined } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  access,
  createTenantConfig,
  defineFeature,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";

const FEATURE_NAME = "file-foundation";

// =============================================================================
// Plugin-Interface — what a Provider-Plugin must implement
// =============================================================================

/**
 * File-Storage-Plugin contract. Each provider-feature (file-provider-s3,
 * file-provider-azure-blob, ...) registers an implementation via
 * `r.useExtension("fileProvider", "<name>", { build })`.
 */
export type FileProviderPlugin = {
  readonly build: (ctx: HandlerContext, tenantId: string) => Promise<FileStorageProvider>;
};

// =============================================================================
// Feature-definition
// =============================================================================

export const fileFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.requires("config");

  r.extendsRegistrar("fileProvider", {
    onRegister: () => {
      // No side-effects at register-time — registry stores the usage,
      // factory looks it up at request-time.
    },
  });

  const configKeys = r.config({
    keys: {
      provider: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin", "User"),
      }),
    },
  });

  return { configKeys };
});

// =============================================================================
// Provider-factory — looks up the registered plugin + delegates
// =============================================================================

export async function createFileProviderForTenant(
  ctx: HandlerContext,
  tenantId: string,
  handlerName = "file-foundation:provider-factory",
): Promise<FileStorageProvider> {
  const ctxConfig = ctx.config;
  if (!ctxConfig) {
    throw new Error(
      `${handlerName}: ctx.config is missing — feature requires the config-feature mounted in the registry`,
    );
  }
  if (!ctx.registry) {
    throw new Error(
      `${handlerName}: ctx.registry is missing — required to look up registered file-provider plugins`,
    );
  }

  const provider = requireDefined(
    await ctxConfig(fileFoundationFeature.exports.configKeys.provider),
    FEATURE_NAME,
    "provider",
  ) as string;
  if (provider.length === 0) {
    const usages = ctx.registry.getExtensionUsages("fileProvider");
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: no provider selected — set the 'provider' config-key to one of: ${known}. ` +
        `Mount a file-provider-* feature first if no plugins are registered.`,
    );
  }

  const usages = ctx.registry.getExtensionUsages("fileProvider");
  const usage = usages.find((u) => u.entityName === provider);
  if (!usage) {
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: provider "${provider}" not registered. Known: ${known}. ` +
        `Mount the matching file-provider-${provider} feature.`,
    );
  }

  // @cast-boundary engine-payload — extension-usage carries unknown options
  const plugin = usage.options as FileProviderPlugin;
  return plugin.build(ctx, tenantId);
}
