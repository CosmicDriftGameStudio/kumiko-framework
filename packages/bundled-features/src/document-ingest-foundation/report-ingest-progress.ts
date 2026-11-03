import { type DbConnection, transaction } from "@cosmicdrift/kumiko-framework/db";
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

// Parallel reports for one file race on the stream version; progress is idempotent and the newest
// report wins, so a lost race re-reads the version and appends again.
const MAX_VERSION_CONFLICT_ATTEMPTS = 3;

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
      if (!(e instanceof VersionConflictError) || attempt >= MAX_VERSION_CONFLICT_ATTEMPTS) throw e;
    }
  }
}
