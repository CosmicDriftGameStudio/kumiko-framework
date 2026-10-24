import type { Redis } from "ioredis";
import type { CacheSyncBus } from "./cache-sync-types.ts";
import type { ConfigAccessor, ConfigResolver } from "./config.ts";
import type { DerivativesContext } from "./derivatives-types.ts";
import type { EntityCache } from "./entity-cache.ts";
import type { EnvelopeCipher } from "./envelope-cipher-types.ts";
import type { FileContext } from "./file-handle-types.ts";
import type { FileProviderResolver } from "./file-provider-resolver-types.ts";
import type {
  EscapeHatchAuditSink,
  JobRunnerRef,
  NotifyFactory,
  NotifyFn,
  SessionUser,
  TenantWriteTarget,
} from "./handlers.ts";
import type { TenantId } from "./identifiers.ts";
import type { KmsAdapter } from "./kms-adapter-types.ts";
import type { RateLimitResolver } from "./rate-limit-types.ts";
import type { SearchAdapter } from "./search-adapter.ts";
import type { MasterKeyProvider, SecretsContext } from "./secrets-types.ts";

/**
 * Infrastructure the app wired at boot, as the handler or job sees it. extraContext keys the
 * framework does not know land in `extensions`.
 */
export type ContextServices = {
  readonly redis?: Redis;
  // Cross-process cache invalidation. Absent in contexts without a bus; callers treat that as "local only".
  readonly cacheSync?: CacheSyncBus;
  readonly jobRunner?: JobRunnerRef;
  readonly searchAdapter?: SearchAdapter;
  readonly entityCache?: EntityCache;
  // Tenant-scoped secrets accessor. Present when the app wired a MasterKeyProvider at boot.
  // Secret<string> carries the brand that the response guard rejects on serialization.
  readonly secrets?: SecretsContext;
  // Subject-key adapter for crypto-shredding (GDPR Art. 17). Absent = crypto-shredding not enabled.
  readonly kms?: KmsAdapter;
  // Binary storage, built per call and bound to the caller's tenant from `_fileProviderResolver`.
  readonly files?: FileContext;
  // Derive-on-first-use variants (thumbnails, resized images) of a tracked FileRef. Present whenever `files` resolves.
  readonly derivatives?: DerivativesContext;
  readonly configResolver?: ConfigResolver;
  // Encryption round-trip partner for the config feature; the set handler encrypts, the resolver decrypts.
  readonly configEncryption?: EnvelopeCipher;
  // Wired when the `rate-limiting` feature is loaded; handlers with rateLimit set are rejected at boot without it.
  readonly rateLimit?: RateLimitResolver;
  // Effective feature-toggle resolver, per tenant. Absent = all features on.
  readonly effectiveFeatures?: (tenantId: TenantId) => ReadonlySet<string>;
  // Raw KEK provider, present alongside `secrets`; the rotation job processes rows system-wide.
  readonly masterKeyProvider?: MasterKeyProvider;
  // Boot-built, per-tenant file-provider resolver; the dispatcher materialises `files` from it.
  readonly _fileProviderResolver?: FileProviderResolver;
  readonly _notifyFactory?: NotifyFactory;
  // Set inside a write transaction: _notifyFactory bound to the outside-tx pool, for building a notify for another user or tenant (seed hooks).
  readonly _notifyInTransactionFactory?: (user: SessionUser, tenantId: TenantId) => NotifyFn;
  // _notifyFactory bound for post-commit delivery of a notify built for another user or tenant (seed hooks).
  readonly _notifyAfterCommitFactory?: (user: SessionUser, tenantId: TenantId) => NotifyFn;
  // Wired when the `audit` feature is mounted; absent means a structured warn log.
  readonly _escapeHatchAuditSink?: EscapeHatchAuditSink;
  // extraContext keys the framework does not know (templateResolver, app provisioners, ...).
  readonly extensions: Readonly<Record<string, unknown>>;
};

export type HandlerLifecycle = {
  /**
   * Runs the registered `preSave` hooks (and system preSave hooks) for `handlerName` and returns
   * the hook-transformed `changes`. Entity CRUD handlers forward it to the executor; a custom
   * `r.writeHandler` that bypasses the executor must call it itself. Undefined when no lifecycle
   * pipeline is wired (bare stubs in unit tests).
   */
  readonly runPreSave?: (
    handlerName: string,
    changes: Record<string, unknown>,
    previous: Readonly<Record<string, unknown>>,
    isNew: boolean,
  ) => Promise<Record<string, unknown>>;
  /**
   * Queues a side-effect to run after the outermost write transaction commits (same sink as
   * ctx.dispatch.write). Absent outside a write pipeline; callers fall back to firing immediately.
   */
  readonly afterCommit?: (hook: () => Promise<void>) => void;
  /**
   * Runs when the handler transaction (or enclosing savepoint) does not commit, also after a failed
   * COMMIT of unknown outcome, so write it idempotent and outcome-safe. Present only inside a
   * transaction scope.
   */
  readonly afterRollback?: (hook: () => Promise<void>) => void;
  /**
   * Cancellation. Aborts when the HTTP client disconnects. Undefined for non-HTTP entry points
   * (jobs, MSP-applies). Long-running handlers throw `signal.throwIfAborted()` at chunk boundaries.
   */
  readonly signal?: AbortSignal;
};

export type JobLifecycle = Pick<HandlerLifecycle, "signal">;

export type HandlerTenants = {
  /**
   * Config accessor resolved for ANOTHER tenant, identity = that tenant's system user. Cross-tenant
   * calls throw AccessDeniedError unless the caller is a system identity or has the SystemAdmin
   * role; the caller's own tenant needs no privilege. Present when the config feature wired its
   * accessor factory.
   */
  readonly config?: (tenantId: TenantId) => ConfigAccessor;
  /**
   * Write target for ANOTHER tenant: a tenant-mode db bound to it plus the `streamTenantId` to hand
   * the executor, so the event actor stays the operator. Cross-tenant calls throw AccessDeniedError
   * unless the caller is SystemAdmin; the caller's own tenant yields `streamTenantId: undefined`.
   * Write handlers only; absent for r.systemScope() handlers and without a db.
   */
  readonly writeTarget?: (tenantId: TenantId) => TenantWriteTarget;
};
