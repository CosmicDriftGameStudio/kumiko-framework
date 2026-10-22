import type { ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import type { EffectiveFeaturesResolver } from "@cosmicdrift/kumiko-framework/engine";
import {
  type AllInOneEntrypoint,
  type ApiEntrypoint,
  type ApiEntrypointOptions,
  createAllInOneEntrypoint,
  createApiEntrypoint,
} from "@cosmicdrift/kumiko-framework/entrypoint";
import { createMetricsForFactory } from "@cosmicdrift/kumiko-framework/observability";
import { jobRunLoggerCallbacks } from "./boot/job-run-logger.ts";
import { startPiiEventBackfillOnBoot } from "./boot/pii-event-backfill-on-boot.ts";
import { recordAppStartedOnBoot } from "./boot/record-app-started-on-boot.ts";
import { makeDispatchSystemQuery, makeDispatchSystemWrite } from "./extra-routes-deps.ts";
import { makeFilesForTenant } from "./files-for-tenant.ts";
import type { RunProdAppOptions } from "./run-prod-app.ts";
import { buildProdAuthRoutes, type ProdAuthWiring } from "./run-prod-app-auth.ts";
import type { ProdBootConfig, ProdComposedFeatures } from "./run-prod-app-config.ts";
import type { ProdConnections } from "./run-prod-app-connections.ts";
import type { ProdRequestContext } from "./run-prod-app-request-context.ts";

export type ProdEntrypoint = ApiEntrypoint | AllInOneEntrypoint;

function collectProdExtraRoutes(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
): readonly ExtraRouteDefinition[] | undefined {
  const bootExtraRoutes = config.bootOptionWiring.extraRoutes;
  if (!options.extraRoutes && !options.unsubscribe && bootExtraRoutes.length === 0) {
    return undefined;
  }
  return [...(options.extraRoutes ?? []), ...composed.unsubscribeRoutes, ...bootExtraRoutes];
}

export function buildProdEntrypointOptions(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
  requestContext: ProdRequestContext,
  authWiring: ProdAuthWiring,
  effectiveFeatures: EffectiveFeaturesResolver | undefined,
): ApiEntrypointOptions {
  const { registry, effectiveAuth } = composed;
  const { db, redis, outsideTransactionDb, cacheSync } = connections;
  const { jwtIssuer, instanceId, trustedProxyHops, resolvedRateLimit } = config;
  const extraRoutes = collectProdExtraRoutes(options, config, composed);
  return {
    registry,
    context: {
      db,
      redis,
      entityCache: requestContext.entityCache,
      registry,
      ...requestContext.extraContext,
    },
    sseBroker: requestContext.sseBroker,
    jwtSecret: config.jwtSecretOrKeyring,
    ...(jwtIssuer && { jwtIssuer }),
    ...(instanceId && { instanceId }),
    dispatcherOptions: {
      idempotency: requestContext.idempotency,
      cacheSync,
      outsideTransactionDb,
      ...(effectiveFeatures && { effectiveFeatures }),
    },
    eventDedup: requestContext.eventDedup,
    ...(options.observability && { observability: options.observability }),
    ...(options.metrics && { metrics: options.metrics }),
    ...(resolvedRateLimit && { rateLimit: resolvedRateLimit }),
    ...(trustedProxyHops !== undefined && { trustedProxyHops }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    ...(extraRoutes && { extraRoutes }),
    ...(effectiveAuth && {
      auth: buildProdAuthRoutes(effectiveAuth, config, composed, connections, authWiring),
    }),
    ...(requestContext.resolvedAnonymousAccess && {
      anonymousAccess: requestContext.resolvedAnonymousAccess,
    }),
  };
}

export type ProdEntrypointOptions = ReturnType<typeof buildProdEntrypointOptions>;

function prodJobOptions(
  options: RunProdAppOptions,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
) {
  const queueNamePrefix = options.jobs?.queueNamePrefix;
  return {
    ...jobRunLoggerCallbacks(composed.registry, connections.db),
    ...(queueNamePrefix !== undefined && { queueNamePrefix }),
    ...(options.jobs?.getActiveTenantIds !== undefined && {
      getActiveTenantIds: options.jobs.getActiveTenantIds,
    }),
  };
}

// Deployment topology. By default, createAllInOneEntrypoint runs HTTP, both
// job lanes (two runners, each scheduling only its own lane's crons, so
// nothing fires twice) and the event dispatcher inline. That way worker-lane
// crons (run-export-jobs defaults to runIn:"worker") and MSPs run without a
// separate worker process, the gap the data export used to stall on.
// runSingleInstance:false means API-only: a dedicated worker must then take
// over the worker lane and MSPs, while API-lane jobs keep running locally.
// The legacy eventDispatcher.disabled maps to runSingleInstance:false so
// existing callers keep working; the explicit flag takes precedence.
export function createProdEntrypoint(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
  entrypointOptions: ProdEntrypointOptions,
): ProdEntrypoint {
  const runSingleInstance = options.runSingleInstance ?? options.eventDispatcher?.disabled !== true;
  const hasJobs = composed.registry.getAllJobs().size > 0;
  const jobOptions = prodJobOptions(options, composed, connections);
  const dispatcherTunables =
    options.eventDispatcher?.pollIntervalMs !== undefined
      ? { pollIntervalMs: options.eventDispatcher.pollIntervalMs }
      : {};

  return runSingleInstance
    ? createAllInOneEntrypoint({
        ...entrypointOptions,
        redisUrl: config.redisUrl,
        ...jobOptions,
        ...(!options.eventDispatcher?.disabled && { eventDispatcher: dispatcherTunables }),
      })
    : createApiEntrypoint({
        ...entrypointOptions,
        ...(hasJobs && {
          jobs: {
            redisUrl: config.redisUrl,
            runLocalJobs: true,
            ...jobOptions,
          },
        }),
      });
}

// The broker built above is always ours (runProdApp never accepts a
// caller-supplied sseBroker), so — same reasoning as buildServer's own
// ownedRedisSseBroker hook — closing it on shutdown is our job, not the
// entrypoint's. Registered after createApiEntrypoint/createAllInOneEntrypoint
// (which already registered the eventDispatcher/jobRunner hooks above),
// so it drains LIFO before those, matching the close-before-teardown
// order established for buildServer's own hook.
export function registerProdShutdownHooks(
  entrypoint: ProdEntrypoint,
  cacheSync: ProdConnections["cacheSync"],
  ownedRedisSseBroker: ProdRequestContext["ownedRedisSseBroker"],
): void {
  entrypoint.lifecycle.registerShutdownHook("prodAppCacheSync", async () => {
    await cacheSync.close();
  });
  if (ownedRedisSseBroker) {
    const broker = ownedRedisSseBroker;
    entrypoint.lifecycle.registerShutdownHook("prodAppRedisSseBroker", async () => {
      await broker.close();
    });
  }
}

// `extraRoutes` itself is already mounted — buildServer wires it inside
// createApiEntrypoint/createAllInOneEntrypoint, before this function ever
// runs. `wire` is the remaining escape-hatch for app-wired co-running
// components that need the system-write dispatcher but don't declare a
// route.
export async function runProdWireHook(
  options: RunProdAppOptions,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
  entrypoint: ProdEntrypoint,
): Promise<void> {
  const { wire } = options;
  if (wire) {
    const { bootCrypto } = composed;
    await wire({
      db: connections.db,
      redis: connections.redis,
      registry: composed.registry,
      filesForTenant: makeFilesForTenant(entrypoint.context),
      ...(bootCrypto.masterKeyProvider && { masterKeyProvider: bootCrypto.masterKeyProvider }),
      ...(bootCrypto.configCipher && { configEncryption: bootCrypto.configCipher }),
      metricsFor: createMetricsForFactory(entrypoint.observability.meter),
      dispatchSystemWrite: makeDispatchSystemWrite(entrypoint.dispatcher),
      dispatchSystemQuery: makeDispatchSystemQuery(entrypoint.dispatcher),
    });
  }
}

export async function startProdBackgroundWork(
  entrypoint: ProdEntrypoint,
  config: ProdBootConfig,
  composed: ProdComposedFeatures,
  connections: ProdConnections,
): Promise<void> {
  const { envSource } = config;
  await entrypoint.start();
  await recordAppStartedOnBoot({ db: connections.db, envSource });
  startPiiEventBackfillOnBoot({
    db: connections.db,
    registry: composed.registry,
    lifecycle: entrypoint.lifecycle,
    envSource,
  });
}
