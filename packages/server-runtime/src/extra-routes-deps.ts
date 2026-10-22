import type { SystemDispatchArgs } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import type { MetricsHandle } from "@cosmicdrift/kumiko-framework/observability";
import type { EnvelopeCipher, MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import type { Redis } from "ioredis";

export type { SystemDispatchArgs } from "@cosmicdrift/kumiko-framework/api";
// Re-export the SystemAdmin write/query builders — the single source of
// truth lives in framework/api next to buildServer's own `extraRoutes`
// mount so the two never drift on how the SystemAdmin identity is built.
export {
  makeDispatchSystemQuery,
  makeDispatchSystemWrite,
} from "@cosmicdrift/kumiko-framework/api";
export { makeFilesForTenant } from "./files-for-tenant.ts";

/** Deps for the `wire` hook (runProdApp/createKumikoServer, after
 *  buildServer has mounted `extraRoutes`) and
 *  for `runWorkerApp.wireComponents`. Naming: `deps` not `ctx` because
 *  `ctx` is the framework's HandlerContext (user/tenant/registry) — this
 *  scope is deliberately smaller and has NO `app` (routes are declared via
 *  `extraRoutes`, not wired here). */
export type SystemWireDeps = {
  readonly db: DbConnection;
  readonly redis: Redis;
  /** Feature-registry — e.g. for plugin-lookups via
   *  `registry.getExtensionUsages("subscriptionProvider")`. */
  readonly registry: Registry;
  /** File context of a tenant's storage; undefined when no file storage is mounted. Required so a consumer cannot lose attachment reading by omission. */
  readonly filesForTenant: (tenantId: string) => FileContext | undefined;
  /** The boot's master key keyring; absent when no `KUMIKO_SECRETS_MASTER_KEY_V<n>` is set. */
  readonly masterKeyProvider?: MasterKeyProvider;
  /** Cipher for `encrypted: true` config keys, same instance and DEK cache as the handlers use. */
  readonly configEncryption?: EnvelopeCipher;
  /** Same contract as `ctx.metricsFor`: unregistered metric names no-op. */
  readonly metricsFor: (featureName: string) => MetricsHandle;
  /** Writes through the /api/*-command-dispatcher (same idempotency/job
   *  hooks) as an auto-constructed SystemAdmin of the target tenant,
   *  WITHOUT the route's own access-check. Privilege-scope: SystemAdmin is
   *  the highest non-tenant-scoped role — reaches ANY SystemAdmin-gated
   *  handler on ANY tenant; the role-set is not configurable. Only for
   *  co-running components that already proved their own authenticity
   *  (e.g. an IMAP supervisor authenticated against its own mailbox). */
  readonly dispatchSystemWrite: (args: {
    readonly handlerQn: string;
    readonly payload: unknown;
    readonly tenantId: import("@cosmicdrift/kumiko-framework/engine").TenantId;
  }) => Promise<WriteResult>;
  /** Read counterpart of dispatchSystemWrite, same SystemAdmin scope. Hand
   *  anonymous routes only a narrow function built from it, never this. */
  readonly dispatchSystemQuery: (args: SystemDispatchArgs) => Promise<unknown>;
};
