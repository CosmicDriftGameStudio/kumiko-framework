import { Hono } from "hono";
import type { DbConnection, PgClient } from "../db/connection";
import { createTenantDb } from "../db/tenant-db";
import { runsInLane } from "../engine/run-in";
import {
  type AppContext,
  isFileField,
  type Registry,
  type RunIn,
  SYSTEM_TENANT_ID,
} from "../engine/types";
import { createFileContext } from "../files/file-handle";
import type { FileRoutesOptions } from "../files/file-routes";
import { createFileRoutes } from "../files/file-routes";
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
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher } from "../pipeline/dispatcher";
import type { EventDedup } from "../pipeline/event-dedup";
import type { EventConsumer, EventDispatcher } from "../pipeline/event-dispatcher";
import { createEventDispatcher } from "../pipeline/event-dispatcher";
import { createLifecycleHooks, type SystemHooks } from "../pipeline/lifecycle-pipeline";
import { createMultiStreamApplyContext } from "../pipeline/multi-stream-apply-context";
import {
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
import type { SearchAdapter } from "../search/types";
import { PUBLIC_API_PATHS } from "./api-constants";
import { authMiddleware } from "./auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "./auth-routes";
import { csrfMiddleware } from "./csrf-middleware";
import { createJwtHelper, type JwtHelper } from "./jwt";
import { observabilityMiddleware } from "./observability-middleware";
import { requestIdMiddleware } from "./request-id-middleware";
import {
  DEFAULT_MAX_REQUEST_BYTES,
  registerBodyLimit,
  registerHealthRoutes,
  registerMetricsRoute,
} from "./route-registrars";
import { createApiRoutes } from "./routes";
import { createSseBroker, type SseBroker } from "./sse-broker";
import { createSseRoute } from "./sse-route";

export type ServerOptions = {
  registry: Registry;
  context: AppContext;
  jwtSecret: string;
  jwtIssuer?: string;
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  systemHooks?: SystemHooks;
  eventDedup?: EventDedup;
  sseBroker?: SseBroker;
  auth?: AuthRoutesConfig;
  files?: Omit<FileRoutesOptions, "db"> & { db?: FileRoutesOptions["db"] };
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
    // Opt out of building the dispatcher even if consumers exist — e.g. ops
    // runs a dedicated dispatcher process, or a test needs to control the
    // consumer lifecycle manually.
    disabled?: boolean;
    // Opt out of the auto-built system consumers (SSE, Search) while still
    // running feature r.multiStreamProjection consumers. Useful for tests
    // that assert only on subscriber behaviour, or for a deployment that
    // routes SSE via a different transport. Default: both enabled when the
    // respective dependency (sseBroker / context.searchAdapter) is available.
    systemConsumers?: { sse?: boolean; search?: boolean };
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
  //     to slow brute-force without breaking real users.
  // Both omitted → no L1/L2 wired and no resolver auto-built unless an
  // L3 handler declared `rateLimit:`. This keeps zero-cost when unused.
  rateLimit?: {
    readonly global?: Omit<GlobalIpRateLimitOptions, "resolver">;
    readonly auth?: Omit<AuthEndpointRateLimitOptions, "resolver"> & {
      // Path-pattern the L2 middleware applies to. Default `/api/auth/*`.
      // Override for apps with a different auth route layout.
      readonly path?: string;
    };
  };
  // Hard cap on JSON request bodies in bytes. Applied to /api/write,
  // /api/batch, /api/query, /api/command and /api/auth/*. File uploads
  // (/api/files) are excluded — those have their own per-field maxSize.
  // `undefined` → 1 MB default. `0` disables the limit entirely (tests
  // or bespoke deployments with a reverse-proxy that caps upstream).
  maxRequestBytes?: number;
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
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
  observability: ObservabilityProvider;
  // Present when at least one consumer is wired and context.db is a
  // DbConnection. Caller owns the lifecycle: `.start()` in boot, `.stop()`
  // in shutdown. Tests drain via `.runOnce()` instead.
  eventDispatcher?: EventDispatcher;
  // Echoed back so the caller has a single handle for both the app and the
  // lifecycle. Only set when the caller passed one in.
  lifecycle?: Lifecycle;
};

export function buildServer(options: ServerOptions): KumikoServer {
  // Hard-fail when the registry declares file/image fields but no storage
  // provider is wired. Boot-validator checks the env shape; here we prove the
  // runtime actually has somewhere to put the bytes. Without this, uploads
  // would fail at the first request instead of at boot.
  if (!options.files?.storageProvider && registryDeclaresFileFields(options.registry)) {
    throw new Error(
      "Features declare file/image fields but no storageProvider was registered — " +
        "pass `files: { storageProvider, db }` to buildServer().",
    );
  }

  const jwt = createJwtHelper(options.jwtSecret, options.jwtIssuer);
  const sseBroker = options.sseBroker ?? createSseBroker();

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
  // them into every HandlerContext it builds. If a file storage provider was
  // registered, wrap it in a FileContext so handlers/hooks can resolve
  // `ctx.files.ref(key)` without reaching for the raw provider.
  const fileCtx = options.files?.storageProvider
    ? createFileContext(options.files.storageProvider)
    : undefined;
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
    ...options.context,
    ...(wrappedRedis ? { redis: wrappedRedis } : {}),
    ...(fileCtx ? { files: fileCtx } : {}),
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
  const baseDb = contextWithObservability.db as DbConnection | undefined;
  const searchAdapter = (contextWithObservability as { searchAdapter?: SearchAdapter })
    .searchAdapter;

  const sseConsumerEnabled = options.eventDispatcher?.systemConsumers?.sse ?? true;
  const searchConsumerEnabled = options.eventDispatcher?.systemConsumers?.search ?? true;

  const systemConsumers: EventConsumer[] = [];
  if (sseConsumerEnabled) {
    systemConsumers.push(createSseBroadcastEventConsumer(sseBroker));
  }
  if (searchConsumerEnabled && searchAdapter) {
    systemConsumers.push(createSearchEventConsumer(searchAdapter, options.registry));
  }

  // MultiStreamProjections: one EventConsumer per MSP. Handler routes by
  // event.type into the MSP's apply map. MSPs aggregate cross-aggregate but
  // still within one tenant by default — the applier receives the
  // tenant-scoped DbRunner; SYSTEM_TENANT_ID events pass through the raw
  // baseDb so system-level sinks can read across tenants.
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
      featureName: options.registry.getMultiStreamProjectionFeature(msp.name) as string,
    }),
    // Copy the continuous-lifecycle error policy straight onto the consumer.
    // Rebuild uses its own policy (rebuildProjection reads msp.errorMode.rebuild
    // directly); steady-state delivery runs through this consumer.
    ...(msp.errorMode?.continuous && { errorPolicy: msp.errorMode.continuous }),
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
      const scopedDb =
        event.tenantId === SYSTEM_TENANT_ID ? baseDb : createTenantDb(baseDb, event.tenantId);
      // Hand the raw DbRunner to apply(): MSPs write to their projection
      // table directly, they don't go through the TenantDb wrapper.
      const rawRunner =
        event.tenantId === SYSTEM_TENANT_ID ? baseDb : (scopedDb as { raw: typeof baseDb }).raw;
      // Saga/process-manager ctx: apply can call ctx.appendEvent to cascade
      // a follow-up event onto another aggregate. Uses the triggering event's
      // tenantId + userId so the causal chain stays tenant-consistent.
      // MSP qualified names are "<feature>:projection:<short>" — the
      // prefix before the first ":" owns the MSP. Used to reject
      // cross-feature ctx.appendEvent calls at emit-site.
      const mspOwner = msp.name.split(":")[0];
      const applyCtx = createMultiStreamApplyContext({
        registry: options.registry,
        db: rawRunner,
        tenantId: event.tenantId,
        userId: event.metadata.userId,
        ...(mspOwner && { callerFeature: mspOwner }),
        ...(fileCtx && { files: fileCtx }),
      });
      await applyFn(event, rawRunner, applyCtx);
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

  const app = new Hono();

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

  // Auth middleware skips public paths (login, health) — those routes need
  // to be callable without a valid JWT. Every other /api/* request requires
  // a token. A session-checker is forwarded when the auth-config wires one,
  // so the middleware can reject revoked sids on every request.
  const jwtGuard = authMiddleware(jwt, {
    ...(options.auth?.sessionChecker ? { sessionChecker: options.auth.sessionChecker } : {}),
    ...(options.auth?.sessionStrictMode ? { strictMode: options.auth.sessionStrictMode } : {}),
  });
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
  });

  // Double-submit CSRF guard — runs only on cookie-authenticated,
  // state-changing requests (POST/PUT/PATCH/DELETE). The guard reads the
  // authTransport flag set by authMiddleware, so public paths (no auth)
  // and bearer-authenticated paths (no cookie vector) fall straight
  // through. Must be registered AFTER the auth middleware above so the
  // flag is populated; registered for the same scope so /api/* routes
  // are covered uniformly.
  const csrfGuard = csrfMiddleware();
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return csrfGuard(c, next);
  });

  // Public auth routes (login) need to be registered BEFORE the generic
  // api routes so Hono matches them first.
  if (options.auth) {
    app.route("/api", createAuthRoutes(dispatcher, jwt, options.auth));
  }
  app.route("/api", createApiRoutes(dispatcher));
  app.route("/api", createSseRoute(sseBroker));

  if (options.files) {
    const fileDb = options.files.db ?? (options.context.db as FileRoutesOptions["db"]);
    if (!fileDb) throw new Error("files option requires db in context or files.db");
    app.route(
      "/api",
      createFileRoutes({
        ...options.files,
        db: fileDb,
        registry: options.registry,
      }),
    );
  }

  return {
    app,
    jwt,
    sseBroker,
    observability,
    ...(eventDispatcher ? { eventDispatcher } : {}),
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
  };
}

// Scans every feature's entities for a file/image/files/images field. Short-
// circuits on the first hit — no need to build a full inventory, we only want
// the yes/no answer for the boot check.
function registryDeclaresFileFields(registry: Registry): boolean {
  for (const feature of registry.features.values()) {
    for (const entity of Object.values(feature.entities)) {
      for (const field of Object.values(entity.fields)) {
        if (isFileField(field)) return true;
      }
    }
  }
  return false;
}
