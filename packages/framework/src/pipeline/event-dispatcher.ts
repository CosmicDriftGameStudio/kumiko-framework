import type { DbTx, PgClient } from "../db/connection";
import type { AppContext } from "../engine/types";
import { SYSTEM_TENANT_ID } from "../engine/types/identifiers";
import { EVENTS_PUBSUB_CHANNEL, type StoredEvent } from "../event-store";
import {
  emitEventConsumerPassOutcome,
  emitEventDispatcherListenConnected,
  getFallbackMeter,
  getFallbackTracer,
  type Meter,
  type Tracer,
} from "../observability";
import { SHARED_INSTANCE_SENTINEL } from "./event-consumer-state";
import {
  acquireConsumerState,
  consumerInstanceId,
  deliverEvents,
  emitLagFromTx,
  fetchPendingEvents,
  markProcessing,
  persistConsumerOutcome,
  preRegisterConsumers,
} from "./event-dispatcher-delivery";

// Async event-dispatcher — the "AsyncDaemon"-pendant for Kumiko.
//
// Consumers (SSE broadcast, search-index, cross-feature subscribers, and —
// later — async projections) read the events-table via a persistent cursor
// held in kumiko_event_consumers. One row per consumer, one independent
// cursor. A stalled Meili consumer doesn't block SSE; a dead subscription
// doesn't pause the others.
//
// Run loop, per consumer, per pass:
//   1. BEGIN
//   2. SELECT state row FOR UPDATE SKIP LOCKED
//      — multi-instance-safe: if another poller holds the lock, this pass
//        skips this consumer and tries the next. No duplicate delivery.
//   3. SELECT events WHERE id > lastProcessedEventId ORDER BY id ASC LIMIT batchSize
//   4. For each event: call the consumer's handler
//        - handler throws → increment attempts, mark status="dead" at
//          maxAttempts, surface lastError, STOP this consumer's pass
//          (later events aren't consumed out-of-order)
//        - handler succeeds → advance cursor, reset attempts
//   5. COMMIT — cursor update + dead-letter flag land atomic
//
// Order guarantee: per-consumer, events are applied in events.id order. We
// don't skip past a failing event — ops has to fix it or mark the consumer
// disabled. This matches Marten's subscription semantics (and EventStoreDB's
// persistent subscriptions): strictly-ordered + halt-on-poison.
//
// Delivery semantics: **at-least-once**. If a handler runs but the cursor
// update fails (crash mid-pass), the same event is delivered again next pass.
// Handlers MUST be idempotent.
//
// Delivery-loop mechanics (acquire/fetch/deliver/persist) live in
// event-dispatcher-delivery.ts; the ops recovery surface (restart/disable/
// enable/skipPoisonEvent/progress) lives in event-dispatcher-admin.ts. This
// file is the facade: public types + the createEventDispatcher() factory.

export type EventConsumerHandler = (event: StoredEvent, ctx: AppContext) => Promise<void>;

// Per-consumer error policy. When skipApplyErrors is true and handler throws,
// the dispatcher logs the error, advances the cursor past the offending event,
// and keeps delivering — instead of the default retry + dead-letter flow.
// Wire by copying MultiStreamProjectionDefinition.errorMode.continuous into
// the EventConsumer (see api/server.ts MSP wiring).
export type EventConsumerErrorPolicy = {
  readonly skipApplyErrors?: boolean;
  // Per-consumer override of EventDispatcherOptions.maxAttempts. A consumer
  // that depends on infra which may still be provisioning at boot (search
  // adapter, external APIs) needs more retry headroom than the dispatcher-
  // wide default before it gets dead-lettered.
  readonly maxAttempts?: number;
};

export type EventConsumer = {
  readonly name: string;
  readonly handler: EventConsumerHandler;
  readonly errorPolicy?: EventConsumerErrorPolicy;
  // Owning feature — when present, the dispatcher skips this consumer's
  // pass while the feature is globally disabled. Events remain in the store
  // and the consumer resumes from the same cursor when the feature is
  // re-enabled (no data loss, no replay). System consumers (SSE, search,
  // framework-level plumbing) omit this and always run.
  readonly featureName?: string;
  // Delivery semantics across multi-instance deploys:
  //   "shared"       (default) — one cursor across all instances. SKIP LOCKED
  //                   serialises; each event delivered exactly once globally.
  //   "per-instance" — one cursor per (name, dispatcher.instanceId) shard.
  //                   Every process delivers every event independently. For
  //                   push-to-local-subscribers (SSE broker, in-memory cache
  //                   invalidators). Handler MUST be side-effect-free with
  //                   respect to shared storage (no DB writes), otherwise
  //                   each instance duplicates the effect.
  readonly delivery?: "shared" | "per-instance";
};

// Result of a dispatcher pass (runOnce / doPass). Shared across the public
// interface and the internal helpers so all three sites agree on the shape
// — adding a counter in one place wouldn't have compiled on the others
// when the type was inlined in each signature.
export type DispatcherPassResult = {
  readonly processed: number;
  readonly failed: number;
  readonly byConsumer: Record<string, { processed: number; failed: number }>;
};

export type EventDispatcher = {
  start(): Promise<void>;
  stop(): Promise<void>;
  // Force one pass now (tests drain deterministically via this).
  // Throws if start() was never called — pre-registration of consumer
  // state rows is a precondition, not a side-effect of the pass itself.
  runOnce(): Promise<DispatcherPassResult>;
  // Idempotent re-pre-registration of consumer state rows. Exists as a
  // test-teardown surface: after `TRUNCATE kumiko_event_consumers` the
  // rows are gone, and strict acquire() would skip every consumer as
  // "not_registered". Tests call ensureRegistered() to repopulate without
  // a full stop/start cycle. Production never needs this — start() runs
  // it once on boot and the rows survive dispatcher lifetime.
  ensureRegistered(): Promise<void>;
  // Read-only view of the consumers this dispatcher is wired with. Exists
  // for lane-filter assertions (Welle 2.6.b split-deploy tests) and for
  // the boot-validator (Welle 2.6.c coverage check: every registered MSP
  // must appear in at least one process's dispatcher). No runtime semantics
  // — the list doesn't change after construction.
  readonly consumers: readonly EventConsumer[];
};

export type EventDispatcherOptions = {
  readonly db: import("../db/connection").DbConnection;
  readonly consumers: readonly EventConsumer[];
  readonly context: AppContext;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly maxAttempts?: number;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  // Identifies THIS dispatcher process in the consumer-state table. Used as
  // the `instance_id` value for every per-instance consumer's cursor row.
  // Shared-delivery consumers ignore this and always use
  // SHARED_INSTANCE_SENTINEL. Default undefined — dispatchers without any
  // per-instance consumers don't need it. Required when at least one
  // consumer has delivery="per-instance"; createEventDispatcher throws on
  // boot if the invariant is violated, avoiding a later runtime surprise.
  readonly instanceId?: string;
  // Optional raw postgres.js client for LISTEN/NOTIFY-based wake-up
  // (Sprint E.4). When present, `.start()` subscribes to EVENTS_PUBSUB_CHANNEL
  // and fires runOnce on each NOTIFY — delivery latency becomes TCP-round-
  // trip instead of pollIntervalMs. The polling timer remains active as a
  // safety net (missed NOTIFYs from crashes, subscription drops).
  readonly pgClient?: PgClient;
};

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_POLL_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 10;

export function createEventDispatcher(options: EventDispatcherOptions): EventDispatcher {
  const {
    db,
    consumers,
    context,
    batchSize = DEFAULT_BATCH_SIZE,
    pollIntervalMs = DEFAULT_POLL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;

  // Fail-fast on misconfigured per-instance wiring. Catching this at
  // construction surfaces the problem in boot logs instead of first
  // delivery attempt — where it would land as a confusing preRegister
  // throw much later in the startup sequence.
  for (const consumer of consumers) {
    if (consumer.delivery === "per-instance" && !options.instanceId) {
      throw new Error(
        `EventConsumer "${consumer.name}" has delivery="per-instance" but EventDispatcherOptions.instanceId is missing. ` +
          `Pass ServerOptions.instanceId (defaults to KUMIKO_INSTANCE_ID or a boot-time UUID) when any consumer uses per-instance delivery.`,
      );
    }
  }
  if (options.instanceId === SHARED_INSTANCE_SENTINEL) {
    throw new Error(
      `EventDispatcherOptions.instanceId cannot equal the reserved sentinel "${SHARED_INSTANCE_SENTINEL}". ` +
        `Pick any other stable string (typically KUMIKO_INSTANCE_ID from the deploy env).`,
    );
  }
  const tracer: Tracer = options.tracer ?? getFallbackTracer();
  const meter: Meter = options.meter ?? getFallbackMeter();

  let running = false;
  // Separate from `running` on purpose: pre-registration of consumer state
  // rows is a one-time boot action, while running/timer/LISTEN is a
  // lifecycle toggle. stop() flips running back to false but leaves
  // preRegistered true — a subsequent runOnce() is still safe because the
  // state rows are in place. Production code never stops-then-runs-once;
  // tests do (drain on-demand without a timer loop).
  let preRegistered = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // LISTEN subscription handle. Set when .start() successfully subscribed
  // to EVENTS_PUBSUB_CHANNEL; cleared by .stop(). The timer remains active
  // even with LISTEN attached — it's a cheap safety net against missed
  // NOTIFYs (subscription drop, crash mid-commit).
  let pgUnlisten: (() => Promise<void>) | null = null;

  // Serialises concurrent runOnce() calls from both wake-up sources (timer
  // + any future explicit nudge). Mirrors outbox-poller's passInFlight
  // pattern so behaviour under races stays predictable.
  let passInFlight: Promise<DispatcherPassResult> | null = null;

  async function runOnce(): Promise<DispatcherPassResult> {
    if (!preRegistered) {
      throw new Error(
        "EventDispatcher.runOnce() called before start() — consumer state rows are not registered. Call start() first (production) or ensureRegistered() (tests after truncating kumiko_event_consumers).",
      );
    }
    if (passInFlight) return passInFlight;
    passInFlight = doPass();
    try {
      return await passInFlight;
    } finally {
      passInFlight = null;
    }
  }

  async function doPass(): Promise<DispatcherPassResult> {
    let totalProcessed = 0;
    let totalFailed = 0;
    const byConsumer: Record<string, { processed: number; failed: number }> = {};

    // Feature-toggle snapshot taken once per pass (not per consumer): all
    // consumers see the same disabled-set even if an operator flips a
    // toggle mid-pass, so "this event batch" decisions stay consistent.
    //
    // Sprint-8a tier-composition: per-tenant resolver per-pass-konsultiert
    // mit SYSTEM_TENANT_ID. Async-events sind tier-agnostic — wenn ein
    // Tenant downgrade'd, sollen seine queued events trotzdem verarbeitet
    // werden (events sind immutable, projection ist eventually-consistent).
    // Tier-cuts wirken request-time im sync-dispatcher + lifecycle-pipeline,
    // nicht im async-replay. App-level resolver entscheidet was er bei
    // SYSTEM_TENANT_ID returnt (typisch: union-of-all-tier-features).
    const effective = context.effectiveFeatures?.(SYSTEM_TENANT_ID);

    // Seriell pro consumer. Parallelisierung wäre möglich (je eigene TX), aber
    // das einfache Modell reicht für v1 — jeder consumer hat geringe
    // per-event-Arbeit (network call at worst). Bei hunderten Events pro
    // Batch lohnt sich Parallelisierung — Optimierung für später.
    for (const consumer of consumers) {
      // Feature-gate: consumers tagged with a featureName get paused while
      // that feature is globally disabled. Cursor stays put — events accumulate
      // and are re-delivered in order when the feature is re-enabled.
      if (effective && consumer.featureName && !effective.has(consumer.featureName)) {
        byConsumer[consumer.name] = { processed: 0, failed: 0 };
        continue;
      }
      const perConsumer = await processConsumer(consumer);
      byConsumer[consumer.name] = perConsumer;
      totalProcessed += perConsumer.processed;
      totalFailed += perConsumer.failed;
    }

    return { processed: totalProcessed, failed: totalFailed, byConsumer };
  }

  async function processConsumer(
    consumer: EventConsumer,
  ): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    const instanceId = consumerInstanceId(consumer, options.instanceId);

    const span = tracer.startSpan("events.consumer.pass", {
      attributes: {
        "consumer.name": consumer.name,
        "consumer.instance_id": instanceId,
      },
    });

    try {
      await db.begin(async (tx: DbTx) => {
        const acquired = await acquireConsumerState(tx, consumer.name, instanceId);
        // skip: another instance holds the lock, or the consumer is
        // disabled/dead. Nothing to deliver this pass.
        if (acquired.skip !== null) {
          span.setAttribute("consumer.skip_reason", acquired.skip);
          return;
        }

        const events = await fetchPendingEvents(tx, acquired.state.lastProcessedEventId, batchSize);
        // skip: nothing to deliver — no markProcessing/persistConsumerOutcome write,
        // so an idle consumer doesn't burn a WAL record on every poll tick.
        if (events.length === 0) {
          span.setAttribute("consumer.skip_reason", "no_pending_events");
          return;
        }
        await markProcessing(tx, consumer.name, instanceId);

        const outcome = await deliverEvents(consumer, events, context, maxAttempts, acquired.state);
        processed = outcome.processed;
        failed = outcome.failed;

        await persistConsumerOutcome(tx, consumer.name, instanceId, outcome);
        await emitLagFromTx(tx, consumer.name, instanceId, outcome.cursor, meter);
      });

      emitEventConsumerPassOutcome(
        meter,
        { consumer: consumer.name, instanceId },
        processed,
        failed,
      );
      span.setAttribute("consumer.processed", processed);
      span.setAttribute("consumer.failed", failed);
      span.setStatus(failed === 0 ? "ok" : "error");
    } catch (e) {
      // Unexpected: a handler error is caught inside deliverEvents and
      // surfaces via `failed`, so anything landing here is infrastructure
      // (db connection lost, serialization, standard-metrics not registered
      // on this meter). Don't let one consumer's outage stall the others,
      // but do log — a silent rollback here looks like "at-most-once" to
      // callers and at-least-once-with-duplicate-delivery on the next pass;
      // neither is what we want, so ops needs to see it.
      const msg = e instanceof Error ? e.message : String(e);
      context.log?.error(`[event-dispatcher] ${consumer.name} pass failed: ${msg}`);
      span.setStatus("error", msg);
    } finally {
      span.end();
    }

    return { processed, failed };
  }

  return {
    consumers,
    async start() {
      // skip: already running, idempotent
      if (running) return;
      running = true;

      // Pre-register consumer state rows. Without this, a consumer first
      // bootstraps lazily on its first runOnce — and if prune runs between
      // "process came up" and "first pass landed", prune wouldn't see the
      // consumer in the state table, would delete events past its (absent)
      // cursor, and the consumer's first pass would silently skip them.
      //
      // Pre-registering turns every consumer into a row-with-cursor-0 the
      // moment the dispatcher starts — so the retention guard
      // (pruneEvents → ConsumerLagError) correctly refuses to prune past
      // any consumer that exists, including freshly-deployed ones.
      await preRegisterConsumers(db, consumers, options.instanceId);
      preRegistered = true;

      timer = setInterval(() => {
        void runOnce().catch(() => {
          // skip: per-consumer errors already recorded in the state row
        });
      }, pollIntervalMs);

      // NOTIFY-based wake-up: subscribe on the same channel that
      // event-store.append fires on commit. Fires runOnce directly, no
      // polling round-trip. The timer stays on as a belt-and-braces
      // fallback (dropped subscriptions, missed commits under load).
      //
      // Observability: the gauge kumiko_event_dispatcher_listen_connected
      // flips to 1 on initial subscribe AND on every postgres.js silent
      // reconnect (via the onlisten callback). A drop to 0 while running
      // means delivery latency regressed from TCP-round-trip to
      // pollIntervalMs — ops-visible.
      emitEventDispatcherListenConnected(meter, false);
      if (options.pgClient) {
        try {
          const sub = await options.pgClient.listen(
            EVENTS_PUBSUB_CHANNEL,
            () => {
              void runOnce().catch(() => {
                // skip: per-consumer errors already recorded in the state row
              });
            },
            () => {
              // Fires on initial connect AND on each reconnect. postgres.js
              // reconnects transparently if the TCP connection drops, so the
              // only way to see the recovery window is to flip the gauge
              // every time this callback lands.
              emitEventDispatcherListenConnected(meter, true);
            },
          );
          pgUnlisten = sub.unlisten;
        } catch (e) {
          emitEventDispatcherListenConnected(meter, false);
          const msg = e instanceof Error ? e.message : String(e);
          context.log?.error(`[event-dispatcher] pg LISTEN failed: ${msg}`);
        }
      }
    },

    async stop() {
      // skip: already stopped, idempotent
      if (!running) return;
      running = false;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (pgUnlisten) {
        await pgUnlisten().catch(() => {
          // skip: unlisten failure only matters during shutdown — the
          // subscription is being torn down anyway.
        });
        pgUnlisten = null;
        emitEventDispatcherListenConnected(meter, false);
      }

      // Drain any in-flight pass so shutdown observes consistent state.
      if (passInFlight) {
        await passInFlight.catch(() => {
          // skip: errors already recorded per-consumer inside the pass
        });
      }
      // preRegistered stays true — the rows survive stop(). runOnce()
      // after a stop() still works (tests stop the timer and then drain
      // deterministically).
    },

    async ensureRegistered() {
      await preRegisterConsumers(db, consumers, options.instanceId);
      preRegistered = true;
    },

    runOnce,
  };
}

export type { ConsumerProgress, ConsumerRecoveryState } from "./event-dispatcher-admin";
export {
  disableConsumer,
  enableConsumer,
  getAllConsumerProgress,
  getConsumerState,
  listConsumersWithState,
  restartConsumer,
  skipPoisonEvent,
} from "./event-dispatcher-admin";
