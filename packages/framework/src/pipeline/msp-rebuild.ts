import { asc, eq, getTableName, inArray, sql } from "drizzle-orm";
import type { DbConnection, DbRunner } from "../db/connection";
import type { Registry, TenantId } from "../engine/types";
import { InternalError } from "../errors";
import { eventsTable, type StoredEvent, upcastStoredEvent } from "../event-store";
import { loadAggregate, loadAggregateAsOf } from "../event-store/event-store";
import { upcastStoredEvents } from "../event-store/upcaster";
import { emitProjectionRebuild } from "../observability/standard-metrics";
import type { Meter } from "../observability/types/metric";
import { eventConsumerStateTable } from "./event-consumer-state";
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
  return {
    appendEvent: async (args) => {
      throw new InternalError({
        message: `rebuildMultiStreamProjection: ctx.appendEvent("${args.type}") is not supported during rebuild. The events your saga would emit already live in the event log — rebuild only derives read-model state. If you need to retroactively emit events, do so via a dedicated write-handler, not via the apply path.`,
      });
    },
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
      `MultiStreamProjection "${mspName}" has no backing table — it is a pure side-effect consumer (webhooks, notifications, external sync). Rebuild would re-invoke those side-effects by replaying the log. For poison events use yarn kumiko consumer skip / restart; there is no analogous "rebuild" concept for side-effect sinks.`,
    );
  }

  const startedAt = Date.now();
  let eventsProcessed = 0;
  let lastProcessedEventId = 0n;

  try {
    await db.transaction(async (tx) => {
      // Upsert + lock the consumer row. Mirrors rebuildProjection's
      // upsert-first pattern so a never-started MSP also gets a row.
      // The FOR UPDATE on the next SELECT is what blocks concurrent
      // rebuilds of the same MSP; live dispatcher passes use SKIP LOCKED
      // on this row and will bail silently while we hold it.
      await tx
        .insert(eventConsumerStateTable)
        .values({ name: mspName, lastProcessedEventId: 0n, status: "idle" })
        .onConflictDoUpdate({
          target: eventConsumerStateTable.name,
          set: {
            lastProcessedEventId: 0n,
            status: "idle",
            attempts: 0,
            lastError: null,
            updatedAt: sql`now()`,
          },
        });
      await tx
        .select()
        .from(eventConsumerStateTable)
        .where(eq(eventConsumerStateTable.name, mspName))
        .for("update");

      // msp.table is narrowed by the upfront guard; the assertion here is
      // for TS inside the async closure (narrowing doesn't cross the
      // transaction boundary).
      const tableName = getTableName(msp.table as NonNullable<typeof msp.table>);
      await tx.execute(sql.raw(`TRUNCATE TABLE ${quoteIdent(tableName)}`));

      const subscribedTypes = Object.keys(msp.apply);
      if (subscribedTypes.length > 0) {
        const events = (await tx
          .select()
          .from(eventsTable)
          .where(inArray(eventsTable.type, subscribedTypes))
          .orderBy(asc(eventsTable.id))) as ReadonlyArray<typeof eventsTable.$inferSelect>;

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
            tenantId: row.tenantId as TenantId,
          });
          const applyFn = msp.apply[row.type];
          if (!applyFn) continue;
          const rebuildCtx = createRebuildCtx(registry, tx, row.tenantId as TenantId);
          await applyFn(storedEvent, tx, rebuildCtx);
          eventsProcessed++;
          lastProcessedEventId = row.id;
        }
      }

      await tx
        .update(eventConsumerStateTable)
        .set({
          lastProcessedEventId,
          status: "idle",
          attempts: 0,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(eventConsumerStateTable.name, mspName));
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(eventConsumerStateTable)
      .set({ status: "dead", lastError: message, updatedAt: sql`now()` })
      .where(eq(eventConsumerStateTable.name, mspName));
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

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
