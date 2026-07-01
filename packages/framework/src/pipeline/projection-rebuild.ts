import type { DbConnection, DbTx } from "../db/connection";
import {
  countSubscribedEvents,
  finalizeProjectionRebuild,
  markProjectionRebuildFailed,
  markProjectionRebuilding,
  selectEventsForProjectionRebuildBatch,
} from "../db/queries/projection-rebuild";
import {
  buildShadowTable,
  ensureRebuildSchema,
  fenceLiveTable,
  rebuildMetaOrThrow,
  swapShadowIntoLive,
} from "../db/queries/shadow-swap";
import { coerceRow, extractTableInfo, runInSavepoint, selectMany } from "../db/query";
import type { Registry, TenantId } from "../engine/types";
import {
  eventsTable,
  getEventsHighWaterMark,
  type StoredEvent,
  upcastStoredEvent,
} from "../event-store";
import type { EventMetadata } from "../event-store/event-store";
import {
  createRebuildDeadLetterTable,
  recordRebuildDeadLetters,
  type SkippedApply,
} from "../event-store/rebuild-dead-letter";
import { emitProjectionRebuild } from "../observability/standard-metrics";
import type { Meter } from "../observability/types/metric";
import { projectionStateTable } from "./projection-state";

// Events replayed per catch-up batch. Each batch is a fresh READ COMMITTED
// SELECT, so a batch shorter than this means the currently-committed tail is
// drained.
const REBUILD_BATCH_SIZE = 1000;

// Cap on UNLOCKED catch-up batches before forcing the cutover fence. Bounds the
// lock-free phase under sustained writes that never momentarily quiesce; the
// fenced final drain then always terminates (no new event can commit once the
// live table is held ACCESS EXCLUSIVE).
const MAX_UNLOCKED_BATCHES = 10_000;

const DEFAULT_FENCE_LOCK_TIMEOUT_MS = 5_000;

type StoredEventRow = {
  id: bigint;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  version: number;
  type: string;
  eventVersion: number;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
  createdAt: Temporal.Instant;
  createdBy: string;
};

function rowToStoredEvent(row: StoredEventRow): StoredEvent {
  return {
    id: String(row.id),
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    tenantId: row.tenantId,
    version: row.version,
    type: row.type,
    eventVersion: row.eventVersion,
    payload: row.payload,
    metadata: row.metadata,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

// Rebuild a projection from the event log — online, via a shadow swap with a
// live-tail catch-up.
//
// Mechanics:
//   1. Lock the projection's state row (INSERT … ON CONFLICT DO UPDATE takes
//      a row lock held to commit). Concurrent rebuilds of the same projection
//      — including across pods — block here instead of racing.
//   2. Mark status = "rebuilding".
//   3. Build a shadow table in a private schema (see db/queries/shadow-swap),
//      with search_path pointed there so apply-writes land in the shadow.
//   4. Unlocked catch-up: replay events in chronological batches into the
//      shadow until a short batch signals the currently-committed tail. Single-
//      stream projections apply SYNCHRONOUSLY in the appending tx, so live
//      writers keep updating public.<table> meanwhile; READ COMMITTED makes
//      each fresh batch see their newly-committed events.
//   5. Fence: take ACCESS EXCLUSIVE on the live table (bounded by lock_timeout),
//      then drain the final delta. Once fenced, no new event can commit, so the
//      shadow ends up reflecting every event the live table reflects — the
//      writes that land DURING the replay are no longer lost.
//   6. Store the last processed event-id + mark status = "idle".
//   7. Swap: DROP the live table + ALTER the shadow into public.
//
// All of that runs in ONE transaction. If apply (or the fence's lock_timeout)
// throws partway through, Postgres rolls back everything — the shadow is
// discarded, the live table was never touched (the swap is the last step),
// status is recorded "failed" via the outer catch with lastError. A
// partial/empty projection is never observable.
//
// Cutover semantics: the fence blocks concurrent synchronous applies for the
// final-drain + swap window only (not the whole replay). A live write blocked
// THROUGH the swap is one atomic append+apply tx; whichever way Postgres
// resolves the dropped-OID reference, the event INSERT and the projection row
// commit or roll back together (no event ⟺ no row). See the cutover test for
// the empirically-pinned behavior.
//
// Boundaries:
//   - Not multi-pod zero-downtime on its own: during a rolling deploy, old pods
//     still running cannot read the new shape after the swap. End-to-end ZD
//     also needs app-author expand/contract discipline (see the plan doc).
//   - The shadow is rebuilt from EntityTableMeta, so an index hand-added in a
//     migration but absent from meta is not reconstructed.
//   - Requires CREATE privilege to provision the shared rebuild schema.
//   - id-order != commit-order (bigserial assigns ids pre-commit), so a
//     cross-aggregate write can COMMIT an event id BELOW the cursor after the
//     unlocked drain already passed it. Caught under the fence: a count
//     re-check against the (now final) event set detects the shortfall and
//     re-replays the full log into a fresh shadow. #443.

export type RebuildResult = {
  readonly projection: string;
  // Events consumed from the log — includes quarantined ones (the cursor
  // advanced past them).
  readonly eventsProcessed: number;
  // Poison events quarantined into kumiko_rebuild_dead_letters this run.
  // Always 0 unless quarantine mode was active (#760).
  readonly eventsSkipped: number;
  readonly lastProcessedEventId: bigint;
  readonly durationMs: number;
};

type RebuildDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  // Optional framework meter. When provided, the runner emits the two
  // projection-rebuild metrics (duration histogram + events counter) on both
  // success and failure paths — the Prometheus-facing surface. CLI callers
  // can leave it undefined and rely on stdout feedback.
  readonly meter?: Meter;
  // Lightweight observation callback for tests that want to assert the
  // RebuildResult without spinning up a full meter. Independent of `meter`.
  readonly onMetrics?: (result: RebuildResult) => void;
  // Cancellation. Checked before each event-apply. The transaction is
  // rolled back on abort — a partial rebuild is never observable. Useful
  // when an HTTP-triggered rebuild needs to honour client disconnect, or
  // when a CLI/Job wraps the rebuild in its own AbortController for ops
  // timeout enforcement.
  readonly signal?: AbortSignal;
  // Cutover fence lock_timeout (ms). The final catch-up takes ACCESS EXCLUSIVE
  // on the live table; if a long-running writer holds it past this, the rebuild
  // fails loud instead of hanging. Defaults to DEFAULT_FENCE_LOCK_TIMEOUT_MS.
  readonly fenceLockTimeoutMs?: number;
  // Apply-error policy for THIS run. Default strict: the first throwing
  // apply aborts the rebuild (tx rollback, status "failed") — a poison
  // event makes the projection permanently un-rebuildable (#760).
  // skipApplyErrors: true confines every apply to a savepoint; a throwing
  // apply is rolled back, recorded into kumiko_rebuild_dead_letters and
  // skipped, and the rebuild completes without its effect. Opt-in for
  // operators unblocking a pinned rebuild — the projection then knowingly
  // misses the quarantined events until they are repaired and replayed.
  readonly errorPolicy?: { readonly skipApplyErrors?: boolean };
  // Test-only seam: fires once after the unlocked bulk drain and before the
  // cutover fence. Lets a concurrency test inject a committed write into the
  // replay window deterministically. The `__test_` prefix marks it test-only:
  // a slow callback here delays the cutover fence acquisition, widening the
  // window in which concurrent writers can still commit below the cursor.
  readonly __test_onBeforeFence?: () => void | Promise<void>;
  // Test-only seam: fires each time the shadow table is (re)built. The #443
  // recompute is idempotent on final values, so only a call-count seam like
  // this can prove it didn't fire on a clean, non-concurrent rebuild.
  readonly __test_onBuildShadowTable?: () => void;
};

export async function rebuildProjection(
  projectionName: string,
  deps: RebuildDeps,
): Promise<RebuildResult> {
  const { db, registry } = deps;
  const projection = registry.getAllProjections().get(projectionName);
  if (!projection) {
    throw new Error(
      `Projection "${projectionName}" is not registered. Known: ${
        [...registry.getAllProjections().keys()].join(", ") || "(none)"
      }`,
    );
  }

  const meta = rebuildMetaOrThrow(projection.table, projectionName);

  const sources = Array.isArray(projection.source) ? projection.source : [projection.source];
  const sourcesList = [...sources];
  const subscribedList = Object.keys(projection.apply);
  // Upcasters run at read time: older stored payloads get walked through the
  // registered r.eventMigration chain until their shape matches the current
  // event version.
  const upcasters = registry.getEventUpcasters();
  const eventsInfo = extractTableInfo(eventsTable);
  const fenceLockTimeoutMs = deps.fenceLockTimeoutMs ?? DEFAULT_FENCE_LOCK_TIMEOUT_MS;
  const startedAt = Date.now();
  let eventsProcessed = 0;
  let lastProcessedEventId = 0n;
  const skipApplyErrors = deps.errorPolicy?.skipApplyErrors === true;
  // Quarantined events, collected in memory and written once after the
  // replay settles — the #443 full-re-replay path would otherwise duplicate
  // the dead-letter rows.
  let skipped: SkippedApply[] = [];

  // One chronological batch of events after lastProcessedEventId, applied into
  // the shadow. Returns the batch size so the caller can detect the tail
  // (a short batch = no more currently-committed events).
  const drainBatch = async (tx: DbTx): Promise<number> => {
    const rawEvents = await selectEventsForProjectionRebuildBatch(
      tx,
      sourcesList,
      subscribedList,
      lastProcessedEventId,
      REBUILD_BATCH_SIZE,
    );
    for (const r of rawEvents) {
      deps.signal?.throwIfAborted();
      const row = coerceRow(r, eventsInfo) as StoredEventRow;
      const storedEvent = await upcastStoredEvent(rowToStoredEvent(row), upcasters, {
        db: tx,
        tenantId: row.tenantId as TenantId, // @cast-boundary db-row
      });
      const applyFn = projection.apply[row.type];
      // skip: apply-key validation ensures every subscribed type has a handler;
      //       defensive check against runtime-mutated registry
      if (!applyFn) continue;
      if (skipApplyErrors) {
        // Driver-native savepoint: a throwing SQL statement would otherwise
        // poison the rebuild tx (25P02) AND make the driver reject the whole
        // begin() even after a caught error. The apply runs on the
        // savepoint-scoped handle so its statements are confined.
        try {
          await runInSavepoint(tx, async (sp) => {
            await applyFn(storedEvent, sp as DbTx, projection.table);
          });
        } catch (e) {
          skipped.push({ event: storedEvent, error: e });
        }
      } else {
        await applyFn(storedEvent, tx, projection.table);
      }
      eventsProcessed++;
      lastProcessedEventId = row.id;
    }
    return rawEvents.length;
  };

  try {
    await ensureRebuildSchema(db);
    // Outside the rebuild tx, like the schema: idempotent DDL colliding
    // inside the tx would roll the whole replay back.
    if (skipApplyErrors) await createRebuildDeadLetterTable(db);
    await db.begin(async (tx: DbTx) => {
      await markProjectionRebuilding(tx, projectionName);
      await buildShadowTable(tx, meta);
      deps.__test_onBuildShadowTable?.();

      // A projection that subscribes to nothing has no events to replay and no
      // live writer touching its table — skip straight to swapping the empty
      // shadow (no fence needed).
      if (subscribedList.length > 0) {
        // Unlocked catch-up: drain batches until a short batch signals the
        // currently-committed tail. Live synchronous applies keep writing to
        // public.<table> meanwhile; READ COMMITTED makes each fresh batch see
        // their newly-committed events. Capped so sustained writes can't keep
        // the lock-free phase running forever.
        for (let batches = 0; batches < MAX_UNLOCKED_BATCHES; batches++) {
          if ((await drainBatch(tx)) < REBUILD_BATCH_SIZE) break;
        }

        // Test seam: inject a mid-replay committed write here to prove the
        // fenced final drain catches it instead of losing it at swap.
        await deps.__test_onBeforeFence?.();

        // Fence the live table, then drain the final delta. Once ACCESS
        // EXCLUSIVE is held no concurrent apply can commit a new event, so this
        // loop terminates and the shadow ends up reflecting every committed
        // event — closing Phase 1's write-loss window for single-pod rebuilds.
        await fenceLiveTable(tx, meta.tableName, fenceLockTimeoutMs);
        while ((await drainBatch(tx)) === REBUILD_BATCH_SIZE) {
          // keep draining full batches; a short batch ends the loop
        }

        // Fenced → the subscribed-event set is final (every live apply blocks
        // on the live-table lock). If fewer events were applied than exist, a
        // lower-id event committed late during the unlocked phase and the
        // id-cursor leapt past it (#443). Rebuild the shadow from scratch and
        // replay the whole log under the fence: a fresh shadow means no
        // double-apply (the rejected "re-drain into a populated shadow" hazard),
        // and the full-replay cost is paid only on this rare detected path.
        const expectedEvents = await countSubscribedEvents(tx, sourcesList, subscribedList);
        if (expectedEvents > BigInt(eventsProcessed)) {
          await buildShadowTable(tx, meta);
          deps.__test_onBuildShadowTable?.();
          lastProcessedEventId = 0n;
          eventsProcessed = 0;
          skipped = [];
          while ((await drainBatch(tx)) === REBUILD_BATCH_SIZE) {
            // re-replay the full log into the fresh shadow
          }
        }
      }

      if (skipped.length > 0) {
        await recordRebuildDeadLetters(tx, projectionName, skipped);
      }
      await finalizeProjectionRebuild(tx, projectionName, lastProcessedEventId);
      await swapShadowIntoLive(tx, meta.tableName);
    });
  } catch (e) {
    // Outer catch: TX has been rolled back by Postgres already. Record the
    // failure in a SEPARATE write so ops can see what happened.
    const message = e instanceof Error ? e.message : String(e);
    await markProjectionRebuildFailed(db, projectionName, message);
    // Failure metric: duration until throw, 0 events "delivered" (the replayed
    // rows were rolled back — counting them would overstate live delivery).
    // success=false label distinguishes these in Prom dashboards.
    if (deps.meter) {
      emitProjectionRebuild(
        deps.meter,
        { projection: projectionName, success: false },
        (Date.now() - startedAt) / 1000,
        0,
      );
    }
    throw e;
  }

  const result: RebuildResult = {
    projection: projectionName,
    eventsProcessed,
    eventsSkipped: skipped.length,
    lastProcessedEventId,
    durationMs: Date.now() - startedAt,
  };
  if (deps.meter) {
    emitProjectionRebuild(
      deps.meter,
      { projection: projectionName, success: true },
      result.durationMs / 1000,
      eventsProcessed,
    );
  }
  deps.onMetrics?.(result);
  return result;
}

// Read-only status for one projection. Returns null if the projection was
// registered but never rebuilt (no row yet).
export async function getProjectionState(
  db: DbConnection,
  projectionName: string,
): Promise<{
  readonly name: string;
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly lastRebuildAt: Temporal.Instant | null;
  readonly lastError: string | null;
  readonly updatedAt: Temporal.Instant;
} | null> {
  type Row = {
    readonly name: string;
    readonly status: string;
    readonly lastProcessedEventId: bigint;
    readonly lastRebuildAt: Temporal.Instant | null;
    readonly lastError: string | null;
    readonly updatedAt: Temporal.Instant;
  };
  const [row] = await selectMany<Row>(db, projectionStateTable, { name: projectionName });
  if (!row) return null;
  return {
    name: row.name,
    status: row.status,
    lastProcessedEventId: row.lastProcessedEventId,
    lastRebuildAt: row.lastRebuildAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

// List every registered projection with its current state (if any).
// The registry is the source-of-truth for which projections exist; the
// state table holds per-projection rebuild info and may be sparse.
//
// Implicit-Projections (auto-registered pro r.entity, eine pro entity)
// werden default ausgefiltert — sie sind als rebuild-Ziele weiter mit
// `<feature>:projection:<entity>-entity` adressierbar, aber in `kumiko
// project list` würden sie das Bild dominieren ohne Mehrwert. Mit
// `{ includeImplicit: true }` opt-in einschalten.
export async function listProjectionsWithState(
  db: DbConnection,
  registry: Registry,
  options: { readonly includeImplicit?: boolean } = {},
): Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly sources: readonly string[];
    readonly status: string;
    readonly lastProcessedEventId: bigint;
    readonly lastRebuildAt: Temporal.Instant | null;
    readonly lastError: string | null;
  }>
> {
  type StateRow = {
    name: string;
    status: string;
    lastProcessedEventId: bigint;
    lastRebuildAt: Temporal.Instant | null;
    lastError: string | null;
    updatedAt: Temporal.Instant;
  };
  const projections = registry.getAllProjections();
  const stateRows = await selectMany<StateRow>(db, projectionStateTable);
  const stateByName = new Map(stateRows.map((r) => [r.name, r]));

  return [...projections.values()]
    .filter((proj) => options.includeImplicit === true || !proj.isImplicit)
    .map((proj) => {
      const state = stateByName.get(proj.name);
      const sources = Array.isArray(proj.source) ? proj.source : [proj.source];
      return {
        name: proj.name,
        sources,
        status: state?.status ?? "never-rebuilt",
        lastProcessedEventId: state?.lastProcessedEventId ?? 0n,
        lastRebuildAt: state?.lastRebuildAt ?? null,
        lastError: state?.lastError ?? null,
      };
    });
}

export type ProjectionProgress = {
  readonly name: string;
  readonly sources: readonly string[];
  readonly status: string;
  readonly lastProcessedEventId: bigint;
  readonly lastRebuildAt: Temporal.Instant | null;
  readonly lastError: string | null;
  // Global MAX(events.id) at query time.
  readonly highWaterMark: bigint;
  // HWM - cursor. 0n when caught-up. Cannot be negative (that would mean
  // the projection is ahead of HWM = bug). Used by ops dashboards to
  // visualize projection lag.
  readonly lag: bigint;
};

// Extended variant of listProjectionsWithState that also returns HWM and lag
// per projection. One extra cheap MAX-aggregate query — no additional
// roundtrip per projection. Programmatic callers (e.g. a Prometheus gauge
// exporter) can map the result directly to a `kumiko_projection_lag{name}`
// gauge.
export async function getAllProjectionProgress(
  db: DbConnection,
  registry: Registry,
): Promise<readonly ProjectionProgress[]> {
  const [projections, highWaterMark] = await Promise.all([
    listProjectionsWithState(db, registry),
    getEventsHighWaterMark(db),
  ]);

  return projections.map((p) => ({
    ...p,
    highWaterMark,
    lag: highWaterMark - p.lastProcessedEventId,
  }));
}
