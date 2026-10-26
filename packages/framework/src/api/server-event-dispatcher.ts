import type { RunIn } from "@cosmicdrift/kumiko-types/config";
import type { MultiStreamApplyContext } from "@cosmicdrift/kumiko-types/multi-stream-apply-context-types";
import type { MultiStreamProjectionDefinition } from "@cosmicdrift/kumiko-types/projection";
import type { DbConnection } from "../db/connection.ts";
import { withExecutorManagedWrites } from "../db/tenant-db.ts";
import { createDerivativesContext } from "../derivatives/derivatives-context.ts";
import { runsInLane } from "../engine/run-in.ts";
import type { AppContext, Registry } from "../engine/types/index.ts";

import { createTenantFileContext } from "../files/file-handle.ts";
import type { Lifecycle } from "../lifecycle/index.ts";
import type { ObservabilityProvider } from "../observability/index.ts";
import {
  createEventDispatcher,
  type EventConsumer,
  type EventDispatcher,
} from "../pipeline/event-dispatcher.ts";
import { createMultiStreamApplyContext } from "../pipeline/multi-stream-apply-context.ts";
import {
  createAccessInvalidationEventConsumer,
  createCatchUpJobEventConsumer,
  createJobTriggerEventConsumer,
  createSearchEventConsumer,
  createSseBroadcastEventConsumer,
} from "../pipeline/system-hooks.ts";
import type { ResolvedCacheSyncBus } from "../redis/cache-sync-bus.ts";
import { deriveSearchAdapterConfig } from "../search/derive-search-adapter-config.ts";
import type { SearchAdapter } from "../search/types.ts";
import type { RedisSseBroker } from "./redis-sse-broker.ts";
import type { ServerOptions } from "./server.ts";
import type { SseBroker } from "./sse-broker.ts";

export function createServerEventDispatcher(deps: {
  readonly options: Pick<
    ServerOptions,
    "registry" | "eventDispatcher" | "dispatcherOptions" | "processLane"
  >;
  readonly context: AppContext;
  readonly sseBroker: SseBroker;
  readonly observability: ObservabilityProvider;
  readonly fileProviderResolver: AppContext["_fileProviderResolver"];
  readonly instanceId: string;
}): {
  readonly baseDb: DbConnection | undefined;
  readonly consumers: readonly EventConsumer[];
  readonly eventDispatcher: EventDispatcher | undefined;
} {
  const { options, context, sseBroker, observability, fileProviderResolver, instanceId } = deps;
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
  const { baseDb, searchAdapter } = resolveBaseDbAndSearchAdapter(context, options.registry);
  const systemConsumers = buildSystemEventConsumers(options, sseBroker, searchAdapter);
  const mspConsumers = buildMultiStreamProjectionConsumers(options, {
    baseDb,
    context,
    fileProviderResolver,
  });
  const catchUpJobConsumers = buildCatchUpJobConsumers(options, baseDb);
  const consumers = [...systemConsumers, ...mspConsumers, ...catchUpJobConsumers];
  const {
    disabled: dispatcherDisabled,
    systemConsumers: _systemConsumersOpt,
    ...dispatcherTunables
  } = options.eventDispatcher ?? {};
  let eventDispatcher: EventDispatcher | undefined;
  if (consumers.length > 0 && baseDb && !dispatcherDisabled) {
    eventDispatcher = createEventDispatcher({
      db: baseDb,
      consumers,
      context,
      tracer: observability.tracer,
      meter: observability.meter,
      instanceId,
      ...dispatcherTunables,
    });
  }
  return { baseDb, consumers, eventDispatcher };
}

export function resolveBaseDbAndSearchAdapter(
  context: AppContext,
  registry: Registry,
): {
  readonly baseDb: DbConnection | undefined;
  readonly searchAdapter: SearchAdapter | undefined;
} {
  // @cast-boundary engine-bridge — context.db union narrows to DbConnection here
  const baseDb = context.db as DbConnection | undefined;
  const searchAdapter = context.searchAdapter;
  // Adapter is built before the registry exists (app boot order) — hand it
  // the registry-derived default config here so it can lazily configure
  // each tenant index on first access instead of requiring per-tenant app
  // wiring.
  const derivedSearchConfig = searchAdapter ? deriveSearchAdapterConfig(registry) : undefined;
  if (searchAdapter && derivedSearchConfig) {
    searchAdapter.setDefaultConfig?.(derivedSearchConfig);
  }
  return { baseDb, searchAdapter };
}

function buildSystemEventConsumers(
  options: Pick<ServerOptions, "registry" | "eventDispatcher" | "dispatcherOptions">,
  sseBroker: SseBroker,
  searchAdapter: SearchAdapter | undefined,
): EventConsumer[] {
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
  // Default ON (global-by-default). Tests that opt out of SSE via
  // systemConsumers.accessInvalidation=false (test-stack mirrors sse off)
  // skip the row so retention prune suites are not blocked by a lagging
  // cursor=0 consumer they never drain.
  const accessInvalidationEnabled =
    options.eventDispatcher?.systemConsumers?.accessInvalidation ?? true;
  if (accessInvalidationEnabled) {
    systemConsumers.push(createAccessInvalidationEventConsumer(sseBroker));
  }
  return systemConsumers;
}

function buildCatchUpJobConsumers(
  options: Pick<
    ServerOptions,
    "registry" | "processLane" | "dispatcherOptions" | "eventDispatcher"
  >,
  baseDb: DbConnection | undefined,
): EventConsumer[] {
  const jobRunner = options.dispatcherOptions?.jobRunner;
  if (!jobRunner || !baseDb) return [];
  const upcast = { db: baseDb, upcasters: options.registry.getEventUpcasters() };
  if (!(options.eventDispatcher?.systemConsumers?.jobTrigger ?? true)) return [];
  const processLane: RunIn = options.processLane ?? "worker";
  const consumers: EventConsumer[] = [];
  for (const [jobName, jobDef] of options.registry.getAllJobs()) {
    if (!("on" in jobDef.trigger) || !jobDef.trigger.catchUp) continue;
    if (!runsInLane(jobDef.runIn, processLane)) continue;
    consumers.push(
      createCatchUpJobEventConsumer(
        jobRunner,
        jobName,
        options.registry.getJobFeature(jobName),
        upcast,
      ),
    );
  }
  return consumers;
}

function buildMultiStreamProjectionConsumers(
  options: Pick<ServerOptions, "registry" | "processLane" | "dispatcherOptions">,
  deps: {
    readonly baseDb: DbConnection | undefined;
    readonly context: AppContext;
    readonly fileProviderResolver: AppContext["_fileProviderResolver"];
  },
): EventConsumer[] {
  const jobRunnerForTriggers = options.dispatcherOptions?.jobRunner;
  const mspJobs: MultiStreamApplyContext["jobs"] | undefined = jobRunnerForTriggers?.dispatch
    ? {
        dispatch: async (jobName, payload, dispatchOptions) => {
          await jobRunnerForTriggers.dispatch?.(jobName, payload, dispatchOptions);
        },
      }
    : undefined;

  // MultiStreamProjections: one EventConsumer per MSP. Handler routes by
  // event.type into the MSP's apply map. MSPs aggregate cross-aggregate but
  // still within one tenant by default — the applier receives the plain
  // baseDb DbRunner; tenant consistency comes from the triggering event's
  // own tenantId, not a per-event TenantDb scope.
  //
  // Lane-filter: MSPs declare `runIn` to pin them to a
  // deploy-lane. An MSP with `runIn: "api"` won't be wired into the
  // worker-process dispatcher (and vice versa). `runIn: "both"` (or the
  // legacy undefined default of "worker") runs wherever a dispatcher is
  // started — SKIP LOCKED on the consumer-cursor handles the race between
  // processes that both want the same event.
  const processLane: RunIn = options.processLane ?? "worker";
  const mspDefs = [...options.registry.getAllMultiStreamProjections().values()].filter((msp) =>
    runsInLane(msp.runIn, processLane),
  );
  return mspDefs.map((msp) =>
    buildMultiStreamProjectionConsumer(msp, {
      registry: options.registry,
      mspJobs,
      ...deps,
    }),
  );
}

function buildMultiStreamProjectionConsumer(
  msp: MultiStreamProjectionDefinition,
  deps: {
    readonly registry: Registry;
    readonly mspJobs: MultiStreamApplyContext["jobs"] | undefined;
    readonly baseDb: DbConnection | undefined;
    readonly context: AppContext;
    readonly fileProviderResolver: AppContext["_fileProviderResolver"];
  },
): EventConsumer {
  const { registry, mspJobs, baseDb, context, fileProviderResolver } = deps;
  return {
    name: msp.name,
    // Feature-toggle gating: carry the owning feature so the event-dispatcher
    // can pause this consumer when the feature is globally disabled. Events
    // queue up in the store and replay cleanly from the same cursor on resume.
    ...(registry.getMultiStreamProjectionFeature(msp.name) && {
      featureName: registry.getMultiStreamProjectionFeature(msp.name) as string, // @cast-boundary engine-bridge
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
        // skip: no baseDb wired — consumers.length > 0 + baseDb check in
        // createServerEventDispatcher gates dispatcher creation, so we won't reach here in
        // production. Defensive return for the type-narrowing path.
        return;
      }
      // Saga/process-manager ctx: apply can call ctx.events.append to cascade
      // a follow-up event onto another aggregate. Uses the triggering event's
      // tenantId + userId so the causal chain stays tenant-consistent.
      // MSP qualified names are "<feature>:projection:<short>" — the
      // prefix before the first ":" owns the MSP. Used to reject
      // cross-feature ctx.events.append calls at emit-site.
      const mspOwner = msp.name.split(":")[0];
      const mspFiles = fileProviderResolver
        ? createTenantFileContext(fileProviderResolver, event.tenantId)
        : undefined;
      const mspDb = withExecutorManagedWrites(baseDb);
      const applyCtx = createMultiStreamApplyContext({
        registry,
        db: mspDb,
        tenantId: event.tenantId,
        userId: event.metadata.userId,
        ...(mspOwner && { callerFeature: mspOwner }),
        ...(mspFiles && { files: mspFiles }),
        ...(context.secrets && { secrets: context.secrets }),
        ...(mspJobs && { jobs: mspJobs }),
        ...(mspFiles && {
          derivatives: createDerivativesContext({
            files: mspFiles,
            registry,
            db: baseDb,
            tenantId: event.tenantId,
          }),
        }),
      });
      await applyFn(event, mspDb, applyCtx);
      // Keep ctx reachable to satisfy the EventConsumerHandler signature.
      void ctx;
    },
  };
}

export function registerOwnedShutdownHooks(
  lifecycle: Lifecycle | undefined,
  owned: {
    readonly eventDispatcher: EventDispatcher | undefined;
    readonly ownedRedisSseBroker: RedisSseBroker | undefined;
    readonly ownedCacheSync: ResolvedCacheSyncBus["owned"];
  },
): void {
  const { eventDispatcher, ownedRedisSseBroker, ownedCacheSync } = owned;
  // Wire the event-dispatcher shutdown into the lifecycle so the caller
  // doesn't have to know the dispatcher exists. Hooks drain LIFO, so this
  // runs before anything registered later by the caller (e.g. DB pool close).
  if (lifecycle && eventDispatcher) {
    const dispatcher = eventDispatcher;
    lifecycle.registerShutdownHook("eventDispatcher", async () => {
      await dispatcher.stop();
    });
  }

  // Same reasoning, scoped to the broker this function created itself — an
  // app-injected sseBroker (options.sseBroker) owns its own teardown.
  if (lifecycle && ownedRedisSseBroker) {
    const broker = ownedRedisSseBroker;
    lifecycle.registerShutdownHook("redisSseBroker", async () => {
      await broker.close();
    });
  }

  if (lifecycle && ownedCacheSync) {
    const bus = ownedCacheSync;
    lifecycle.registerShutdownHook("cacheSync", async () => {
      await bus.close();
    });
  }
}
