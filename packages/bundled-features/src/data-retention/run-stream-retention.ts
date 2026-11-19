import { type DbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { deleteRowsWithoutReplayableStream } from "@cosmicdrift/kumiko-framework/event-store";
import { pruneEvents } from "@cosmicdrift/kumiko-framework/pipeline";
import { computeCutoff, type Instant } from "./keep-for.ts";

const STREAM_BATCH_SIZE = 500;
const ROW_DELETE_BATCH_SIZE = 1000;

export type RunStreamRetentionArgs = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly now: Instant;
};

export type RunStreamRetentionResult = {
  readonly deletedEvents: number;
  readonly deletedRows: number;
};

// pruneEvents deletes across all tenants and throws ConsumerLagError before deleting anything while
// a consumer lags; the caller retries on its next run. Streams go first, then the rows a rebuild
// would no longer recreate, so a crash in between leaves only rows the next run removes.
export async function runStreamRetention(
  args: RunStreamRetentionArgs,
): Promise<RunStreamRetentionResult> {
  let deletedEvents = 0;
  let deletedRows = 0;
  for (const projection of args.registry.getAllProjections().values()) {
    if (
      projection.isImplicit !== true ||
      typeof projection.source !== "string" ||
      !projection.table
    ) {
      continue;
    }
    const keepFor = args.registry.getEntity(projection.source)?.streamRetention?.keepFor;
    if (keepFor === undefined) continue;
    const cutoff = computeCutoff(keepFor, args.now);
    deletedEvents += await pruneStreams(args.db, args.registry, projection.source, cutoff);
    deletedRows += await deleteRowsWithoutStream(args.db, projection.table, cutoff);
  }
  return { deletedEvents, deletedRows };
}

async function pruneStreams(
  db: DbConnection,
  registry: Registry,
  aggregateType: string,
  cutoff: Instant,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const batch = await pruneEvents(db, {
      aggregateTypes: [aggregateType],
      olderThan: cutoff,
      batchSize: STREAM_BATCH_SIZE,
      registry,
    });
    deleted += batch.deletedCount;
    // deletedCount counts events, at least one per pruned stream, so a short batch means no backlog.
    if (batch.deletedCount < STREAM_BATCH_SIZE) return deleted;
  }
}

async function deleteRowsWithoutStream(
  db: DbConnection,
  table: Parameters<typeof selectMany>[1],
  cutoff: Instant,
): Promise<number> {
  let deletedRows = 0;
  let afterId: string | undefined;
  for (;;) {
    const page = await selectMany<{ id: string }>(
      db,
      table,
      {
        insertedAt: { lt: cutoff },
        ...(afterId === undefined ? {} : { id: { gt: afterId } }),
      },
      { fields: ["id"], orderBy: { col: "id", direction: "asc" }, limit: ROW_DELETE_BATCH_SIZE },
    );
    if (page.length === 0) break;
    const deleted = await deleteRowsWithoutReplayableStream(db, {
      table,
      ids: page.map((row) => row.id),
    });
    deletedRows += deleted.length;
    if (page.length < ROW_DELETE_BATCH_SIZE) break;
    afterId = page[page.length - 1]?.id;
  }
  return deletedRows;
}
