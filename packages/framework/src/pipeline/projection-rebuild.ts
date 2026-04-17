import { asc, eq, getTableName, inArray, sql } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import type { Registry } from "../engine/types";
import { eventsTable, type StoredEvent } from "../event-store";
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
    await db.transaction(async (tx) => {
      // Lock the state row. Use upsert so a never-rebuilt projection also
      // gets a row. FOR UPDATE would need the row to exist — upsert-first
      // keeps it idempotent.
      await tx
        .insert(projectionStateTable)
        .values({ name: projectionName, status: "rebuilding" })
        .onConflictDoUpdate({
          target: projectionStateTable.name,
          set: {
            status: "rebuilding",
            lastError: null,
            updatedAt: sql`now()`,
          },
        });

      // Wipe the projection table. drizzle-orm's public API doesn't expose
      // TRUNCATE, so we issue raw SQL — but `getTableName()` is the public
      // accessor for the table's registered name, avoiding Symbol.for()
      // internal lookups. The identifier is still quoted defensively.
      const tableName = getTableName(projection.table);
      await tx.execute(sql.raw(`TRUNCATE TABLE ${quoteIdent(tableName)}`));

      // Stream events in chronological order for every source. The event
      // type filter (inArray(type, validTypes)) prunes events the projection
      // doesn't care about early — important when a single source has more
      // event types than the projection subscribes to.
      const subscribed = Object.keys(projection.apply);
      if (subscribed.length === 0) {
        // nothing to replay, just mark idle — projection exists but doesn't
        // subscribe to any event types on its sources yet.
      } else {
        const events = (await tx
          .select()
          .from(eventsTable)
          .where(
            sql`${inArray(eventsTable.aggregateType, sources)} AND ${inArray(
              eventsTable.type,
              subscribed,
            )}`,
          )
          .orderBy(asc(eventsTable.id))) as ReadonlyArray<typeof eventsTable.$inferSelect>;

        for (const row of events) {
          const storedEvent: StoredEvent = {
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
          const applyFn = projection.apply[row.type];
          // skip: apply-key validation ensures every subscribed type has a
          //       handler; defensive check against runtime-mutated registry
          if (!applyFn) continue;
          await applyFn(storedEvent, tx);
          eventsProcessed++;
          lastProcessedEventId = row.id;
        }
      }

      // Finalize state row.
      await tx
        .update(projectionStateTable)
        .set({
          lastProcessedEventId,
          status: "idle",
          lastRebuildAt: sql`now()`,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(projectionStateTable.name, projectionName));
    });
  } catch (e) {
    // Outer catch: TX has been rolled back by Postgres already. Record the
    // failure in a SEPARATE write so ops can see what happened — the
    // rolled-back status change is gone, so we write failed+error now.
    const message = e instanceof Error ? e.message : String(e);
    await db
      .insert(projectionStateTable)
      .values({ name: projectionName, status: "failed", lastError: message })
      .onConflictDoUpdate({
        target: projectionStateTable.name,
        set: { status: "failed", lastError: message, updatedAt: sql`now()` },
      });
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

// Identifier quoting for raw TRUNCATE. Drizzle doesn't expose a safe helper
// for table-name interpolation in raw SQL; double-quote + escape double-quote
// matches Postgres identifier rules.
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
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
  readonly lastRebuildAt: Date | null;
  readonly lastError: string | null;
  readonly updatedAt: Date;
} | null> {
  const [row] = await db
    .select()
    .from(projectionStateTable)
    .where(eq(projectionStateTable.name, projectionName));
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
export async function listProjectionsWithState(
  db: DbConnection,
  registry: Registry,
): Promise<
  ReadonlyArray<{
    readonly name: string;
    readonly sources: readonly string[];
    readonly status: string;
    readonly lastProcessedEventId: bigint;
    readonly lastRebuildAt: Date | null;
    readonly lastError: string | null;
  }>
> {
  const projections = registry.getAllProjections();
  const stateRows = await db.select().from(projectionStateTable);
  const stateByName = new Map(stateRows.map((r) => [r.name, r]));

  return [...projections.values()].map((proj) => {
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
