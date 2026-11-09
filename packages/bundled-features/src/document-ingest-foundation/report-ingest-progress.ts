import { type DbConnection, selectMany, transaction } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import {
  append,
  getStreamVersion,
  VersionConflictError,
} from "@cosmicdrift/kumiko-framework/event-store";
import { runProjectionsForEvent } from "@cosmicdrift/kumiko-framework/pipeline";
import { documentIngestAggregateId } from "./aggregate-id.ts";
import {
  DOCUMENT_INGEST_AGGREGATE_TYPE,
  DOCUMENT_INGEST_PROGRESS_EVENT_QN,
  documentIngestProgressPayloadSchema,
} from "./events.ts";
import { documentIngestProgressTable } from "./tables.ts";

export type ReportIngestProgressDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly tenantId: string;
  readonly actorId: string;
};

export type ReportIngestProgressInput = {
  readonly fileRefId: string;
  readonly pagesDone: number;
  readonly pagesTotal: number;
};

// Parallel reports for one file race on the stream version, so a lost race re-reads the version and
// appends again. The projection keeps the highest pagesDone, so landing order does not matter. A
// conflict means another report committed, so N parallel reports need at most N-1 retries; 10
// covers the parallelism one file sees. A report whose progress is already stored stops early.
const MAX_VERSION_CONFLICT_ATTEMPTS = 10;

// Low-level append() does not fire projections, so they run explicitly, in the same transaction as the append.
export async function reportIngestProgress(
  deps: ReportIngestProgressDeps,
  input: ReportIngestProgressInput,
): Promise<void> {
  const payload = documentIngestProgressPayloadSchema.parse(input);
  const aggregateId = documentIngestAggregateId(deps.tenantId, payload.fileRefId);
  for (let attempt = 1; ; attempt++) {
    try {
      await transaction(deps.db, async (tx) => {
        const expectedVersion = await getStreamVersion(tx, aggregateId, deps.tenantId);
        const stored = await append(tx, {
          aggregateId,
          aggregateType: DOCUMENT_INGEST_AGGREGATE_TYPE,
          tenantId: deps.tenantId,
          expectedVersion,
          type: DOCUMENT_INGEST_PROGRESS_EVENT_QN,
          payload,
          metadata: { userId: deps.actorId },
        });
        await runProjectionsForEvent(stored, deps.registry, tx);
      });
      // skip: event appended, nothing left to retry
      return;
    } catch (e) {
      if (!(e instanceof VersionConflictError)) throw e;
      if (await storedProgressCovers(deps, aggregateId, payload.pagesDone)) return;
      if (attempt >= MAX_VERSION_CONFLICT_ATTEMPTS) throw e;
    }
  }
}

async function storedProgressCovers(
  deps: ReportIngestProgressDeps,
  aggregateId: string,
  pagesDone: number,
): Promise<boolean> {
  const rows = await selectMany<{ pagesDone: number }>(deps.db, documentIngestProgressTable, {
    id: aggregateId,
    tenantId: deps.tenantId,
  });
  return (rows[0]?.pagesDone ?? 0) >= pagesDone;
}
