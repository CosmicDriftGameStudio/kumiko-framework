import { Hono, type MiddlewareHandler } from "hono";
import { ROLES } from "../auth/roles";
import type { DbConnection, PgClient } from "../db/connection";
import { createDerivativesContext } from "../derivatives/derivatives-context";
import { EXT_FILE_PROVIDER, EXT_PRINCIPAL_STATUS } from "../engine/extension-names";
import { runsInLane } from "../engine/run-in";
import { ANONYMOUS_ROLE, createAnonymousUser, createSystemUser } from "../engine/system-user";
import {
  type AppContext,
  type HttpRouteMethod,
  isFileField,
  type Registry,
  type RunIn,
  type TenantId,
  type WriteResult,
} from "../engine/types";
import { createFileContext } from "../files/file-handle";
import type { FileRoutesOptions } from "../files/file-routes";
import { createFileRoutes } from "../files/file-routes";
import { makeFileProviderResolver } from "../files/provider-resolver";
import type { Lifecycle } from "../lifecycle";
import {
  createNoopProvider,
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
  type ObservabilityOptions,
  type ObservabilityProvider,
  registerStandardMetrics,
  wrapRedisClient,
} from "../observability";
import { resolveTenantLifecyclePlugin } from "../pipeline/active-membership";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher, type Dispatcher } from "../pipeline/dispatcher";
import { SHARED_INSTANCE_SENTINEL } from "../pipeline/event-consumer-state";
import type { EventDedup } from "../pipeline/event-dedup";
import type { EventConsumer, EventDispatcher } from "../pipeline/event-dispatcher";
import { createEventDispatcher } from "../pipeline/event-dispatcher";
import { createLifecycleHooks, type SystemHooks } from "../pipeline/lifecycle-pipeline";
import { createMultiStreamApplyContext } from "../pipeline/multi-stream-apply-context";
import {
  createAccessInvalidationEventConsumer,
  createJobTriggerEventConsumer,
  createSearchEventConsumer,
  createSseBroadcastEventConsumer,
} from "../pipeline/system-hooks";
import {
  type AuthEndpointRateLimitOptions,
  authEndpointRateLimit,
  createRateLimitResolver,
  type GlobalIpRateLimitOptions,
  globalIpRateLimit,
} from "../rate-limit";
import { deriveSearchAdapterConfig } from "../search/derive-search-adapter-config";
import type { SearchAdapter } from "../search/types";
import { assertUnreachable, generateId } from "../utils";
import { NO_ROUTE_MATCH_HEADER_NAME, PUBLIC_API_PATHS } from "./api-constants";
import {
  type AnonymousAccessResolved,
  authMiddleware,
  getUser,
  type TenantLifecycleStatusResolver,
} from "./auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes, type LoginRateLimiter } from "./auth-routes";
import { csrfMiddleware } from "./csrf-middleware";
import {
  type ExtraRouteDefinition,
  ExtraRouteEntries,
  type ExtraRouteEntry,
  ExtraRouteRejection,
  type SystemDispatchArgs,
} from "./extra-route";
import { createJwtHelper, type JwtHelper, type JwtKeyring } from "./jwt";
import { observabilityMiddleware } from "./observability-middleware";
import { assertOriginGuardConfig, originMiddleware } from "./origin-middleware";
import { piiCiphertextResponseGuard } from "./pii-leak-guard";
import { createDefaultSseBroker, type RedisSseBroker } from "./redis-sse-broker";
import { requestContext } from "./request-context";
import { buildRequestContextData, requestIdMiddleware } from "./request-id-middleware";
import {
  DEFAULT_MAX_REQUEST_BYTES,
  registerBodyLimit,
  registerHealthRoutes,
  registerMetricsRoute,
  registerVersionRoute,
} from "./route-registrars";
import { createApiRoutes } from "./routes";
import type { SseBroker } from "./sse-broker";
import { createSseRoute } from "./sse-route";

export type ServerOptions = {
  registry: Registry;
  context: AppContext;
  jwtSecret: string | JwtKeyring;
  jwtIssuer?: string;
  // JWT lifetime in seconds. Explicit always wins. When omitted, the default
  // depends on `auth.sessionChecker`: wired (revocation possible) keeps the
  // long-lived 24h default; unwired (stateless JWTs, no revocation) drops to
  // 1h so a leaked stateless token has a much smaller exposure window.
  jwtTtl?: number;
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  systemHooks?: SystemHooks;
  eventDedup?: EventDedup;
  sseBroker?: SseBroker;
  auth?: AuthRoutesConfig;
  // No `files` option: file-storage is wired by mounting `file-foundation` +
  // a `file-provider-*` feature. Upload routes, ctx.files and the GDPR jobs
  // resolve the provider per-tenant through that single source (issue #608).
  // Upload-route policy (accessGuard/privilegedRoles/maxUploadSize) lives on
  // `createFilesFeature(opts?)`.
  // Async event-dispatcher config. The dispatcher is created automatically
  // when (a) context.db is a DbConnection AND (b) at least one consumer is
  // wired — SSE (iff sseBroker), Search (iff context.searchAdapter), or
  // feature-level r.multiStreamProjection consumers.
  //
  // Mirrors the old outboxPoller contract: `KumikoServer.eventDispatcher` is
  // created but NOT auto-started. Production boot must call `.start()`;
  // shutdown must call `.stop()`. Tests prefer `.runOnce()` for determinism
  // and skip `.start()` entirely.
  eventDispatcher?: {
    pollIntervalMs?: number;
    batchSize?: number;
    maxAttempts?: number;
    rearmCooldownMs?: number;
    maxRearmCount?: number;
    // Opt out of building the dispatcher even if consumers exist — e.g. ops
    // runs a dedicated dispatcher process, or a test needs to control the
    // consumer lifecycle manually.
    disabled?: boolean;
    // Opt out of the auto-built system consumers (SSE, Search, Job-Trigger)
    // while still running feature r.multiStreamProjection consumers. Useful
    // for tests that assert only on subscriber behaviour, or for a
    // deployment that routes SSE via a different transport. Default: sse/
    // search enabled when the respective dependency (sseBroker /
    // context.searchAdapter) is available; jobTrigger enabled when a
    // jobRunner is wired via dispatcherOptions.
    systemConsumers?: {
      sse?: boolean;
      search?: boolean;
      jobTrigger?: boolean;
      accessInvalidation?: boolean;
    };
    // Raw postgres.js client for LISTEN/NOTIFY wake-up (Sprint E.4). When
    // present, `.start()` subscribes to EVENTS_PUBSUB_CHANNEL — delivery
    // latency drops from pollIntervalMs to TCP-round-trip. The poll timer
    // stays on as a safety net. Typically wired from
    // `createDbConnection(url).client` so both Drizzle-queries and the
    // dispatcher share the same underlying postgres.js pool.
    pgClient?: PgClient;
  };
  // Observability: tracer + meter used for auto-instrumentation across
  // HTTP, dispatcher, pipeline, DB. Omitted => NoopProvider (zero overhead,
  // no spans or metrics emitted). Typically set to a ConsoleProvider in dev,
  // OTLPProvider in prod.
  observability?: ObservabilityProvider;
  observabilityOptions?: ObservabilityOptions;
  // L1/L2 rate-limit middleware. Both layers share the auto-wired
  // resolver (or `context.rateLimit` if you provided one). Layers are
  // independent — wire only what you need:
  //   - `global`: gates every /api/* request by client IP. Use behind
  //     Cloudflare-less deployments to absorb naive floods at the edge
  //     of the app process.
  //   - `auth`: gates a single path-pattern (default `/api/auth/*`)
  //     with tighter limits. Typically `limit: 5, windowSeconds: 60`
  //     to slow brute-force without breaking real users. GET /api/auth/tenants
  //     (session read, called on every page load) is always exempt — see
  //     AUTH_RATE_LIMIT_EXEMPT_ROUTES in api-constants.ts.
  // Both omitted → no L1/L2 wired and no resolver auto-built unless an
  // L3 handler declared `rateLimit:`. This keeps zero-cost when unused.
  rateLimit?: {
    readonly global?: Omit<GlobalIpRateLimitOptions, "resolver">;
    readonly auth?: Omit<AuthEndpointRateLimitOptions, "resolver"> & {
      // Path-pattern the L2 middleware applies to. Default `/api/auth/*`.
      // Override for apps with a different auth route layout. The
      // GET /api/auth/tenants exemption above applies regardless of `path`.
      readonly path?: string;
    };
  };
  // Hard cap on JSON request bodies in bytes. Applied to /api/write,
  // /api/batch, /api/query, /api/command and /api/auth/*. File uploads
  // (/api/files) are excluded — those have their own per-field maxSize.
  // `undefined` → 1 MB default. `0` disables the limit entirely (tests
  // or bespoke deployments with a reverse-proxy that caps upstream).
  maxRequestBytes?: number;
  // SSE heartbeat interval for POST /api/stream (ms). Omit → framework default.
  // Tune down behind proxies with aggressive idle timeouts.
  sseHeartbeatMs?: number;
  // Process lifecycle. When present:
  //   - GET /health/ready reflects lifecycle.state() (200 ready / 503 else)
  //   - eventDispatcher.stop() is auto-registered as a shutdown hook, so
  //     lifecycle.drain() tears the poller down without the caller wiring it
  // Production main.ts passes `createLifecycle()`; tests that don't care
  // about drain() orchestration omit this and /health/ready stays absent.
  lifecycle?: Lifecycle;
  // Prometheus-scrape endpoint. When set, `/metrics` returns the current
  // accumulated metric state in OpenMetrics text format. Requires the
  // configured `observability` to use a PrometheusMeter (duck-typed via
  // the `snapshot` method) — otherwise the route returns 503 with a
  // note about misconfiguration. The optional `token` enforces
  // `Authorization: Bearer <token>`; without a token set the endpoint
  // is open (fine inside a private cluster, dangerous on the public
  // internet). Omit this option entirely to skip the route.
  metrics?: {
    readonly token?: string;
    readonly path?: string; // default "/metrics"
  };
  // /health/ready depth. When lifecycle is wired, the readiness handler
  // ALSO runs dependency checks before returning 200:
  //   - DB ping (auto-wired when context.db is a DbConnection)
  //   - Redis PING (auto-wired when context.redis is set)
  //   - Dispatcher consumer-lag (opt-in via maxDispatcherLag — off by default
  //     because a default threshold would false-503 small deployments that
  //     legitimately lag during bursts)
  // Checks run in parallel with a per-check timeout; any failed check drops
  // the probe to 503 with a JSON body listing which check failed.
  readiness?: {
    readonly timeoutMs?: number;
    readonly maxDispatcherLag?: bigint;
  };
  // Which deploy-lane this process runs — drives MSP-consumer filtering.
  //   "api":    picks up MSPs with runIn in {api, both}.
  //   "worker": picks up MSPs with runIn in {worker, both, undefined (default)}.
  //   "both":   all-in-one, no filtering — every MSP runs here.
  // When omitted, defaults to "worker" — preserves pre-Welle-2.6 behaviour
  // (every MSP runs on the single dispatcher, wherever it lives).
  processLane?: RunIn;
  // Stable identifier for THIS process in the event-consumer state table.
  // Used as the `instance_id` on every per-instance consumer's cursor row
  // (Welle 2.7). Shared consumers ignore this and always write the reserved
  // sentinel. Default: `process.env.KUMIKO_INSTANCE_ID ?? generateId()`
  // — a fresh UUID at boot is fine for single-process deploys, but
  // multi-instance deploys SHOULD set KUMIKO_INSTANCE_ID to a stable
  // identifier (pod name, hostname) so ops can correlate lag metrics to
  // specific instances and can DELETE stale rows on scale-down. Must never
  // equal the sentinel; validator fails boot if it does.
  instanceId?: string;
  // Opt-in: serve unauthenticated requests on handlers that allow
  // roles=["anonymous"]. When omitted, every /api/* request still requires
  // a valid JWT (status quo). App-facing config is AnonymousAccessConfig
  // (defaultTenantId only); run{Prod,Dev}App merge auth-foundation tenant
  // providers into AnonymousAccessResolved before calling buildServer.
  anonymousAccess?: AnonymousAccessResolved;
  // Declarative HTTP routes outside the /api/write|query|batch pipeline that
  // still need the framework's dispatcher (webhooks, OAuth callbacks, admin
  // escape-hatches). Each entry declares its access tier (`entry`) up
  // front — buildServer wires the matching guard + deps, no handler gets a
  // raw db/redis. Mounted right after the r.httpRoute loop, before
  // registerVersionRoute (kumiko-framework#3050).
  extraRoutes?: readonly ExtraRouteDefinition[];
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
  observability: ObservabilityProvider;
  // The command-dispatcher behind /api/* — same idempotency/jobRunner/
  // lifecycle wiring as HTTP-dispatched writes. For dispatching outside
  // the HTTP pipeline, e.g. provider-webhook routes that authenticate
  // via signature instead of JWT (subscription-stripe et al.).
  dispatcher: Dispatcher;
  // Present when at least one consumer is wired and context.db is a
  // DbConnection. Caller owns the lifecycle: `.start()` in boot, `.stop()`
  // in shutdown. Tests drain via `.runOnce()` instead.
  eventDispatcher?: EventDispatcher;
  // Echoed back so the caller has a single handle for both the app and the
  // lifecycle. Only set when the caller passed one in.
  lifecycle?: Lifecycle;
  // The AppContext every handler on this server sees — options.context plus
  // what buildServer wires onto it (_fileProviderResolver, rateLimit, the
  // observability tracer/meter). Callers that build a second consumer of the
  // same registry outside this server (a dev-server's job-runners) must pass
  // THIS, not their own pre-buildServer literal, or that consumer reaches for
  // fields only the request path has (#1232).
  context: AppContext;
};

// The per-tenant file-provider resolver, built once for a registry+context so
// a job-runner and the server it runs beside share one instance (and one
// per-tenant provider cache). Mirrors buildServer's own resolution exactly —
// including NOT inventing a resolver when no `file-provider-*` plugin is
// mounted, which is what keeps buildServer's boot-guard below able to fire.
export function withFileProviderResolver(registry: Registry, context: AppContext): AppContext {
  if (context._fileProviderResolver !== undefined) return context;
  if (registry.getExtensionUsages(EXT_FILE_PROVIDER).length === 0) return context;
  return {
    ...context,
    _fileProviderResolver: makeFileProviderResolver({
      registry,
      _configAccessorFactory: context._configAccessorFactory,
      secrets: context.secrets,
      db: context.db,
    }),
  };
}

export function buildServer(options: ServerOptions): KumikoServer {
  // File-storage is resolved per-tenant through file-foundation: a mounted
  // `file-provider-*` plugin (inmemory/s3/s3-env) is the single source for
  // uploads, ctx.files and the GDPR jobs.
  const hasFileProvider = options.registry.getExtensionUsages(EXT_FILE_PROVIDER).length > 0;
  // A test/advanced caller may inject the resolver directly on the context
  // (e.g. a static in-memory provider) instead of mounting a provider plugin.
  const hasInjectedResolver = options.context._fileProviderResolver !== undefined;
  // Hard-fail when the registry declares file/image fields but no provider
  // plugin is mounted — uploads would otherwise fail at the first request
  // instead of at boot. Proves a plugin is mounted, not that each tenant
  // selected one; per-tenant misconfig surfaces via createFileProviderForTenant.
  if (registryDeclaresFileFields(options.registry) && !hasFileProvider && !hasInjectedResolver) {
    throw new Error(
      "Features declare file/image fields but no file-storage provider is mounted — " +
        "mount `file-foundation` + a `file-provider-*` feature (inmemory/s3/s3-env) and " +
        "select one per tenant via the 'file-foundation:config:provider' config-key.",
    );
  }

  // #2051 — a screen whose search box renders (kumiko-screen.tsx gates it on
  // `screen.searchable ?? entity-has-searchable-field`, the same condition
  // used below) sends `payload.search` on every query. Without a
  // context.searchAdapter that throws UnprocessableError at request time
  // (#2032) — surface the misconfig at boot instead of on the first search.
  // Warn, not throw: unlike missing file-storage (uploads always fail),
  // list screens still work without search: only the search box is broken.
  // Several deployed apps (offlot-app, publicstatus, kumiko-studio,
  // kumiko-enterprise) currently run in exactly this state.
  if (!options.context.searchAdapter) {
    const unwiredEntities = entitiesWithSearchableScreen(options.registry);
    if (unwiredEntities.length > 0) {
      console.warn(
        `[kumiko:boot] ${unwiredEntities.length} entit${unwiredEntities.length === 1 ? "y" : "ies"} ` +
          `have a searchable list screen but no SearchAdapter is wired on context.searchAdapter: ` +
          `${unwiredEntities.join(", ")}. Search requests against ${unwiredEntities.length === 1 ? "it" : "them"} will fail with a 422 (search_adapter_not_wired) at runtime. ` +
          "Wire a SearchAdapter (e.g. createMeilisearchAdapter) on context.searchAdapter, or remove `searchable: true` from the affected fields.",
      );
    }
  }

  // Stateless JWTs (no sessionChecker → no revocation) default to a shorter
  // TTL than session-backed ones, since a leaked stateless token can't be
  // revoked and stays valid until it expires. Explicit jwtTtl always wins.
  const defaultJwtTtl = options.auth?.sessionChecker ? 8 * 60 * 60 : 60 * 60;
  const jwt = createJwtHelper(
    options.jwtSecret,
    options.jwtIssuer,
    options.jwtTtl ?? defaultJwtTtl,
  );
  // An explicit ServerOptions.sseBroker always wins (caller owns its
  // lifecycle) — createDefaultSseBroker is the single decision point every
  // other caller must funnel through instead of picking a broker on its
  // own, so the REDIS_URL-gated cross-replica default (fw#2625) can't be
  // silently bypassed the way runProdApp bypassed it before this existed.
  let sseBroker: SseBroker;
  let ownedRedisSseBroker: RedisSseBroker | undefined;
  if (options.sseBroker) {
    sseBroker = options.sseBroker;
  } else {
    const defaults = createDefaultSseBroker();
    sseBroker = defaults.sseBroker;
    ownedRedisSseBroker = defaults.ownedRedisSseBroker;
  }

  // Resolve the per-process instance identifier. Prefer explicit
  // ServerOptions.instanceId (tests, deliberate wiring), fall back to the
  // deploy-env variable, finally a boot-time UUID. Validator rejects the
  // sentinel — a deliberate collision attempt would silently merge this
  // instance's per-instance cursors with the shared-row cursors and
  // deliver events twice to one shard while starving the other.
  const resolvedInstanceId =
    options.instanceId ?? process.env["KUMIKO_INSTANCE_ID"] ?? generateId();
  if (resolvedInstanceId === SHARED_INSTANCE_SENTINEL) {
    throw new Error(
      `ServerOptions.instanceId / KUMIKO_INSTANCE_ID cannot equal the reserved sentinel "${SHARED_INSTANCE_SENTINEL}" — ` +
        `pick any other stable string.`,
    );
  }
  // Warn when we fell back to a random UUID: the default SSE system-consumer
  // is delivery="per-instance", so every boot gets a fresh cursor-row in
  // kumiko_event_consumers. The previous boot's row stays behind on its last
  // cursor and pins pruneEvents (retention-guard uses MIN(lastProcessedEventId)
  // across all shards). Without a stable KUMIKO_INSTANCE_ID this accumulates
  // on every restart, not just scale-down. Silent when options.instanceId or
  // KUMIKO_INSTANCE_ID is explicit — those are deliberate choices (the test
  // suite sets KUMIKO_INSTANCE_ID="test-instance" in vitest config).
  const instanceIdWasRandom =
    options.instanceId === undefined && !process.env["KUMIKO_INSTANCE_ID"];
  if (instanceIdWasRandom) {
    console.warn(
      `[kumiko:boot] No ServerOptions.instanceId / KUMIKO_INSTANCE_ID set — generated a random UUID (${resolvedInstanceId}). ` +
        `Per-instance consumers (SSE by default) write one cursor-row per instance; without a stable id, each restart leaves an orphaned row behind and pins events-retention on its last cursor. ` +
        `Set KUMIKO_INSTANCE_ID to a stable value (e.g. hostname, pod name) in production.`,
    );
  }

  // Observability — Noop by default so no call-site needs to null-check.
  // Every handler/middleware that reaches for ctx.tracer / ctx.metrics gets
  // a working, zero-cost fallback when no provider is configured.
  const observability = options.observability ?? createNoopProvider();

  // Register framework + feature metrics once on this meter. Standard
  // metrics (HTTP, dispatcher, DB) are used by Auto-Instrumentation; feature
  // metrics come from r.metric(...) declarations collected in the registry.
  registerStandardMetrics(observability.meter);
  for (const [name, def] of options.registry.getAllMetrics()) {
    if (observability.meter.definitions().has(name)) continue;
    observability.meter.registerMetric({
      name,
      type: def.type,
      description: def.description,
      labels: def.labels,
      buckets: def.buckets,
      unit: def.unit,
      tenantLabel: def.tenantLabel,
    });
  }

  // When a non-default provider is configured, wrap the injected Redis clients
  // so `redis.cmd` spans attach to every command. For the default NoopProvider
  // we skip the proxy to keep zero runtime overhead when observability is off.
  const shouldWrapRedis = options.observability !== undefined;
  const redisCtx = options.context.redis;
  const wrappedRedis =
    shouldWrapRedis && redisCtx ? wrapRedisClient(redisCtx, observability.tracer) : redisCtx;

  // Inject tracer + meter into the AppContext so the dispatcher can propagate
  // them into every HandlerContext it builds. Build the per-tenant file-provider
  // resolver once (when a provider plugin is mounted) — the dispatcher uses it
  // to materialise `ctx.files`, the upload routes + MSP-applies share it. The
  // resolver reads config + the s3.secretAccessKey secret under SYSTEM identity.
  const contextWithFiles = withFileProviderResolver(options.registry, options.context);
  const fileProviderResolver = contextWithFiles._fileProviderResolver;
  // Auto-wire the rate-limit resolver, but ONLY when at least one
  // handler actually declared a rateLimit option. Apps that don't use
  // L3 pay zero cost: no resolver instance, no Lua-script registration
  // on Redis, no AppContext field. Apps that wire L1/L2 middleware can
  // pass `context.rateLimit` explicitly — that takes precedence over
  // the auto-wire (e.g. middleware-only setup without any L3 handler).
  // Auto-build the resolver when L3 handlers declared rateLimit OR when
  // the caller asked for L1/L2 middleware. Either path needs a resolver;
  // both share the same instance to avoid duplicate Lua-script registration.
  const wantsL3 = options.registry.hasRateLimitedHandler();
  const wantsL1L2 =
    options.rateLimit?.global !== undefined || options.rateLimit?.auth !== undefined;
  const wantsResolver = wantsL3 || wantsL1L2;
  const rateLimitResolver =
    options.context.rateLimit ??
    (wrappedRedis && wantsResolver ? createRateLimitResolver({ redis: wrappedRedis }) : undefined);
  const contextWithObservability: AppContext = {
    ...contextWithFiles,
    ...(wrappedRedis ? { redis: wrappedRedis } : {}),
    ...(rateLimitResolver ? { rateLimit: rateLimitResolver } : {}),
    // Propagate the feature-toggle resolver to the context so the event-
    // dispatcher (and any future context-reading consumer) sees the same
    // source as the command dispatcher's handler-gate. Options take
    // precedence over whatever was already on context — the
    // dispatcher-options arg is the authoritative wire-up point.
    ...(options.dispatcherOptions?.effectiveFeatures
      ? { effectiveFeatures: options.dispatcherOptions.effectiveFeatures }
      : {}),
    tracer: observability.tracer,
    meter: observability.meter,
  };

  const lifecycle = createLifecycleHooks(
    options.registry,
    options.systemHooks,
    options.eventDedup ? { eventDedup: options.eventDedup } : undefined,
  );

  const dispatcher = createDispatcher(options.registry, contextWithObservability, {
    ...options.dispatcherOptions,
    lifecycle,
    sseBroker,
    ...(options.auth ? { membershipQuery: options.auth.membershipQuery } : {}),
  });

  // Async event-dispatcher — the replacement for the old transactional
  // outbox. Consumer sources:
  //   1. System: SSE broadcast (iff sseBroker), Search index (iff
  //      context.searchAdapter).
  //   2. Features: every r.multiStreamProjection registered in the registry
  //      becomes its own consumer row with an independent cursor. The MSP
  //      apply map is routed by event.type; apply receives the raw DbRunner
  //      of a TX-scoped, tenant-bound DB handle so per-tenant writes stay
  //      isolated.
  //
  // The dispatcher is built but NOT started here. Production boot code
  // must call `.start()`; test code typically calls `.runOnce()`.
  // @cast-boundary engine-bridge — context.db union narrows to DbConnection here
  const baseDb = contextWithObservability.db as DbConnection | undefined;
  // @cast-boundary engine-bridge — searchAdapter is an optional context-extension
  const searchAdapter = (contextWithObservability as { searchAdapter?: SearchAdapter })
    .searchAdapter;
  // Adapter is built before the registry exists (app boot order) — hand it
  // the registry-derived default config here so it can lazily configure
  // each tenant index on first access instead of requiring per-tenant app
  // wiring.
  const derivedSearchConfig = searchAdapter
    ? deriveSearchAdapterConfig(options.registry)
    : undefined;
  if (searchAdapter && derivedSearchConfig) {
    searchAdapter.setDefaultConfig?.(derivedSearchConfig);
  }

  const sseConsumerEnabled = options.eventDispatcher?.systemConsumers?.sse ?? true;
  const searchConsumerEnabled = options.eventDispatcher?.systemConsumers?.search ?? true;
  const jobTriggerConsumerEnabled = options.eventDispatcher?.systemConsumers?.jobTrigger ?? true;
  const jobRunnerForTriggers = options.dispatcherOptions?.jobRunner;

  const systemConsumers: EventConsumer[] = [];
  if (sseConsumerEnabled) {
    systemConsumers.push(createSseBroadcastEventConsumer(sseBroker));
  }
  if (searchConsumerEnabled && searchAdapter) {
    systemConsumers.push(createSearchEventConsumer(searchAdapter, options.registry));
  }
  if (jobTriggerConsumerEnabled && jobRunnerForTriggers) {
    systemConsumers.push(createJobTriggerEventConsumer(jobRunnerForTriggers, options.registry));
  }
  // Default ON (#1524 global-by-default). Tests that opt out of SSE via
  // systemConsumers.accessInvalidation=false (test-stack mirrors sse off)
  // skip the row so retention prune suites are not blocked by a lagging
  // cursor=0 consumer they never drain.
  const accessInvalidationEnabled =
    options.eventDispatcher?.systemConsumers?.accessInvalidation ?? true;
  if (accessInvalidationEnabled) {
    systemConsumers.push(createAccessInvalidationEventConsumer(sseBroker));
  }

  // MultiStreamProjections: one EventConsumer per MSP. Handler routes by
  // event.type into the MSP's apply map. MSPs aggregate cross-aggregate but
  // still within one tenant by default — the applier receives the plain
  // baseDb DbRunner; tenant consistency comes from the triggering event's
  // own tenantId, not a per-event TenantDb scope.
  //
  // Lane-filter (Welle 2.6.b): MSPs declare `runIn` to pin them to a
  // deploy-lane. An MSP with `runIn: "api"` won't be wired into the
  // worker-process dispatcher (and vice versa). `runIn: "both"` (or the
  // legacy undefined default of "worker") runs wherever a dispatcher is
  // started — SKIP LOCKED on the consumer-cursor handles the race between
  // processes that both want the same event.
  const processLane: RunIn = options.processLane ?? "worker";
  const mspDefs = [...options.registry.getAllMultiStreamProjections().values()].filter((msp) =>
    runsInLane(msp.runIn, processLane),
  );
  const mspConsumers: EventConsumer[] = mspDefs.map((msp) => ({
    name: msp.name,
    // Feature-toggle gating: carry the owning feature so the event-dispatcher
    // can pause this consumer when the feature is globally disabled. Events
    // queue up in the store and replay cleanly from the same cursor on resume.
    ...(options.registry.getMultiStreamProjectionFeature(msp.name) && {
      featureName: options.registry.getMultiStreamProjectionFeature(msp.name) as string, // @cast-boundary engine-bridge
    }),
    // Copy the continuous-lifecycle error policy straight onto the consumer.
    // Rebuild uses its own policy (rebuildProjection reads msp.errorMode.rebuild
    // directly); steady-state delivery runs through this consumer.
    ...(msp.errorMode?.continuous && { errorPolicy: msp.errorMode.continuous }),
    // Carry the MSP's declared delivery semantic through to the consumer.
    // Default (shared) is applied inside event-dispatcher, so omitting when
    // the MSP didn't declare one keeps the existing behaviour.
    ...(msp.delivery && { delivery: msp.delivery }),
    // Carry the MSP's declared cursor-seed through to the consumer. Default
    // (beginning) is applied inside insertConsumerIfAbsent.
    ...(msp.startFrom && { startFrom: msp.startFrom }),
    handler: async (event, ctx) => {
      const applyFn = msp.apply[event.type];
      // skip: this MSP doesn't care about this event type — fast path,
      // every event type passes through every MSP consumer exactly once.
      if (!applyFn) return;
      if (!baseDb) {
        // skip: no baseDb wired — allConsumers.length > 0 + baseDb check
        // above gates dispatcher creation, so we won't reach here in
        // production. Defensive return for the type-narrowing path.
        return;
      }
      // Saga/process-manager ctx: apply can call ctx.appendEvent to cascade
      // a follow-up event onto another aggregate. Uses the triggering event's
      // tenantId + userId so the causal chain stays tenant-consistent.
      // MSP qualified names are "<feature>:projection:<short>" — the
      // prefix before the first ":" owns the MSP. Used to reject
      // cross-feature ctx.appendEvent calls at emit-site.
      const mspOwner = msp.name.split(":")[0];
      const mspFiles = fileProviderResolver
        ? createFileContext(() => fileProviderResolver(event.tenantId))
        : undefined;
      const applyCtx = createMultiStreamApplyContext({
        registry: options.registry,
        db: baseDb,
        tenantId: event.tenantId,
        userId: event.metadata.userId,
        ...(mspOwner && { callerFeature: mspOwner }),
        ...(mspFiles && { files: mspFiles }),
        ...(mspFiles && {
          derivatives: createDerivativesContext({
            files: mspFiles,
            registry: options.registry,
            db: baseDb,
            tenantId: event.tenantId,
          }),
        }),
      });
      await applyFn(event, baseDb, applyCtx);
      // Keep ctx reachable to satisfy the EventConsumerHandler signature.
      void ctx;
    },
  }));

  const allConsumers = [...systemConsumers, ...mspConsumers];
  const {
    disabled: dispatcherDisabled,
    systemConsumers: _systemConsumersOpt,
    ...dispatcherTunables
  } = options.eventDispatcher ?? {};
  let eventDispatcher: EventDispatcher | undefined;
  if (allConsumers.length > 0 && baseDb && !dispatcherDisabled) {
    eventDispatcher = createEventDispatcher({
      db: baseDb,
      consumers: allConsumers,
      context: contextWithObservability,
      tracer: observability.tracer,
      meter: observability.meter,
      instanceId: resolvedInstanceId,
      ...dispatcherTunables,
    });
  }

  // Wire the event-dispatcher shutdown into the lifecycle so the caller
  // doesn't have to know the dispatcher exists. Hooks drain LIFO, so this
  // runs before anything registered later by the caller (e.g. DB pool close).
  if (options.lifecycle && eventDispatcher) {
    const dispatcher = eventDispatcher;
    options.lifecycle.registerShutdownHook("eventDispatcher", async () => {
      await dispatcher.stop();
    });
  }

  // Same reasoning, scoped to the broker this function created itself — an
  // app-injected sseBroker (options.sseBroker) owns its own teardown.
  if (options.lifecycle && ownedRedisSseBroker) {
    const broker = ownedRedisSseBroker;
    options.lifecycle.registerShutdownHook("redisSseBroker", async () => {
      await broker.close();
    });
  }

  const app = new Hono();

  // Only entry:"signature" bypasses jwtGuard (verify() authenticates
  // itself); entry:"anonymous" still needs the anonymousAccess fallthrough
  // (tenant-by-host), entry:"user" needs c.get("user") populated.
  const extraRoutePublicMatchers = compileExtraRoutePublicMatchers(options.extraRoutes);
  const isExtraRoutePublicPath = (c: import("hono").Context): boolean =>
    extraRoutePublicMatchers.some((m) => m.method === c.req.method && m.pattern.test(c.req.path));

  const sensitiveConfig = mergeSensitiveConfig(
    options.observabilityOptions?.sensitiveFilter ?? DEFAULT_SENSITIVE_CONFIG,
  );

  registerHealthRoutes(app, {
    lifecycle: options.lifecycle,
    readiness: {
      db: baseDb,
      redis: options.context.redis,
      consumers: allConsumers,
      ...(options.readiness ?? {}),
    },
  });

  if (options.metrics) {
    registerMetricsRoute(app, observability.meter, options.metrics);
  }

  app.use("/api/*", requestIdMiddleware());

  // Cap JSON bodies before rate-limit/auth/observability even run. Header-
  // check is O(1); oversized requests never allocate memory for a full body
  // parse. Upload route keeps its own per-field maxSize.
  registerBodyLimit(app, options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES);

  // L1/L2 rate-limit middleware run BEFORE auth so an unauthenticated
  // flood can't even reach the JWT-verify code path. Wired only when
  // the caller passed `rateLimit.global` or `rateLimit.auth`. The
  // resolver is the auto-wired one (or `context.rateLimit` if set);
  // boot-fails loudly when the caller asked for middleware without a
  // working Redis to back it.
  if (wantsL1L2) {
    if (!rateLimitResolver) {
      throw new Error(
        "rateLimit middleware requested but no resolver available — pass `context.redis` " +
          "or `context.rateLimit` so the resolver can be built.",
      );
    }
    if (options.rateLimit?.global) {
      app.use(
        "/api/*",
        globalIpRateLimit({ ...options.rateLimit.global, resolver: rateLimitResolver }),
      );
    }
    if (options.rateLimit?.auth) {
      const { path: l2Path = "/api/auth/*", ...l2Opts } = options.rateLimit.auth;
      app.use(l2Path, authEndpointRateLimit({ ...l2Opts, resolver: rateLimitResolver }));
    }
  }
  // Observability span wraps everything that follows (auth, routes).
  // Must come AFTER request-id (so span can carry the id) and BEFORE auth
  // (so auth-verify can be a child span once we instrument it in v2).
  app.use(
    "/api/*",
    observabilityMiddleware({
      tracer: observability.tracer,
      meter: observability.meter,
      sensitiveConfig,
    }),
  );

  // Tripwire: a kumiko-pii: ciphertext in a JSON response is always a bug
  // (raw read leaked past a decrypt) — dev fails loud, prod redacts (#820).
  app.use("/api/*", piiCiphertextResponseGuard());

  // Auth middleware skips public paths (login, health) — those routes need
  // to be callable without a valid JWT. Every other /api/* request requires
  // a token (or, when anonymousAccess is wired, falls through as anonymous).
  // A session-checker is forwarded when the auth-config wires one, so the
  // middleware can reject revoked sids on every request.
  // Mounting a tenantLifecycleStatus provider is what turns the 410 on, so no
  // entrypoint can forget the wiring; `??` short-circuits, so an explicit
  // auth.resolveTenantLifecycleStatus remains the override.
  const tenantLifecycleResolver =
    options.auth?.resolveTenantLifecycleStatus ??
    deriveTenantLifecycleResolver(options.registry, baseDb);
  const jwtGuard = authMiddleware(jwt, {
    ...(options.auth?.sessionChecker ? { sessionChecker: options.auth.sessionChecker } : {}),
    ...(options.auth?.tokenVerifier ? { tokenVerifier: options.auth.tokenVerifier } : {}),
    ...(tenantLifecycleResolver ? { resolveTenantLifecycleStatus: tenantLifecycleResolver } : {}),
    ...(options.anonymousAccess ? { anonymousAccess: options.anonymousAccess } : {}),
  });
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path) || isExtraRoutePublicPath(c)) return next();
    return jwtGuard(c, next);
  });

  // Without anonymousAccess a missing token 401s instead of falling through as anonymous.
  const sessionOnlyGuard = authMiddleware(jwt, {
    ...(options.auth?.sessionChecker ? { sessionChecker: options.auth.sessionChecker } : {}),
    ...(options.auth?.tokenVerifier ? { tokenVerifier: options.auth.tokenVerifier } : {}),
    ...(tenantLifecycleResolver ? { resolveTenantLifecycleStatus: tenantLifecycleResolver } : {}),
  });

  // PAT rate limiting — runs AFTER the auth guard so the resolved principal is
  // available. Only PAT-authenticated requests are counted (keyed by token id);
  // cookie/JWT users pass through untouched. In-memory limiter is per-instance
  // (see run-prod-app) — a multi-node deployment wanting a shared counter swaps
  // in a Redis-backed LoginRateLimiter.
  const patRateLimiter = options.auth?.patRateLimiter;
  const patRateLimitGuard = patRateLimiter ? buildPatRateLimitGuard(patRateLimiter) : undefined;
  if (patRateLimitGuard) {
    app.use("/api/*", async (c, next) => {
      if (PUBLIC_API_PATHS.has(c.req.path) || isExtraRoutePublicPath(c)) return next();
      return patRateLimitGuard(c, next);
    });
  }

  // Origin-allowlist guard — additional CSRF-hardening for deployments that
  // widen the auth cookie across subdomains (auth.cookieDomain). Registered
  // only when allowedOrigins is non-empty, with the same /api/* + public-skip
  // scope as the CSRF guard and BEFORE it, so a disallowed cross-site POST
  // surfaces as `origin_not_allowed` rather than `csrf_token_mismatch`. Fails
  // closed (assertOriginGuardConfig throws) when a wide cookieDomain is set
  // without an allowlist and without an explicit opt-out — that config is the
  // unguarded-subdomain-XSS footgun, not a warn-and-continue case.
  assertOriginGuardConfig(options.auth);
  const allowedOrigins = options.auth?.allowedOrigins;
  const originGuard =
    allowedOrigins && allowedOrigins.length > 0 ? originMiddleware(allowedOrigins) : undefined;
  if (originGuard) {
    app.use("/api/*", async (c, next) => {
      if (PUBLIC_API_PATHS.has(c.req.path) || isExtraRoutePublicPath(c)) return next();
      return originGuard(c, next);
    });
  }

  // Double-submit CSRF guard — runs only on cookie-authenticated,
  // state-changing requests (POST/PUT/PATCH/DELETE). The guard reads the
  // authTransport flag set by authMiddleware, so public paths (no auth)
  // and bearer-authenticated paths (no cookie vector) fall straight
  // through. Must be registered AFTER the auth middleware above so the
  // flag is populated; registered for the same scope so /api/* routes
  // are covered uniformly.
  const csrfGuard = csrfMiddleware();
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path) || isExtraRoutePublicPath(c)) return next();
    return csrfGuard(c, next);
  });

  // Same order as /api/* above: auth → PAT → origin → CSRF.
  const sessionOnlyHttpRouteGuards: readonly MiddlewareHandler[] = [
    sessionOnlyGuard,
    ...(patRateLimitGuard ? [patRateLimitGuard] : []),
    ...(originGuard ? [originGuard] : []),
    csrfGuard,
  ];

  // Public auth routes (login) need to be registered BEFORE the generic
  // api routes so Hono matches them first.
  if (options.auth) {
    // A membershipQuery handler is registered but nothing fulfils
    // principalStatus — surface that misconfig at boot instead of an InternalError on first login/switch-tenant.
    if (
      options.registry.getQueryHandler(options.auth.membershipQuery) &&
      options.registry.getExtensionUsages(EXT_PRINCIPAL_STATUS).length === 0
    ) {
      throw new Error(
        `[kumiko] auth membershipQuery "${options.auth.membershipQuery}" is registered but no feature ` +
          'provides the "principalStatus" contract — mount the user feature (tenant switch and sign-in ' +
          "need it to reject blocked principals).",
      );
    }
    app.route("/api", createAuthRoutes(dispatcher, jwt, options.auth));
  }
  app.route(
    "/api",
    createApiRoutes(dispatcher, {
      ...(options.sseHeartbeatMs !== undefined ? { sseHeartbeatMs: options.sseHeartbeatMs } : {}),
    }),
  );
  app.route("/api", createSseRoute(sseBroker));

  // Mount upload/download routes whenever a file provider is resolvable (a
  // file-provider plugin is mounted, or a resolver was injected). They resolve
  // the provider per-tenant through file-foundation — no `files` option; route
  // policy comes from createFilesFeature(opts?). Gating on the resolver (not on
  // declared file fields) keeps unattached uploads working and matches the old
  // "files option present → routes" behavior.
  if (fileProviderResolver) {
    const fileDb = options.context.db as FileRoutesOptions["db"]; // @cast-boundary engine-bridge
    if (!fileDb) throw new Error("file routes require db in context");
    const routeOptions = readFilesRouteOptions(options.registry);
    app.route(
      "/api",
      createFileRoutes({
        db: fileDb,
        registry: options.registry,
        resolveProvider: fileProviderResolver,
        ...(routeOptions.accessGuard ? { accessGuard: routeOptions.accessGuard } : {}),
        ...(routeOptions.privilegedRoles ? { privilegedRoles: routeOptions.privilegedRoles } : {}),
        ...(routeOptions.maxUploadSize ? { maxUploadSize: routeOptions.maxUploadSize } : {}),
      }),
    );
  }

  // Feature-deklarierte HTTP-Routes (r.httpRoute). Mount nach /api/* damit
  // /api/* immer Vorrang hat — feature-Routes liegen ohnehin außerhalb
  // (Boot-Validator blockt /api-Prefix). deps.app ist die Outer-App, sodass
  // der Handler /api/query intern via app.fetch(...) nutzen kann (gleicher
  // Auth-Pfad wie ein echter HTTP-Call). deps.systemQuery umgeht diesen
  // Pfad bewusst — für Routes die einen FESTEN Tenant erzwingen müssen
  // (z.B. legal-pages → immer SYSTEM_TENANT_ID), statt ihn per X-Tenant-
  // Header vorzutäuschen (das sieht für die anonymousAccess-Auflösung
  // wie ein normaler Client-Header aus und wird von resolverTrust:
  // "authoritative"-Configs zurecht als Tenant-Override abgelehnt).
  for (const feature of options.registry.features.values()) {
    for (const route of Object.values(feature.httpRoutes)) {
      // @wrapper-known semantic-alias
      const honoHandler = async (c: import("hono").Context): Promise<Response> =>
        route.handler(c, {
          app,
          // createAnonymousUser, NOT createSystemUser: systemQuery's
          // synthesized user must clear the SAME access gate a real
          // anonymous visitor would, no more — regardless of the route's
          // own `anonymous` mode. The system role would ALSO satisfy that
          // gate here, but it can read fields gated to "system" that
          // "anonymous" can't (filterReadFields is a plain role-in-map
          // check) — a systemQuery caller reading a system-gated field
          // would leak it into the response. The forced tenant already
          // comes from bypassing the HTTP layer entirely; no elevated
          // role is needed or wanted on top of that.
          systemQuery: makeSystemQuery(c, dispatcher),
        });
      mountHonoRoute(
        app,
        route.method,
        route.path,
        honoHandler,
        route.anonymous ? [] : sessionOnlyHttpRouteGuards,
      );
    }
  }

  // extraRoutes (kumiko-framework#3050) — declarative HTTP-routes with a
  // Pflicht `entry` tier. Mounted after r.httpRoute for the same reason: an
  // extraRoute dispatching through `dispatcher` builds Hono's matcher, so
  // this must run before any seed that also dispatches (runProdApp/
  // createKumikoServer call buildServer before seeding).
  if (options.extraRoutes) {
    // Boot-time validation for the whole list BEFORE mounting anything —
    // an app with one bad route should fail loud at boot, not mount N-1
    // routes and then throw on route N.
    for (const route of options.extraRoutes) {
      if (!isKnownExtraRouteEntry(route.entry)) {
        throw new Error(
          `[kumiko] extraRoutes: unknown entry "${String(route.entry)}" on ` +
            `"${route.method} ${route.path}" — expected "anonymous" | "user" | "signature". ` +
            "A JS caller without the ExtraRouteDefinition type can hit this at boot.",
        );
      }
      if (route.entry === ExtraRouteEntries.user && !route.path.startsWith("/api/")) {
        throw new Error(
          `[kumiko] extraRoutes: entry:"user" route "${route.method} ${route.path}" must be ` +
            "mounted under \"/api/\" — that's the only path prefix that rides the framework's " +
            "jwtGuard chain, which is what populates deps.user.",
        );
      }
      // A signature route under /api/ skips jwtGuard/origin/csrf for every
      // path its pattern matches — a wildcard would switch off auth for
      // unrelated /api/* handlers (e.g. "/api/*" swallows /api/write).
      if (
        route.entry === ExtraRouteEntries.signature &&
        route.path.startsWith("/api/") &&
        route.path.includes("*")
      ) {
        throw new Error(
          `[kumiko] extraRoutes: entry:"signature" route "${route.method} ${route.path}" must not ` +
            'use a wildcard under "/api/" — it would bypass the auth chain for every matching path.',
        );
      }
    }
    const dispatchSystemWrite = makeDispatchSystemWrite(dispatcher);
    const dispatchSystemQuery = makeDispatchSystemQuery(dispatcher);
    for (const route of options.extraRoutes) {
      const honoHandler = buildExtraRouteHonoHandler(route, {
        app,
        dispatcher,
        registry: options.registry,
        secrets: contextWithObservability.secrets,
        dispatchSystemWrite,
        dispatchSystemQuery,
      });
      mountHonoRoute(app, route.method, route.path, honoHandler);
    }
  }

  // /version-Default registriert NACH feature-routes — Hono "first match
  // wins", also gewinnt feature-deklariertes /version (z.B. App-spezifisches
  // version-format mit Tenant-Stats) wenn vorhanden, sonst greift der
  // Default-Handler aus BUILD_VERSION/BUILD_TIME-env-vars.
  registerVersionRoute(app);

  // Marks "no route matched this path" so tryHonoFirst (server-runtime)
  // can tell it apart from a matched route's OWN deliberate 404 (e.g.
  // default-deny reads like file-derivatives' public-variant route) —
  // without this, tryHonoFirst's only signal was the status code, and a
  // matched route answering 404 got silently rewritten to the SPA shell
  // with status 200 (kumiko-framework#2435). Must be the LAST thing wired
  // on `app`: this only fires when the router found no handler at all, so
  // a route's own `c.text(..., 404)` never passes through here. A handler
  // that calls `c.notFound()` instead of building its own Response DOES
  // route through this same handler and stays indistinguishable from a
  // routing miss — pre-existing Hono semantics, not something this fix
  // changes; deliberate 404s must build their own Response.
  // The header is an internal signal only — tryHonoFirst and every direct
  // app.fetch() passthrough strip it before a response reaches a client.
  app.notFound((c) => c.text("Not Found", 404, { [NO_ROUTE_MATCH_HEADER_NAME]: "1" }));

  return {
    app,
    jwt,
    sseBroker,
    observability,
    dispatcher,
    context: contextWithObservability,
    ...(eventDispatcher ? { eventDispatcher } : {}),
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
  };
}

// Method-switch shared by r.httpRoute and extraRoutes — one place to keep
// the two mounting paths from drifting on which Hono methods get a
// convenience-call vs. app.on().
function mountHonoRoute(
  app: Hono,
  method: HttpRouteMethod,
  path: string,
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  handler: (c: import("hono").Context<any, any>) => Response | Promise<Response>,
  middlewares: readonly MiddlewareHandler[] = [],
): void {
  // Guards go into the route's own handler chain, never a method-gated
  // app.use: Hono serves HEAD through the GET route with c.req.method still
  // "HEAD", so a `method === c.req.method` gate would skip them for HEAD.
  if (middlewares.length > 0) {
    // [path]: only Hono's array-path overload accepts a variable-length handler spread.
    app.on(method, [path], ...middlewares, handler);
    // skip: guarded route already mounted with its guard chain
    return;
  }
  switch (method) {
    case "GET":
      app.get(path, handler);
      break;
    case "POST":
      app.post(path, handler);
      break;
    case "PUT":
      app.put(path, handler);
      break;
    case "PATCH":
      app.patch(path, handler);
      break;
    case "DELETE":
      app.delete(path, handler);
      break;
    case "OPTIONS":
    case "HEAD":
      // Hono's on() for the methods without a convenience method.
      app.on(method, path, handler);
      break;
    default:
      assertUnreachable(method, "http method");
  }
}

// Must run after the auth guard so getUser(c) carries the PAT.
function buildPatRateLimitGuard(patRateLimiter: LoginRateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const pat = getUser(c)?.pat;
    if (pat && !(await patRateLimiter.check(pat.tokenId))) {
      return c.json(
        {
          error: {
            code: "pat_rate_limited",
            httpStatus: 429,
            message: "personal access token rate limit exceeded",
            i18nKey: "auth.errors.patRateLimited",
          },
        },
        429,
      );
    }
    return next();
  };
}

// Shared systemQuery builder for r.httpRoute and extraRoutes (anonymous +
// signature entries). requestContext.run must wrap the dispatcher call —
// both route kinds run outside the requestIdMiddleware chain that normally
// populates it, and `rateLimit: {per: "ip", ...}` on a handler invoked
// through systemQuery is otherwise silent dead-code (enforceRateLimit reads
// requestContext.get()?.ip, undefined without this wrap).
function makeSystemQuery(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  c: import("hono").Context<any, any>,
  dispatcher: Dispatcher,
): (type: string, payload: unknown, tenantId: TenantId) => Promise<unknown> {
  return (type, payload, tenantId) =>
    requestContext.run(requestContext.get() ?? buildRequestContextData(c), () =>
      dispatcher.query(type, payload, createAnonymousUser(tenantId)),
    );
}

// SystemAdmin write/query builders shared by buildServer's `extraRoutes`
// mount and server-runtime's `wire` hook (runProdApp/createKumikoServer,
// after buildServer). Privilege-scope: SystemAdmin is the highest
// non-tenant-scoped role — reaches ANY SystemAdmin-gated handler on ANY
// tenant. Only safe for callers that already proved their own authenticity
// (signature verify(), HMAC state, ...), never exposed to a raw request.
export function makeDispatchSystemWrite(
  dispatcher: Dispatcher,
): (args: SystemDispatchArgs) => Promise<WriteResult> {
  return ({ handlerQn, payload, tenantId }) =>
    dispatcher.write(handlerQn, payload, createSystemUser(tenantId, [ROLES.SystemAdmin]));
}

export function makeDispatchSystemQuery(
  dispatcher: Dispatcher,
): (args: SystemDispatchArgs) => Promise<unknown> {
  return ({ handlerQn, payload, tenantId }) =>
    dispatcher.query(handlerQn, payload, createSystemUser(tenantId, [ROLES.SystemAdmin]));
}

// Same dispatcher.write(...) as entry:"user", but the user is getUser(c) —
// see AnonymousExtraRouteDeps.write for the privilege/tenant contract.
function makeAnonymousWrite(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  c: import("hono").Context<any, any>,
  dispatcher: Dispatcher,
): (type: string, payload: unknown) => Promise<WriteResult> {
  return (type, payload) => {
    const user = getUser(c);
    if (!user) {
      throw new Error(
        '[kumiko] extraRoutes: entry:"anonymous" deps.write requires this route to be mounted ' +
          'under "/api/" with anonymousAccess wired — no request-resolved session user was found.',
      );
    }
    return dispatcher.write(type, payload, user);
  };
}

function isKnownExtraRouteEntry(entry: unknown): entry is ExtraRouteEntry {
  return (
    entry === ExtraRouteEntries.anonymous ||
    entry === ExtraRouteEntries.user ||
    entry === ExtraRouteEntries.signature
  );
}

// Hono path pattern ("/api/foo/:bar", "/api/foo/*") → RegExp. Only the
// subset extraRoutes actually uses (static segments, `:param`, trailing
// `*`) — no inline `:param{regex}` constraints, no optional `:param?`.
function honoPathToRegex(path: string): RegExp {
  const segments = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "[^/]+";
      if (segment === "*") return ".*";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${segments}$`);
}

type ExtraRoutePublicMatcher = { readonly method: string; readonly pattern: RegExp };

// See the bypass comment at the jwtGuard mount above — only signature
// routes are public here.
function compileExtraRoutePublicMatchers(
  extraRoutes: readonly ExtraRouteDefinition[] | undefined,
): readonly ExtraRoutePublicMatcher[] {
  if (!extraRoutes) return [];
  return extraRoutes
    .filter((route) => route.entry === ExtraRouteEntries.signature)
    .map((route) => ({ method: route.method, pattern: honoPathToRegex(route.path) }));
}

type ExtraRouteHonoHandlerDeps = {
  readonly app: Hono;
  readonly dispatcher: Dispatcher;
  readonly registry: Registry;
  readonly secrets: import("../secrets").SecretsContext | undefined;
  readonly dispatchSystemWrite: (args: SystemDispatchArgs) => Promise<WriteResult>;
  readonly dispatchSystemQuery: (args: SystemDispatchArgs) => Promise<unknown>;
};

function buildExtraRouteHonoHandler(
  route: ExtraRouteDefinition,
  shared: ExtraRouteHonoHandlerDeps,
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
): (c: import("hono").Context<any, any>) => Promise<Response> {
  switch (route.entry) {
    case ExtraRouteEntries.anonymous:
      return async (c) =>
        route.handler(c, {
          app: shared.app,
          registry: shared.registry,
          systemQuery: makeSystemQuery(c, shared.dispatcher),
          write: makeAnonymousWrite(c, shared.dispatcher),
        });
    case ExtraRouteEntries.user:
      return async (c) => {
        const user = getUser(c);
        if (!user || user.roles.includes(ANONYMOUS_ROLE)) {
          return c.json(
            {
              error: {
                code: "unauthenticated",
                httpStatus: 401,
                message: "this route requires a signed-in user",
                i18nKey: "auth.errors.missingToken",
              },
            },
            401,
          );
        }
        return route.handler(c, {
          app: shared.app,
          registry: shared.registry,
          user,
          query: (type, payload) => shared.dispatcher.query(type, payload, user),
          write: (type, payload) => shared.dispatcher.write(type, payload, user),
        });
      };
    case ExtraRouteEntries.signature:
      return async (c) => {
        const rawBody = await c.req.text();
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        let verified: unknown;
        try {
          verified = await route.verify(
            { rawBody, headers, params: c.req.param(), query: c.req.query() },
            { registry: shared.registry, secrets: shared.secrets },
          );
        } catch (e) {
          if (e instanceof ExtraRouteRejection) {
            if (e.retryAfterSeconds !== undefined) {
              return c.json(e.body, e.status, { "Retry-After": String(e.retryAfterSeconds) });
            }
            return c.json(e.body, e.status);
          }
          return c.json(
            {
              error: {
                code: "extra_route_signature_invalid",
                message: e instanceof Error ? e.message : String(e),
              },
            },
            401,
          );
        }
        return route.handler(c, verified, {
          app: shared.app,
          registry: shared.registry,
          secrets: shared.secrets,
          systemQuery: makeSystemQuery(c, shared.dispatcher),
          dispatchSystemWrite: shared.dispatchSystemWrite,
          dispatchSystemQuery: shared.dispatchSystemQuery,
        });
      };
    default:
      return assertUnreachable(route, "extra route entry");
  }
}

function deriveTenantLifecycleResolver(
  registry: Registry,
  db: DbConnection | undefined,
): TenantLifecycleStatusResolver | undefined {
  const plugin = resolveTenantLifecyclePlugin(registry, "buildServer");
  if (!plugin) return undefined;
  if (!db) {
    throw new Error(
      "[kumiko] a tenantLifecycleStatus provider is mounted (tenant-lifecycle) but context.db is " +
        "missing — the request-level teardown gate needs a DbConnection. Pass context.db, or wire " +
        "auth.resolveTenantLifecycleStatus explicitly.",
    );
  }
  return (tenantId) => plugin.resolveStatus(tenantId, { db });
}

// Scans every feature's entities for a file/image/files/images field. Short-
// circuits on the first hit — no need to build a full inventory, we only want
// the yes/no answer for the boot check.
function registryDeclaresFileFields(registry: Registry): boolean {
  for (const feature of registry.features.values()) {
    for (const entity of Object.values(feature.entities ?? {})) {
      for (const field of Object.values(entity.fields)) {
        if (isFileField(field)) return true;
      }
    }
  }
  return false;
}

// Entities whose entityList screen WOULD render a search box based on
// screen/field config alone: `screen.searchable` wins when set, otherwise
// the box shows iff the entity has ≥1 searchable field. `screen.searchable
// === false` is excluded — the boot-validator (entity-list-screens.ts) only
// allows that on the whitelisted download-attempt-list-style screens, which
// never render the box. This is the config-only half of the rule; the
// client additionally gates on FeatureSchema.searchAdapterMissing (#2062,
// set from the same `!options.context.searchAdapter` check below) so the
// box is actually suppressed once this function finds a hit.
function entitiesWithSearchableScreen(registry: Registry): readonly string[] {
  const entities = new Set<string>();
  for (const feature of registry.features.values()) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "entityList") continue;
      const isSearchable =
        screen.searchable === true ||
        (screen.searchable === undefined && registry.getSearchableFields(screen.entity).length > 0);
      if (isSearchable) entities.add(screen.entity);
    }
  }
  return [...entities];
}

// Upload-route policy carried by createFilesFeature(opts?) — read from the
// feature's exports so buildServer applies it without a parallel ServerOptions
// surface. Absent feature / opts → defaults in createFileRoutes.
function readFilesRouteOptions(
  registry: Registry,
): Pick<FileRoutesOptions, "accessGuard" | "privilegedRoles" | "maxUploadSize"> {
  const exp = registry.features.get("files")?.exports;
  if (exp && typeof exp === "object" && "routeOptions" in exp) {
    const ro = (exp as { routeOptions?: unknown }).routeOptions;
    if (ro && typeof ro === "object") {
      // @cast-boundary feature-exports: engine-payload (unknown) → known shape
      return ro as Pick<FileRoutesOptions, "accessGuard" | "privilegedRoles" | "maxUploadSize">;
    }
  }
  return {};
}
