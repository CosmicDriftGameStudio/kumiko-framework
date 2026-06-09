import { extractTableName } from "../db";
import type { DbConnection, DbRunner, DbTx } from "../db/connection";
import {
  markConsumerRebuildFailed,
  resetConsumerForMspRebuild,
  selectConsumerForUpdate,
  updateConsumerRebuildCursor,
} from "../db/queries/event-consumer";
import { truncateTable } from "../db/queries/table-ops";
import { selectMany } from "../db/query";
import type { Registry, TenantId } from "../engine/types";
import { InternalError } from "../errors";
import { eventsTable, type StoredEvent, upcastStoredEvent } from "../event-store";
import { loadAggregate, loadAggregateAsOf } from "../event-store/event-store";
import { upcastStoredEvents } from "../event-store/upcaster";
import { emitProjectionRebuild } from "../observability/standard-metrics";
import type { Meter } from "../observability/types/metric";
import { SHARED_INSTANCE_SENTINEL } from "./event-consumer-state";
import type { MultiStreamApplyContext } from "./multi-stream-apply-context";
import type { RebuildResult } from "./projection-rebuild";

// Rebuild a multi-stream projection (MSP) from the event log. Symmetric to
// `rebuildProjection` for single-stream projections — same single-TX
// TRUNCATE+replay semantics — but wired against the dispatcher's consumer
// state row (cursor, not projection-state). MSPs are async-live and
// cursor-driven; rebuild resets the cursor to 0 and rematerializes the
// projection table in chronological event order.
//
// Why separate from rebuildProjection:
//   - MSP apply signature includes a 3rd ctx arg (MultiStreamApplyContext
//     for saga follow-ups). Rebuild passes a RESTRICTED ctx that allows
//     loadAggregate but rejects appendEvent — the events a saga would emit
//     already live in the log, replaying them would be a double-write.
//   - Event selection is type-only (no aggregateType filter). MSPs subscribe
//     by event-type; source aggregate is irrelevant.
//   - State lives in kumiko_event_consumers (cursor row for the dispatcher),
//     not in kumiko_projections.
//
// Side-effect-only MSPs (no `table`) cannot be rebuilt. Replaying would
// re-invoke the side-effect (webhook, notification, external sync) and
// produce duplicates by design. The function rejects up-front with a
// pointer at the consumer skip/restart ops surface.
//
// During the rebuild TX:
//   - FOR UPDATE lock on the consumer row blocks concurrent live passes
//     (SKIP LOCKED from the dispatcher backs off silently).
//   - TRUNCATE the projection table.
//   - Stream events matching apply-keys, invoke apply(event, tx, ctx).
//   - Advance cursor to last processed event id, status=idle.
//
// Failure: outer catch writes status="dead" + lastError so ops sees the
// failure after the TX rolled back. Use restartConsumer to clear dead.

export type MspRebuildDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  // Optional framework meter; emits kumiko_projection_rebuild_* with a
  // projection=<mspName> label (same metric namespace as single-stream —
  // one rebuild series per projection, regardless of flavor).
  readonly meter?: Meter;
  // Test-hook — independent of `meter`, fires on success only.
  readonly onMetrics?: (result: RebuildResult) => void;
};

function createRebuildCtx(
  registry: Registry,
  db: DbRunner,
  tenantId: TenantId,
): MultiStreamApplyContext {
  // Both surfaces throw — rebuild MUST NOT emit. We share one impl.
  const refuseAppend = async (args: { readonly type: string }) => {
    throw new InternalError({
      message: `rebuildMultiStreamProjection: ctx.appendEvent("${args.type}") is not supported during rebuild. The events your saga would emit already live in the event log — rebuild only derives read-model state. If you need to retroactively emit events, do so via a dedicated write-handler, not via the apply path.`,
    });
  };
  return {
    appendEvent: refuseAppend as MultiStreamApplyContext["appendEvent"], // @cast-boundary engine-bridge
    unsafeAppendEvent: refuseAppend,
    loadAggregate: async (aggregateId, options) => {
      const events = options?.asOf
        ? await loadAggregateAsOf(db, aggregateId, tenantId, options.asOf)
        : await loadAggregate(db, aggregateId, tenantId);
      return upcastStoredEvents(events, registry.getEventUpcasters(), { db, tenantId });
    },
  };
}

export async function rebuildMultiStreamProjection(
  mspName: string,
  deps: MspRebuildDeps,
): Promise<RebuildResult> {
  const { db, registry } = deps;
  const msp = registry.getAllMultiStreamProjections().get(mspName);
  if (!msp) {
    throw new Error(
      `MultiStreamProjection "${mspName}" is not registered. Known: ${
        [...registry.getAllMultiStreamProjections().keys()].join(", ") || "(none)"
      }`,
    );
  }
  if (!msp.table) {
    throw new Error(
      `MultiStreamProjection "${mspName}" has no backing table — it is a pure side-effect consumer (webhooks, notifications, external sync). Rebuild would re-invoke those side-effects by replaying the log. For poison events use bun kumiko consumer skip / restart; there is no analogous "rebuild" concept for side-effect sinks.`,
    );
  }

  const startedAt = Date.now();
  let eventsProcessed = 0;
  let lastProcessedEventId = 0n;

  try {
    await db.begin(async (tx: DbTx) => {
      await resetConsumerForMspRebuild(tx, mspName, SHARED_INSTANCE_SENTINEL);
      await selectConsumerForUpdate(tx, mspName, SHARED_INSTANCE_SENTINEL);

      const mspTable = msp.table as NonNullable<typeof msp.table>;
      const tableName = extractTableName(mspTable, "msp-rebuild");
      await truncateTable(tx, tableName);

      const subscribedTypes = Object.keys(msp.apply);
      if (subscribedTypes.length > 0) {
        type EventRow = {
          id: bigint;
          aggregateId: string;
          aggregateType: string;
          tenantId: TenantId;
          version: number;
          type: string;
          eventVersion: number;
          payload: Record<string, unknown>;
          metadata: import("../event-store/event-store").EventMetadata;
          createdAt: Temporal.Instant;
          createdBy: string;
        };
        const events = await selectMany<EventRow>(
          tx,
          eventsTable,
          { type: [...subscribedTypes] },
          { orderBy: { col: "id", direction: "asc" } },
        );

        const upcasters = registry.getEventUpcasters();
        for (const row of events) {
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
            tenantId: row.tenantId,
          });
          const applyFn = msp.apply[row.type];
          if (!applyFn) continue;
          const rebuildCtx = createRebuildCtx(registry, tx, row.tenantId);
          await applyFn(storedEvent, tx, rebuildCtx);
          eventsProcessed++;
          lastProcessedEventId = row.id;
        }
      }

      await updateConsumerRebuildCursor(
        tx,
        mspName,
        SHARED_INSTANCE_SENTINEL,
        lastProcessedEventId,
      );
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markConsumerRebuildFailed(db, mspName, SHARED_INSTANCE_SENTINEL, message);
    if (deps.meter) {
      emitProjectionRebuild(
        deps.meter,
        { projection: mspName, success: false },
        (Date.now() - startedAt) / 1000,
        0,
      );
    }
    throw e;
  }

  const result: RebuildResult = {
    projection: mspName,
    eventsProcessed,
    lastProcessedEventId,
    durationMs: Date.now() - startedAt,
  };
  if (deps.meter) {
    emitProjectionRebuild(
      deps.meter,
      { projection: mspName, success: true },
      result.durationMs / 1000,
      eventsProcessed,
    );
  }
  deps.onMetrics?.(result);
  return result;
}
