// File-provider resolution — lives in the framework so the upload routes,
// `ctx.files`, AND the GDPR export/forget jobs resolve their FileStorageProvider
// through ONE path. Divergence (uploads writing one store, erasure deleting
// another) is structurally impossible: there is a single resolver.
//
// The framework owns the resolution but NOT the storage backends. The
// `fileProvider` extension point + the per-tenant `provider` config key are
// declared by the `file-foundation` bundled feature; the concrete stores live
// in `file-provider-*` plugins. The framework only consumes what features
// registered in the registry — it never imports bundled-features upward.
//
// file-foundation re-exports `createFileProviderForTenant` + the plugin types
// (moved here from there) so existing imports keep working.

import type { DbConnection } from "../db/connection";
import type { TenantDb } from "../db/tenant-db";
import { EXT_FILE_PROVIDER, FILE_PROVIDER_CONFIG_KEY } from "../engine/extension-names";
import { SYSTEM_USER_ID } from "../engine/system-user";
import type { ConfigAccessor, ConfigAccessorFactory, Registry, TenantId } from "../engine/types";
import type { SecretsContext } from "../secrets";
import type { FileStorageProvider } from "./types";

const FEATURE_NAME = "file-foundation";

/**
 * Schmaler Surface-Type fuer Provider-Plugins. HandlerContext ist zu fett
 * (haelt tx, actor, signal etc.) — Provider sollen sich auf die read-Felder
 * beschraenken die fuer Tenant-Config + Secret-Lookup gebraucht werden.
 *
 * **Warum nicht voller HandlerContext?** Im Worker-Pfad (r.job) gibt es keinen
 * request-bezogenen `tx`/`actor`/`signal`. Wenn ein Provider `ctx.tx` lesen
 * wuerde, wuerde der ganze Worker-Pfad zur Runtime brechen — und das wuerde NUR
 * mit S3 und nur in production auffallen. Die schmale Surface zwingt Provider
 * zur expliziten Erweiterung statt silent ctx-feld-ausnutzen.
 *
 * **Felder:**
 *   config  — fuer tenant-config-reads (bucket/region/endpoint/...)
 *   registry — fuer extension-Lookup in der Factory (nicht Plugin-intern)
 *   secrets — fuer tenant-secret-reads (s3.secretAccessKey)
 *   _userId — Audit-/Authority-Identity fuer secret-reads. Der Framework-
 *             Resolver setzt das auf SYSTEM_USER_ID — der s3-Provider liest
 *             `s3.secretAccessKey`, was Nicht-Admin-Request-User nicht duerfen;
 *             die Request-User-Autorisierung bleibt am Route-accessGuard.
 */
export type FileProviderContext = {
  readonly config?: ConfigAccessor;
  readonly registry?: Registry;
  readonly secrets?: SecretsContext;
  readonly _userId?: string | undefined;
};

/**
 * File-Storage-Plugin contract. Each provider-feature (file-provider-s3,
 * file-provider-inmemory, ...) registers an implementation via
 * `r.useExtension(EXT_FILE_PROVIDER, "<name>", { build })`.
 *
 * **Plugin-Author-Warnung:** `ctx` ist EXPLIZIT ein FileProviderContext, nicht
 * ein voller HandlerContext. Felder ausserhalb der schmalen Surface (z.B.
 * `ctx.tx`, `ctx.actor`, `ctx.signal`) sind im Worker-Pfad NICHT vorhanden.
 * Cast `ctx as unknown as HandlerContext` fliegt zur Runtime im Worker — der
 * Crash kommt erst in production mit dem ersten S3-Tenant. Braucht ein Plugin
 * Felder ausserhalb FileProviderContext: lieber FileProviderContext explizit
 * erweitern (sichtbarer breaking change) als ctx-cast.
 */
export type FileProviderPlugin = {
  readonly build: (ctx: FileProviderContext, tenantId: string) => Promise<FileStorageProvider>;
};

// extension-usage `options` is engine-payload (unknown) — structurally validate
// instead of casting blind.
export function isFileProviderPlugin(o: unknown): o is FileProviderPlugin {
  return typeof o === "object" && o !== null && "build" in o && typeof o.build === "function";
}

// Looks up the per-tenant selected provider plugin + delegates to its build().
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

  const raw = await ctxConfig(FILE_PROVIDER_CONFIG_KEY);
  const provider = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  if (provider.length === 0) {
    const usages = ctx.registry.getExtensionUsages(EXT_FILE_PROVIDER);
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: no provider selected — set the '${FILE_PROVIDER_CONFIG_KEY}' config-key to one of: ${known}. ` +
        `Mount a file-provider-* feature first if no plugins are registered.`,
    );
  }

  const usages = ctx.registry.getExtensionUsages(EXT_FILE_PROVIDER);
  const usage = usages.find((u) => u.entityName === provider);
  if (!usage) {
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: provider "${provider}" not registered. Known: ${known}. ` +
        `Mount the matching file-provider-${provider} feature.`,
    );
  }

  if (!isFileProviderPlugin(usage.options)) {
    throw new Error(
      `${FEATURE_NAME}: provider "${provider}" registered without a build() — ` +
        `extension options must be a FileProviderPlugin.`,
    );
  }
  return usage.options.build(ctx, tenantId);
}

// A bound, per-tenant provider resolver. One instance serves all tenants
// (tenantId is the call argument) — the single spine shared by upload routes,
// ctx.files and the GDPR jobs.
export type FileProviderResolver = (tenantId: TenantId) => Promise<FileStorageProvider>;

export type FileProviderResolverDeps = {
  readonly registry?: Registry;
  readonly _configAccessorFactory?: ConfigAccessorFactory;
  readonly secrets?: SecretsContext;
  readonly db?: DbConnection | TenantDb;
};

// Builds the resolver from the ambient AppContext fields — the framework-side
// equivalent of the GDPR `makeTenantStorageProviderResolver`. The config
// accessor (and therefore the s3.secretAccessKey secret-read) runs under
// SYSTEM identity: provider construction is an infra read, distinct from the
// request user's authorization which stays at the route accessGuard.
export function makeFileProviderResolver(deps: FileProviderResolverDeps): FileProviderResolver {
  return async (tenantId) => {
    if (!deps.registry || !deps._configAccessorFactory || !deps.db) {
      throw new Error(
        "makeFileProviderResolver: registry/_configAccessorFactory/db missing — " +
          "mount the config + file-foundation features and wire context.db",
      );
    }
    const config = deps._configAccessorFactory({
      user: { id: SYSTEM_USER_ID, tenantId },
      db: deps.db,
      secrets: deps.secrets,
    });
    return createFileProviderForTenant(
      { config, registry: deps.registry, secrets: deps.secrets, _userId: SYSTEM_USER_ID },
      tenantId,
    );
  };
}
