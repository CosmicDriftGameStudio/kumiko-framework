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
  type ConfigAccessor,
  createTenantConfig,
  defineFeature,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";

const FEATURE_NAME = "file-foundation";

// =============================================================================
// Plugin-Interface — what a Provider-Plugin must implement
// =============================================================================

/**
 * Schmaler Surface-Type fuer Provider-Plugins. HandlerContext ist zu
 * fett (haelt tx, actor, signal etc.) — Provider sollen sich auf die
 * read-Felder beschraenken die fuer Tenant-Config + Secret-Lookup
 * gebraucht werden.
 *
 * **Warum nicht voller HandlerContext?** Im Worker-Pfad (r.job) gibt
 * es keinen request-bezogenen `tx`/`actor`/`signal`. Wenn ein Provider
 * `ctx.tx` lesen wuerde, wuerde der ganze Worker-Pfad zur Runtime
 * brechen — und das wuerde NUR mit S3 und nur in production auffallen.
 * Die schmale Surface zwingt Provider zur expliziten Erweiterung
 * (extra-arg) statt silent ctx-feld-ausnutzen.
 *
 * **Felder:**
 *   config  — fuer tenant-config-reads (bucket/region/endpoint/...)
 *   registry — fuer extension-Lookup in der Factory (nicht Plugin-intern)
 *   secrets — fuer tenant-secret-reads (s3.secretAccessKey)
 *   _userId — Audit-Identity fuer secret-reads. Im Handler-Pfad setzt
 *             der dispatcher das auf die Caller-User-ID; im Worker-Pfad
 *             muss der r.job-Wrap das explizit auf eine System-Identity
 *             setzen (z.B. "system:user-data-rights:run-export-jobs").
 */
export type FileProviderContext = {
  readonly config?: ConfigAccessor;
  readonly registry?: Registry;
  readonly secrets?: import("@cosmicdrift/kumiko-framework/secrets").SecretsContext;
  readonly _userId?: string | undefined;
};

/**
 * File-Storage-Plugin contract. Each provider-feature (file-provider-s3,
 * file-provider-azure-blob, ...) registers an implementation via
 * `r.useExtension("fileProvider", "<name>", { build })`.
 *
 * **Plugin-Author-Warnung:** `ctx` ist EXPLIZIT ein FileProviderContext,
 * nicht ein voller HandlerContext. Felder ausserhalb der schmalen
 * Surface (z.B. `ctx.tx`, `ctx.actor`, `ctx.signal`, `ctx.notify`) sind
 * im Worker-Pfad (r.job-getriggerte Provider-Builds) NICHT vorhanden.
 * Cast `ctx as unknown as HandlerContext` macht den Compiler happy aber
 * fliegt zur Runtime im Worker — und der Crash kommt erst in production
 * mit dem ersten S3-Tenant. Wenn ein Plugin Felder braucht die nicht in
 * FileProviderContext sind: lieber FileProviderContext explizit erweitern
 * (sichtbarer breaking change) als ctx-cast.
 */
export type FileProviderPlugin = {
  readonly build: (ctx: FileProviderContext, tenantId: string) => Promise<FileStorageProvider>;
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
  ctx: FileProviderContext,
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
  ) as string; // @cast-boundary engine-payload
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
