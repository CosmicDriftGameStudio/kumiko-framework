import type { CacheSyncBus } from "@cosmicdrift/kumiko-types/cache-sync-types";
import type { DbConnection } from "../db/connection.ts";
import { EXT_FILE_PROVIDER } from "../engine/extension-names.ts";
import type { AppContext, Registry } from "../engine/types/index.ts";
import { assertSeedModeNotInProduction } from "../event-store/seed-clock.ts";
import { makeFileProviderResolver } from "../files/provider-resolver.ts";
import { createFallbackLogger } from "../logging/index.ts";
import { createNoopProvider, type ObservabilityProvider } from "../observability/index.ts";
import { wrapRedisClient } from "../observability/redis-wrapper.ts";
import { registerStandardMetrics } from "../observability/standard-metrics.ts";

import { configAccessorFactoryOf } from "../pipeline/config-accessor-factory.ts";
import { createDispatcher, type Dispatcher } from "../pipeline/dispatcher.ts";
import type { EventConsumer, EventDispatcher } from "../pipeline/event-dispatcher.ts";
import { createLifecycleHooks, type LifecycleHooks } from "../pipeline/lifecycle-pipeline.ts";
import { type ResolvedCacheSyncBus, resolveCacheSyncBus } from "../redis/cache-sync-bus.ts";
import {
  assertValidTrustedProxyHops,
  type ClientIpResolver,
  createClientIpResolver,
} from "./client-ip.ts";
import { createJwtHelper, type JwtHelper } from "./jwt.ts";
import { createDefaultSseBroker, type RedisSseBroker } from "./redis-sse-broker.ts";
import type { ServerOptions } from "./server.ts";
import {
  assertFileStorageProviderForFileFields,
  type BootLogger,
  resolveServerInstanceId,
  warnSearchableScreensWithoutSearchAdapter,
} from "./server-boot-checks.ts";
import {
  createServerEventDispatcher,
  registerOwnedShutdownHooks,
} from "./server-event-dispatcher.ts";
import { resolveServerRateLimit, type ServerRateLimit } from "./server-rate-limit-wiring.ts";
import type { SseBroker } from "./sse-broker.ts";

// The per-tenant file-provider resolver, built once for a registry+context so
// a job-runner and the server it runs beside share one instance (and one
// per-tenant provider cache). Mirrors buildServer's own resolution exactly —
// including NOT inventing a resolver when no `file-provider-*` plugin is
// mounted, which is what keeps assertFileStorageProviderForFileFields able to fire.
export function withFileProviderResolver(
  registry: Registry,
  context: AppContext,
  cacheSync?: CacheSyncBus,
): AppContext {
  if (context._fileProviderResolver !== undefined) return context;
  if (registry.getExtensionUsages(EXT_FILE_PROVIDER).length === 0) return context;
  const { clock } = context;
  return {
    ...context,
    _fileProviderResolver: makeFileProviderResolver({
      registry,
      configAccessorFactory: configAccessorFactoryOf(context),
      secrets: context.secrets,
      db: context.db,
      ...(clock ? { now: () => clock.now() } : {}),
      ...(cacheSync ? { cacheSync } : {}),
    }),
  };
}

export type ServerWiring = {
  readonly options: ServerOptions;
  readonly bootLog: BootLogger;
  readonly clientIpResolver: ClientIpResolver;
  readonly jwt: JwtHelper;
  readonly sseBroker: SseBroker;
  readonly observability: ObservabilityProvider;
  readonly tracedRedis: AppContext["redis"];
  readonly rateLimitResolver: AppContext["rateLimit"];
  readonly rateLimitMiddlewareRequested: boolean;
  readonly context: AppContext;
  readonly fileProviderResolver: AppContext["_fileProviderResolver"];
  readonly dispatcher: Dispatcher;
  readonly lifecycleHooks: LifecycleHooks;
  readonly baseDb: DbConnection | undefined;
  readonly eventConsumers: readonly EventConsumer[];
  readonly eventDispatcher: EventDispatcher | undefined;
};

export function resolveServerWiring(options: ServerOptions): ServerWiring {
  assertSeedModeNotInProduction();
  const bootLog = createFallbackLogger("kumiko:boot", options.context.log);
  const clientIpResolver = resolveServerClientIpResolver(options);
  assertFileStorageProviderForFileFields(options.registry, options.context);
  warnSearchableScreensWithoutSearchAdapter(options.registry, options.context, bootLog);
  const jwt = createServerJwtHelper(options);
  const { sseBroker, ownedRedisSseBroker } = resolveServerSseBroker(options.sseBroker, bootLog);
  // Same decision as the SSE broker: an explicit dispatcherOptions value
  // (incl. null = opt out) wins, otherwise REDIS_URL turns on cross-replica
  // cache invalidation (no REDIS_URL = process-local bus).
  const { bus: cacheSync, owned: ownedCacheSync } = resolveCacheSyncBus(
    options.dispatcherOptions?.cacheSync,
  );
  const instanceId = resolveServerInstanceId(options.instanceId, bootLog);
  const observability = resolveServerObservability(options.observability, options.registry);
  const tracedRedis = resolveTracedRedis(options, observability);

  // Inject tracer + meter into the AppContext so the dispatcher can propagate
  // them into every HandlerContext it builds. Build the per-tenant file-provider
  // resolver once (when a provider plugin is mounted) — the dispatcher uses it
  // to materialise `ctx.services.files`, the upload routes + MSP-applies share it. The
  // resolver reads config + the s3.secretAccessKey secret under SYSTEM identity.
  const contextWithFiles = withFileProviderResolver(options.registry, options.context, cacheSync);
  const fileProviderResolver = contextWithFiles._fileProviderResolver;
  const rateLimit = resolveServerRateLimit(options, tracedRedis, bootLog);
  const context = buildServerAppContext(options, {
    contextWithFiles,
    tracedRedis,
    rateLimit,
    cacheSync,
    observability,
  });
  const lifecycleHooks = createLifecycleHooks(
    options.registry,
    options.systemHooks,
    options.eventDedup ? { eventDedup: options.eventDedup } : undefined,
  );
  const dispatcher = createServerDispatcher(options, context, lifecycleHooks, sseBroker, cacheSync);
  const events = createServerEventDispatcher({
    options,
    context,
    sseBroker,
    observability,
    fileProviderResolver,
    instanceId,
  });
  registerOwnedShutdownHooks(options.lifecycle, {
    eventDispatcher: events.eventDispatcher,
    ownedRedisSseBroker,
    ownedCacheSync,
  });
  return {
    options,
    bootLog,
    clientIpResolver,
    jwt,
    sseBroker,
    observability,
    tracedRedis,
    rateLimitResolver: rateLimit.resolver,
    rateLimitMiddlewareRequested: rateLimit.middlewareRequested,
    context,
    fileProviderResolver,
    dispatcher,
    lifecycleHooks,
    baseDb: events.baseDb,
    eventConsumers: events.consumers,
    eventDispatcher: events.eventDispatcher,
  };
}

function resolveServerClientIpResolver(
  options: Pick<ServerOptions, "trustedProxyHops" | "auth">,
): ClientIpResolver {
  // Single effective hop-count for every IP-derived rate-limit + requestMeta
  // consumer — the top-level option wins over the deprecated
  // `auth.trustedProxyHops` fallback.
  const trustedProxyHops = options.trustedProxyHops ?? options.auth?.trustedProxyHops ?? 0;
  assertValidTrustedProxyHops(trustedProxyHops, "buildServer");
  // Exactly ONE resolver for the whole server — the warn-once flag must fire
  // once per boot, not once per consumer (requestIdMiddleware, L1, L2,
  // auth-routes each sharing this same instance rather than building a
  // private one).
  return createClientIpResolver(trustedProxyHops, "buildServer");
}

function createServerJwtHelper(
  options: Pick<ServerOptions, "auth" | "jwtSecret" | "jwtIssuer" | "jwtTtl">,
): JwtHelper {
  // Stateless JWTs (no sessionChecker → no revocation) default to a shorter
  // TTL than session-backed ones, since a leaked stateless token can't be
  // revoked and stays valid until it expires. Explicit jwtTtl always wins.
  const defaultJwtTtl = options.auth?.sessionChecker ? 8 * 60 * 60 : 60 * 60;
  return createJwtHelper(options.jwtSecret, options.jwtIssuer, options.jwtTtl ?? defaultJwtTtl);
}

function resolveServerSseBroker(
  explicitSseBroker: SseBroker | undefined,
  bootLog: BootLogger,
): { readonly sseBroker: SseBroker; readonly ownedRedisSseBroker: RedisSseBroker | undefined } {
  // An explicit ServerOptions.sseBroker always wins (caller owns its
  // lifecycle) — createDefaultSseBroker is the single decision point every
  // other caller must funnel through instead of picking a broker on its
  // own, so the REDIS_URL-gated cross-replica default can't be silently
  // bypassed the way runProdApp bypassed it before this existed.
  let sseBroker: SseBroker;
  let ownedRedisSseBroker: RedisSseBroker | undefined;
  if (explicitSseBroker) {
    sseBroker = explicitSseBroker;
  } else {
    const defaults = createDefaultSseBroker();
    sseBroker = defaults.sseBroker;
    ownedRedisSseBroker = defaults.ownedRedisSseBroker;
    if (!ownedRedisSseBroker) {
      bootLog.warn(
        "REDIS_URL is not set: cross-replica fanout disabled. SSE, access-invalidation and toggle-sync reach only the cursor-owning process, so with more than one replica clients on the other replicas miss events and revoked sessions stay open there.",
      );
    }
  }
  return { sseBroker, ownedRedisSseBroker };
}

function resolveServerObservability(
  explicitObservability: ObservabilityProvider | undefined,
  registry: Registry,
): ObservabilityProvider {
  // Observability — Noop by default so no call-site needs to null-check.
  // Every handler/middleware that reaches for ctx.obs.tracer / ctx.obs.metrics gets
  // a working, zero-cost fallback when no provider is configured.
  const observability = explicitObservability ?? createNoopProvider();

  // Register framework + feature metrics once on this meter. Standard
  // metrics (HTTP, dispatcher, DB) are used by Auto-Instrumentation; feature
  // metrics come from r.metric(...) declarations collected in the registry.
  registerStandardMetrics(observability.meter);
  for (const [name, def] of registry.getAllMetrics()) {
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
  return observability;
}

function resolveTracedRedis(
  options: Pick<ServerOptions, "observability" | "context">,
  observability: ObservabilityProvider,
): AppContext["redis"] {
  // When a non-default provider is configured, wrap the injected Redis clients
  // so `redis.cmd` spans attach to every command. For the default NoopProvider
  // we skip the proxy to keep zero runtime overhead when observability is off.
  const shouldWrapRedis = options.observability !== undefined;
  const redisCtx = options.context.redis;
  return shouldWrapRedis && redisCtx ? wrapRedisClient(redisCtx, observability.tracer) : redisCtx;
}

function buildServerAppContext(
  options: Pick<ServerOptions, "dispatcherOptions">,
  parts: {
    readonly contextWithFiles: AppContext;
    readonly tracedRedis: AppContext["redis"];
    readonly rateLimit: ServerRateLimit;
    readonly cacheSync: ResolvedCacheSyncBus["bus"];
    readonly observability: ObservabilityProvider;
  },
): AppContext {
  const { contextWithFiles, tracedRedis, rateLimit, cacheSync, observability } = parts;
  return {
    ...contextWithFiles,
    ...(tracedRedis ? { redis: tracedRedis } : {}),
    ...(rateLimit.resolver ? { rateLimit: rateLimit.resolver } : {}),
    _rateLimitPayloadDigest: rateLimit.payloadDigest,
    ...(cacheSync ? { cacheSync } : {}),
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
}

function createServerDispatcher(
  options: Pick<ServerOptions, "registry" | "dispatcherOptions" | "auth">,
  context: AppContext,
  lifecycle: LifecycleHooks,
  sseBroker: SseBroker,
  cacheSync: ResolvedCacheSyncBus["bus"],
): Dispatcher {
  return createDispatcher(options.registry, context, {
    ...options.dispatcherOptions,
    lifecycle,
    sseBroker,
    cacheSync: cacheSync ?? null,
    ...(options.auth ? { membershipQuery: options.auth.membershipQuery } : {}),
  });
}
