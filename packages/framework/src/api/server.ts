import { Hono } from "hono";
import type Redis from "ioredis";
import type { DbConnection } from "../db/connection";
import type { AppContext, Registry } from "../engine/types";
import type { FileRoutesOptions } from "../files/file-routes";
import { createFileRoutes } from "../files/file-routes";
import {
  createNoopProvider,
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
  registerStandardMetrics,
  wrapRedisClient,
  type ObservabilityOptions,
  type ObservabilityProvider,
} from "../observability";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher } from "../pipeline/dispatcher";
import type { EventBroker } from "../pipeline/event-broker";
import type { EventDedup } from "../pipeline/event-dedup";
import { createLifecycleHooks, type SystemHooks } from "../pipeline/lifecycle-pipeline";
import type { DeadLetterEvent, OutboxPoller } from "../pipeline/outbox-poller";
import { createOutboxPoller } from "../pipeline/outbox-poller";
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
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle" | "outbox">;
  systemHooks?: SystemHooks;
  eventDedup?: EventDedup;
  sseBroker?: SseBroker;
  auth?: AuthRoutesConfig;
  files?: Omit<FileRoutesOptions, "db"> & { db?: FileRoutesOptions["db"] };
  // Transactional outbox — when set, ctx.emit writes to event_outbox in the
  // current transaction and the in-process poller publishes rows after commit.
  // Requires a DbConnection in context.db. The subscriberRedis must be a
  // separate ioredis instance (a subscribed client can't issue other commands).
  outbox?: {
    redis: Redis;
    subscriberRedis: Redis;
    eventBroker: EventBroker;
    batchSize?: number;
    pollIntervalMs?: number;
    maxAttempts?: number;
    // Fires when an outbox row exhausts retries. Hook a metric / pager here.
    onDeadLetter?: (event: DeadLetterEvent) => void | Promise<void>;
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
  // Present only when options.outbox was set. Callers that use buildServer
  // in production must call `outboxPoller.start()` during boot and
  // `outboxPoller.stop()` during shutdown.
  outboxPoller?: OutboxPoller;
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
    shouldWrapRedis && redisCtx
      ? wrapRedisClient(redisCtx, observability.tracer)
      : redisCtx;

  // Inject tracer + meter into the AppContext so the dispatcher can propagate
  // them into every HandlerContext it builds.
  const contextWithObservability: AppContext = {
    ...options.context,
    ...(wrappedRedis ? { redis: wrappedRedis } : {}),
    tracer: observability.tracer,
    meter: observability.meter,
  };

  // Wrap outbox redis connections too — the poller publishes/wakes through
  // them and we want those commands to show up in the trace.
  const outboxOptions = options.outbox
    ? {
        ...options.outbox,
        redis: shouldWrapRedis
          ? wrapRedisClient(options.outbox.redis, observability.tracer)
          : options.outbox.redis,
        subscriberRedis: shouldWrapRedis
          ? wrapRedisClient(options.outbox.subscriberRedis, observability.tracer)
          : options.outbox.subscriberRedis,
      }
    : undefined;

  const lifecycle = createLifecycleHooks(
    options.registry,
    options.systemHooks,
    options.eventDedup ? { eventDedup: options.eventDedup } : undefined,
  );

  const dispatcher = createDispatcher(options.registry, contextWithObservability, {
    ...options.dispatcherOptions,
    lifecycle,
    ...(outboxOptions ? { outbox: { redis: outboxOptions.redis } } : {}),
  });

  // Outbox poller — created but NOT auto-started. The caller decides when
  // to start/stop (typically in an app-level boot + shutdown sequence).
  let outboxPoller: OutboxPoller | undefined;
  if (outboxOptions) {
    const dbConn = options.context.db as DbConnection | undefined;
    if (!dbConn) {
      throw new Error("buildServer: options.outbox requires context.db to be a DbConnection");
    }
    outboxPoller = createOutboxPoller({
      db: dbConn,
      subscriberRedis: outboxOptions.subscriberRedis,
      eventBroker: outboxOptions.eventBroker,
      tracer: observability.tracer,
      ...(outboxOptions.batchSize !== undefined ? { batchSize: outboxOptions.batchSize } : {}),
      ...(outboxOptions.pollIntervalMs !== undefined
        ? { pollIntervalMs: outboxOptions.pollIntervalMs }
        : {}),
      ...(outboxOptions.maxAttempts !== undefined
        ? { maxAttempts: outboxOptions.maxAttempts }
        : {}),
      ...(outboxOptions.onDeadLetter !== undefined
        ? { onDeadLetter: outboxOptions.onDeadLetter }
        : {}),
      ...(options.context.log !== undefined ? { log: options.context.log } : {}),
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
    ...(outboxPoller ? { outboxPoller } : {}),
  };
}
