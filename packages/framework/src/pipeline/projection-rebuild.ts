import type { DbConnection, DbTx } from "../db/connection";
import {
  finalizeProjectionRebuild,
  markProjectionRebuildFailed,
  markProjectionRebuilding,
  selectEventsForProjectionRebuild,
} from "../db/queries/projection-rebuild";
import { truncateTable } from "../db/queries/table-ops";
import { coerceRow, extractTableInfo, selectMany } from "../db/query";
import type { Registry, TenantId } from "../engine/types";
import {
  eventsTable,
  getEventsHighWaterMark,
  type StoredEvent,
  upcastStoredEvent,
} from "../event-store";
import { emitProjectionRebuild } from "../observability/standard-metrics";
import type { Meter } from "../observability/types/metric";
import { projectionStateTable } from "./projection-state";

// Rebuild a projection from the event log.
//
// Mechanics:
//   1. Lock the projection's state row FOR UPDATE. Concurrent rebuild
//      attempts of the same projection block here instead of racing.
//   2. Mark status = "rebuilding".
//   3. TRUNCATE the projection's backing table.
//   4. Stream events in chronological order, for every apply-key match
//      invoke apply(event, tx). Event-by-event, so two projections of the
//      same source stay semantically identical to the live pipeline.
//   5. Store the last processed event-id + mark status = "idle".
//
// All of that runs in ONE transaction. If apply throws partway through,
// Postgres rolls back everything — the old projection is still there,
// status goes back to "idle" via the outer catch, and lastError records
// what went wrong. A partial/empty projection is never observable.
//
// This is an ops-time operation. While a rebuild is in progress, live
// writes that touch the same projection will also try to insert into the
// TRUNCATE'd table, triggering either a serialization conflict or (for a
// new row after TRUNCATE) a noisy conflict. Intended behaviour: rebuild
// on a quiet entity, or during a deliberate write-pause.
//
// Scale limit: single-TX TRUNCATE + replay works as long as your
// maintenance window absorbs the replay. Effective ceiling depends on
// payload size, apply() cost, and DB load — measure before trusting it.
// Beyond that window, plan for a shadow-swap variant. For v1 that's
// documented as a known boundary in docs/projections.md.

export type RebuildResult = {
  readonly projection: string;
  readonly eventsProcessed: number;
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

  const sources = Array.isArray(projection.source) ? projection.source : [projection.source];
  const startedAt = Date.now();
  let eventsProcessed = 0;
  let lastProcessedEventId = 0n;

  try {
    await db.begin(async (tx: DbTx) => {
      await markProjectionRebuilding(tx, projectionName);

      const tableName = getTableName(projection.table);
      await truncateTable(tx, tableName);

      // Stream events in chronological order for every source. The event
      // type filter prunes events the projection doesn't care about early.
      const subscribed = Object.keys(projection.apply);
      if (subscribed.length === 0) {
        // nothing to replay, just mark idle — projection exists but doesn't
        // subscribe to any event types on its sources yet.
      } else {
        type EventRow = {
          id: bigint;
          aggregateId: string;
          aggregateType: string;
          tenantId: string;
          version: number;
          type: string;
          eventVersion: number;
          payload: Record<string, unknown>;
          metadata: import("../event-store/event-store").EventMetadata;
          createdAt: Temporal.Instant;
          createdBy: string;
        };
        const sourcesList = [...sources];
        const subscribedList = [...subscribed];
        const rawEvents = await selectEventsForProjectionRebuild(
          tx,
          sourcesList,
          subscribedList,
        );
        const events = rawEvents.map((r) => {
          const info = extractTableInfo(eventsTable);
          return coerceRow(r, info) as EventRow;
        });

        // Upcasters run at read time: older stored payloads get walked
        // through the registered r.eventMigration chain until their shape
        // matches the current event version.
        const upcasters = registry.getEventUpcasters();
        for (const row of events) {
          deps.signal?.throwIfAborted();
          const raw: StoredEvent = {
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
          const storedEvent = await upcastStoredEvent(raw, upcasters, {
            db: tx,
            tenantId: row.tenantId as TenantId, // @cast-boundary db-row
          });
          const applyFn = projection.apply[row.type];
          // skip: apply-key validation ensures every subscribed type has a
          //       handler; defensive check against runtime-mutated registry
          if (!applyFn) continue;
          await applyFn(storedEvent, tx);
          eventsProcessed++;
          lastProcessedEventId = row.id;
        }
      }

      await finalizeProjectionRebuild(tx, projectionName, lastProcessedEventId);
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

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
function getTableName(table: unknown): string {
  if (typeof table !== "object" || table === null) {
    throw new Error("projection-rebuild: projection.table is not a pgTable object");
  }
  const name = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
  if (typeof name !== "string") {
    throw new Error("projection-rebuild: projection.table missing drizzle name symbol");
  }
  return name;
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
