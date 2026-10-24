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

import type { CacheSyncBus } from "@cosmicdrift/kumiko-types/cache-sync-types";
import type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { DbConnection } from "../db/connection.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import {
  EXT_FILE_PROVIDER,
  FILE_PROVIDER_CONFIG_KEY,
  FILE_STORAGE_PROVIDER_BOOT_SENTINEL,
} from "../engine/extension-names.ts";
import { SYSTEM_USER_ID } from "../engine/system-user.ts";
import type { ConfigAccessor, ConfigAccessorFactory, Registry } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { CACHE_SYNC_TOPICS, isTenantConfigSyncMessage } from "../redis/cache-sync-topics.ts";
import type { SecretsContext } from "../secrets/index.ts";
import type { FileStorageProvider } from "./types.ts";
import { withUploadLedger } from "./upload-ledger.ts";

const FEATURE_NAME = "file-foundation";

/**
 * Narrow surface type for provider plugins. HandlerContext carries tx, actor,
 * signal and more; providers only get the read fields needed for tenant config
 * and secret lookup.
 *
 * **Why not the full HandlerContext?** On the worker path (r.job) there is no
 * request-bound `tx`/`actor`/`signal`. A provider reading `ctx.tx` would break
 * the whole worker path at runtime, and that would only show up with S3 in
 * production. The narrow surface forces providers to extend it explicitly
 * instead of quietly relying on extra ctx fields.
 *
 * **Fields:**
 *   config      — tenant config reads (bucket/region/endpoint/...)
 *   registry    — extension lookup in the factory (not plugin-internal)
 *   secrets     — tenant secret reads (s3.secretAccessKey)
 *   auditUserId — audit and authority identity for secret reads. The framework
 *                 resolver sets SYSTEM_USER_ID because the s3 provider reads
 *                 `s3.secretAccessKey`, which non-admin request users may not;
 *                 request-user authorization stays on the route accessGuard.
 */
export type FileProviderContext = {
  readonly config?: ConfigAccessor;
  readonly registry?: Registry;
  readonly secrets?: SecretsContext;
  readonly auditUserId?: string | undefined;
};

/**
 * File-Storage-Plugin contract. Each provider-feature (file-provider-s3,
 * file-provider-inmemory, ...) registers an implementation via
 * `r.useExtension(EXT_FILE_PROVIDER, "<name>", { build })`.
 *
 * **Plugin-Author-Warning:** `ctx` is EXPLICITLY a FileProviderContext, not
 * a full HandlerContext. Fields outside the narrow surface (e.g.
 * `ctx.tx`, `ctx.actor`, `ctx.signal`) are NOT available on the worker path.
 * Casting `ctx as unknown as HandlerContext` fails at runtime on the worker —
 * the crash only appears in production with the first S3 tenant. If a plugin
 * needs fields outside FileProviderContext, extend FileProviderContext
 * explicitly (a visible breaking change) rather than casting `ctx`.
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
  // The boot-gate placeholder names no plugin: treated as a provider name it
  // would let FILE_STORAGE_PROVIDER=configured fake a selection through the
  // ENV bridge.
  if (provider.length === 0 || provider === FILE_STORAGE_PROVIDER_BOOT_SENTINEL) {
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
  const built = await usage.options.build(ctx, tenantId);
  // Extension payloads are never type-checked, so a plugin predating a
  // required method (list) would otherwise surface as a misleading
  // "missing s3:ListBucket permission" hint during erasure.
  for (const method of REQUIRED_PROVIDER_METHODS) {
    if (typeof built[method] !== "function") {
      throw new Error(
        `${FEATURE_NAME}: provider "${provider}" built without the required method ${method}() — ` +
          `update the file-provider plugin to the current FileStorageProvider contract.`,
      );
    }
  }
  return built;
}

const REQUIRED_PROVIDER_METHODS = [
  "write",
  "writeStream",
  "read",
  "readStream",
  "delete",
  "exists",
  "list",
] as const satisfies readonly (keyof FileStorageProvider)[];

export type { FileProviderResolver } from "@cosmicdrift/kumiko-types/file-provider-resolver-types";

export type FileProviderResolverDeps = {
  readonly registry?: Registry;
  readonly configAccessorFactory?: ConfigAccessorFactory;
  readonly secrets?: SecretsContext;
  readonly db?: DbConnection | TenantDb;
  // Config/secret writes on other pods drop the cached provider; subscriptions live as long as the bus.
  readonly cacheSync?: CacheSyncBus;
  // Same source as ctx.tz, so ledger timestamps and the sweep cutoff agree under an injected clock.
  readonly now?: () => Temporal.Instant;
};

// Builds the resolver from the ambient AppContext fields — the framework-side
// equivalent of the GDPR `makeTenantStorageProviderResolver`. The config
// accessor (and therefore the s3.secretAccessKey secret-read) runs under
// SYSTEM identity: provider construction is an infra read, distinct from the
// request user's authorization which stays at the route accessGuard.
export function makeFileProviderResolver(deps: FileProviderResolverDeps): FileProviderResolver {
  // Per-tenant cache (698/2) — without it, every resolveProvider(tenantId)
  // call re-reads config + secrets from the DB, even though the provider is
  // effectively static per tenant for the process lifetime. A rejected
  // promise is evicted so a transient failure (or a secret genuinely not
  // configured yet) doesn't permanently poison this tenant's entry.
  const cache = new Map<string, Promise<FileStorageProvider>>();
  deps.cacheSync?.subscribe(CACHE_SYNC_TOPICS.tenantConfig, (message) => {
    // skip: malformed message from another process
    if (!isTenantConfigSyncMessage(message)) return;
    if ("scope" in message || message.tenantId === SYSTEM_TENANT_ID) cache.clear();
    else cache.delete(message.tenantId);
  });
  deps.cacheSync?.onResync(() => cache.clear());
  const resolveProvider = (tenantId: TenantId): Promise<FileStorageProvider> => {
    const cached = cache.get(tenantId);
    if (cached) return cached;
    const built = (async () => {
      if (!deps.registry || !deps.configAccessorFactory || !deps.db) {
        throw new Error(
          "makeFileProviderResolver: registry/configAccessorFactory/db missing — " +
            "mount the config + file-foundation features and wire context.db",
        );
      }
      const config = deps.configAccessorFactory({
        user: { id: SYSTEM_USER_ID, tenantId },
        db: deps.db,
        secrets: deps.secrets,
      });
      return createFileProviderForTenant(
        { config, registry: deps.registry, secrets: deps.secrets, auditUserId: SYSTEM_USER_ID },
        tenantId,
      );
    })();
    built.catch(() => {
      if (cache.get(tenantId) === built) cache.delete(tenantId);
    });
    cache.set(tenantId, built);
    return built;
  };
  return deps.db ? withUploadLedger(resolveProvider, deps.db, deps.now) : resolveProvider;
}
