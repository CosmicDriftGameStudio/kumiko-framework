import { Hono } from "hono";
import type { DbConnection } from "../db/connection";
import { createTenantDb } from "../db/tenant-db";
import type { AppContext, Registry } from "../engine/types";
import type { FileRoutesOptions } from "../files/file-routes";
import { createFileRoutes } from "../files/file-routes";
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
import {
  createSearchEventConsumer,
  createSseBroadcastEventConsumer,
} from "../pipeline/system-hooks";
import type { SearchAdapter } from "../search/types";
import { PUBLIC_API_PATHS, Routes } from "./api-constants";
import { authMiddleware } from "./auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "./auth-routes";
import { createJwtHelper, type JwtHelper } from "./jwt";
import { observabilityMiddleware } from "./observability-middleware";
import { requestIdMiddleware } from "./request-id-middleware";
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
  // feature-level r.postEvent subscribers.
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
    // running feature r.postEvent subscribers. Useful for tests that assert
    // only on subscriber behaviour, or for a deployment that routes SSE via
    // a different transport. Default: both enabled when the respective
    // dependency (sseBroker / context.searchAdapter) is available.
    systemConsumers?: { sse?: boolean; search?: boolean };
  };
  // Observability: tracer + meter used for auto-instrumentation across
  // HTTP, dispatcher, pipeline, DB. Omitted => NoopProvider (zero overhead,
  // no spans or metrics emitted). Typically set to a ConsoleProvider in dev,
  // OTLPProvider in prod.
  observability?: ObservabilityProvider;
  observabilityOptions?: ObservabilityOptions;
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
};

export function buildServer(options: ServerOptions): KumikoServer {
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
      ...(def.description !== undefined ? { description: def.description } : {}),
      ...(def.labels !== undefined ? { labels: def.labels } : {}),
      ...(def.buckets !== undefined ? { buckets: def.buckets } : {}),
      ...(def.unit !== undefined ? { unit: def.unit } : {}),
      ...(def.tenantLabel !== undefined ? { tenantLabel: def.tenantLabel } : {}),
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
  // them into every HandlerContext it builds.
  const contextWithObservability: AppContext = {
    ...options.context,
    ...(wrappedRedis ? { redis: wrappedRedis } : {}),
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
  //   2. Features: every r.postEvent(name, handler) registered in the
  //      registry becomes its own consumer row with an independent cursor.
  //
  // Feature subscribers are wrapped by default so their `ctx.db` is a
  // TenantDb bound to event.tenantId — forgetting to filter by tenant
  // is not a leak risk. Opt out via r.postEvent(name, handler,
  // { systemScoped: true }) for cross-tenant audit / analytics sinks.
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

  const featureSubscribers = [...options.registry.getAllPostEventSubscribers().values()];
  const wrappedFeatureConsumers: EventConsumer[] = featureSubscribers.map((sub) => {
    if (sub.systemScoped || !baseDb) {
      return { name: sub.name, handler: sub.handler };
    }
    return {
      name: sub.name,
      handler: async (event, ctx) => {
        const scopedDb = createTenantDb(baseDb, event.tenantId);
        await sub.handler(event, { ...ctx, db: scopedDb });
      },
    };
  });

  const allConsumers = [...systemConsumers, ...wrappedFeatureConsumers];
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

  const app = new Hono();

  const sensitiveConfig = mergeSensitiveConfig(
    options.observabilityOptions?.sensitiveFilter ?? DEFAULT_SENSITIVE_CONFIG,
  );

  app.get(Routes.health, (c) => c.json({ status: "ok" }));
  app.use("/api/*", requestIdMiddleware());
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
  // a token.
  const jwtGuard = authMiddleware(jwt);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
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
  };
}
