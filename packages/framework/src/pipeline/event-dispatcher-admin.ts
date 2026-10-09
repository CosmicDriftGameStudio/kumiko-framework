/// <reference types="temporal-polyfill/global" preserve="true" />
import type { DbConnection, DbTx } from "../db/connection.js";
import {
  advanceConsumerPastEventReturning,
  removePendingGapReturning,
  selectConsumerForUpdate,
  selectSnapshotXmax,
  updateConsumerStatusReturning,
} from "../db/queries/event-consumer.js";
import {
  selectNextEventIdAfter,
  selectSmallestVisibleIdInRanges,
} from "../db/queries/event-store.js";
import { coerceRow, extractTableInfo, selectMany } from "../db/query.js";
import { getEventsHighWaterMark } from "../event-store/index.js";
import {
  eventConsumerStateTable,
  type PendingGapEntry,
  SHARED_INSTANCE_SENTINEL,
} from "./event-consumer-state.js";
import type { ConsumerStateRow, ConsumerStateRowShape } from "./event-dispatcher-delivery.js";
import {
  mergeContiguousGapRanges,
  rangeContainsId,
  splitRangeExcludingIds,
  toIdRanges,
} from "./pending-gap-ranges.js";

// --- Ops recovery surface ---
//
// These are intentionally verb-distinct; each maps to a CLI sub-command.
// They all target a single consumer row by name. Every call returns the
// state after the write so the CLI can echo what actually changed.
//
// Semantics:
//   restartConsumer   status="dead" → "idle", attempts=0, lastError=null.
//                     Cursor unchanged → next pass retries the SAME event
//                     that poisoned the consumer. For transient failures.
//   disableConsumer   status=* → "disabled". Dispatcher skips this consumer
//                     until enableConsumer() flips it back.
//   enableConsumer    status="disabled" → "idle". No-op on any other state.
//   skipPoisonEvent   cursor advances past the first event after the
//                     current cursor (the one that's failing). attempts=0,
//                     lastError=null, status="idle". For events that will
//                     never succeed (broken payload, removed feature code).

function normalizeConsumerState(row: ConsumerStateRowShape): ConsumerRecoveryState {
  return {
    name: row.name,
    instanceId: row.instanceId,
    status: row.status,
    lastProcessedEventId: row.lastProcessedEventId,
    attempts: row.attempts,
    rearmCount: row.rearmCount,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export type ConsumerRecoveryState = {
  readonly name: string;
  readonly instanceId: string;
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly attempts: number;
  readonly rearmCount: number;
  readonly lastError: string | null;
  readonly updatedAt: Temporal.Instant;
};

// Ops calls default to the SHARED_INSTANCE_SENTINEL row — that's the only
// row shared-delivery consumers have, so legacy CLI invocations without
// --instance-id keep working. Per-instance consumers require an explicit
// instanceId: picking one of N shards arbitrarily ("first row wins") or
// mutating all shards simultaneously ("bounce every instance") are both
// worse than a loud missing-arg error on the CLI.
async function requireConsumerRow(
  db: DbConnection,
  name: string,
  instanceId: string,
): Promise<ConsumerStateRowShape> {
  const [row] = await selectMany<ConsumerStateRow>(db, eventConsumerStateTable, {
    name,
    instanceId,
  });
  if (!row) {
    throw new Error(
      `Consumer "${name}" (instance_id="${instanceId}") has no state row — it hasn't run yet, the name is misspelled, or the instance is misspelled. ` +
        `For per-instance consumers pass the instance_id explicitly; shared consumers use the default.`,
    );
  }
  return row;
}

async function requireConsumerRowForUpdate(
  tx: DbTx,
  name: string,
  instanceId: string,
): Promise<ConsumerStateRowShape> {
  const raw = await selectConsumerForUpdate(tx, name, instanceId);
  if (!raw) {
    throw new Error(
      `Consumer "${name}" (instance_id="${instanceId}") has no state row — it hasn't run yet, the name is misspelled, or the instance is misspelled. ` +
        `For per-instance consumers pass the instance_id explicitly; shared consumers use the default.`,
    );
  }
  return coerceRow(raw, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow;
}

async function applyConsumerStatusTransition(
  db: DbConnection,
  name: string,
  instanceId: string,
  targetStatus: "idle" | "disabled",
): Promise<ConsumerRecoveryState> {
  const raw = await updateConsumerStatusReturning(db, name, instanceId, targetStatus);
  const updated =
    raw && (coerceRow(raw, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow);
  if (!updated) {
    throw new Error(
      `Consumer "${name}" (instance_id="${instanceId}") vanished between read and write — retry.`,
    );
  }
  return normalizeConsumerState(updated);
}

export async function restartConsumer(
  db: DbConnection,
  name: string,
  instanceId: string = SHARED_INSTANCE_SENTINEL,
): Promise<ConsumerRecoveryState> {
  const before = await requireConsumerRow(db, name, instanceId);
  if (before.status !== "dead") {
    throw new Error(
      `Consumer "${name}" (instance_id="${instanceId}") is not dead (status="${before.status}"). Restart only applies to dead consumers; use "enable" for a disabled one.`,
    );
  }
  return applyConsumerStatusTransition(db, name, instanceId, "idle");
}

export async function disableConsumer(
  db: DbConnection,
  name: string,
  instanceId: string = SHARED_INSTANCE_SENTINEL,
): Promise<ConsumerRecoveryState> {
  await requireConsumerRow(db, name, instanceId);
  return applyConsumerStatusTransition(db, name, instanceId, "disabled");
}

export async function enableConsumer(
  db: DbConnection,
  name: string,
  instanceId: string = SHARED_INSTANCE_SENTINEL,
): Promise<ConsumerRecoveryState> {
  const before = await requireConsumerRow(db, name, instanceId);
  if (before.status !== "disabled") {
    throw new Error(
      `Consumer "${name}" (instance_id="${instanceId}") is not disabled (status="${before.status}"). Enable only flips disabled → idle; use "restart" for a dead consumer.`,
    );
  }
  return applyConsumerStatusTransition(db, name, instanceId, "idle");
}

// Delivery stops at the poison event, so ids between the cursor and it were
// invisible during that pass (in-flight commits); keeping them as a pending gap
// avoids losing them when the cursor jumps over.
async function invisibleWindowGap(
  tx: DbTx,
  cursor: bigint,
  poisonId: bigint,
): Promise<PendingGapEntry | null> {
  const windowStart = cursor + 1n;
  if (poisonId <= windowStart) return null;
  return {
    from: windowStart.toString(),
    to: (poisonId - 1n).toString(),
    xmax: await selectSnapshotXmax(tx),
  };
}

// skipPoisonEvent skips the event whose handler failed last
// (last_failed_event_id, set by the delivery's halt-on-poison branch): inside
// pending_gaps it is split out of its range, otherwise the cursor moves onto
// it. Without a recorded id (consumer parked before that column existed) it
// falls back to a guess: the smallest visible pending-gap id, else the next
// event after the cursor. Single TX so concurrent dispatcher passes can't
// double-advance. Nothing to skip → idempotent no-op.
export async function skipPoisonEvent(
  db: DbConnection,
  name: string,
  instanceId: string = SHARED_INSTANCE_SENTINEL,
): Promise<ConsumerRecoveryState & { readonly skippedEventId: bigint | null }> {
  return db.begin(async (tx: DbTx) => {
    // Locked read: a dispatcher turn committing new gaps between an unlocked
    // read and the pending_gaps overwrite below would have them dropped.
    const before = await requireConsumerRowForUpdate(tx, name, instanceId);
    const pendingGaps = before.pendingGaps;
    const failedEventId = before.lastFailedEventId;
    const failedIsPending =
      failedEventId !== null && pendingGaps.some((gap) => rangeContainsId(gap, failedEventId));
    const failedIsAboveCursor =
      failedEventId !== null && failedEventId > before.lastProcessedEventId;

    const pendingPoisonId = failedIsPending
      ? failedEventId
      : failedIsAboveCursor
        ? null
        : await selectSmallestVisibleIdInRanges(tx, toIdRanges(pendingGaps));

    if (pendingPoisonId !== null) {
      const newPendingGaps = pendingGaps.flatMap((gap) =>
        rangeContainsId(gap, pendingPoisonId)
          ? splitRangeExcludingIds(gap, [pendingPoisonId])
          : [gap],
      );
      const raw = await removePendingGapReturning(
        tx,
        name,
        instanceId,
        mergeContiguousGapRanges(newPendingGaps),
      );
      const updated =
        raw && (coerceRow(raw, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow);
      if (!updated)
        throw new Error(
          `Consumer "${name}" (instance_id="${instanceId}") vanished mid-skip — retry.`,
        );
      return { ...normalizeConsumerState(updated), skippedEventId: pendingPoisonId };
    }

    const poisonId = failedIsAboveCursor
      ? failedEventId
      : await selectNextEventIdAfter(tx, before.lastProcessedEventId);
    if (poisonId === null) {
      const [unchanged] = await selectMany<ConsumerStateRow>(tx, eventConsumerStateTable, {
        name,
        instanceId,
      });
      if (!unchanged)
        throw new Error(`Consumer "${name}" (instance_id="${instanceId}") vanished — retry.`);
      return { ...normalizeConsumerState(unchanged), skippedEventId: null };
    }
    // Delivery stops at the poison event, so ids between the cursor and it were
    // invisible during that pass (in-flight commits). Jumping the cursor over them
    // would lose them; keep them as a pending gap like the dispatcher's own gaps.
    const gapToAdd = await invisibleWindowGap(tx, before.lastProcessedEventId, poisonId);
    const raw = await advanceConsumerPastEventReturning(
      tx,
      name,
      instanceId,
      poisonId,
      mergeContiguousGapRanges(gapToAdd ? [...pendingGaps, gapToAdd] : pendingGaps),
    );
    const updated =
      raw && (coerceRow(raw, extractTableInfo(eventConsumerStateTable)) as ConsumerStateRow);
    if (!updated)
      throw new Error(
        `Consumer "${name}" (instance_id="${instanceId}") vanished mid-skip — retry.`,
      );
    return { ...normalizeConsumerState(updated), skippedEventId: poisonId };
  });
}

// Read-only status for one consumer shard — CLI surface.
export async function getConsumerState(
  db: DbConnection,
  name: string,
  instanceId: string = SHARED_INSTANCE_SENTINEL,
): Promise<{
  readonly name: string;
  readonly instanceId: string;
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly attempts: number;
  readonly rearmCount: number;
  readonly lastError: string | null;
  readonly updatedAt: Temporal.Instant;
} | null> {
  const [row] = await selectMany<ConsumerStateRow>(db, eventConsumerStateTable, {
    name,
    instanceId,
  });
  if (!row) return null;
  return {
    name: row.name,
    instanceId: row.instanceId,
    status: row.status,
    lastProcessedEventId: row.lastProcessedEventId,
    attempts: row.attempts,
    rearmCount: row.rearmCount,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

// List every consumer the registry knows about, joined with all shard rows
// from the state table. One entry per (name, instance_id) shard. Consumers
// that have never run appear with status="never-run" and instance_id =
// SHARED_INSTANCE_SENTINEL — a placeholder, because without a running
// dispatcher we can't know the instance-ids of per-instance consumers yet.
// Mirrors listProjectionsWithState — the registry (not the DB) is the
// source-of-truth for which consumer-names exist; the DB is the source-
// of-truth for which instance-shards have been seen.
export async function listConsumersWithState(
  db: DbConnection,
  registeredNames: readonly string[],
): Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly instanceId: string;
    readonly status: string;
    readonly lastProcessedEventId: bigint;
    readonly attempts: number;
    readonly lastError: string | null;
  }>
> {
  const stateRows = await selectMany<ConsumerStateRow>(db, eventConsumerStateTable);
  const registered = new Set(registeredNames);

  // Materialize one output row per (name, instance_id). Registered names
  // without any shard (never-run) get a placeholder row so ops can still
  // see the name exists.
  const out: Array<{
    name: string;
    instanceId: string;
    status: string;
    lastProcessedEventId: bigint;
    attempts: number;
    lastError: string | null;
  }> = [];

  const seenNames = new Set<string>();
  for (const r of stateRows) {
    if (!registered.has(r.name)) continue; // stale row from an older deploy
    seenNames.add(r.name);
    out.push({
      name: r.name,
      instanceId: r.instanceId,
      status: r.status,
      lastProcessedEventId: r.lastProcessedEventId,
      attempts: r.attempts,
      lastError: r.lastError,
    });
  }
  for (const name of registeredNames) {
    if (seenNames.has(name)) continue;
    out.push({
      name,
      instanceId: SHARED_INSTANCE_SENTINEL,
      status: "never-run",
      lastProcessedEventId: 0n,
      attempts: 0,
      lastError: null,
    });
  }
  return out;
}

export type ConsumerProgress = {
  readonly name: string;
  readonly instanceId: string;
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly attempts: number;
  readonly lastError: string | null;
  // Global MAX(events.id) at query time.
  readonly highWaterMark: bigint;
  // HWM - cursor. 0n when caught-up. Disabled consumers often show high
  // lag intentionally (ops parks them before pruning).
  readonly lag: bigint;
};

// Like listConsumersWithState, but also returns HWM + lag per consumer.
// Async consumers (MSPs) lag behind inline projections because they run
// post-commit — lag is the primary signal for backpressure, dead consumers,
// or dispatcher stalls. Programmatic callers can map the result to a
// `kumiko_consumer_lag{name}` Prometheus gauge.
// guard:dup-ok — intentionale Parallele zu getAllProjectionProgress; Consumer ≠ Projection (verschiedene Subsysteme)
export async function getAllConsumerProgress(
  db: DbConnection,
  registeredNames: readonly string[],
): Promise<readonly ConsumerProgress[]> {
  const [consumers, highWaterMark] = await Promise.all([
    listConsumersWithState(db, registeredNames),
    getEventsHighWaterMark(db),
  ]);

  return consumers.map((c) => ({
    ...c,
    highWaterMark,
    lag: highWaterMark - c.lastProcessedEventId,
  }));
}
