import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { append, getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
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

// Low-level append() does not fire projections, so they run explicitly in the same call.
export async function reportIngestProgress(
  deps: ReportIngestProgressDeps,
  input: ReportIngestProgressInput,
): Promise<void> {
  const payload = documentIngestProgressPayloadSchema.parse(input);
  const aggregateId = documentIngestAggregateId(deps.tenantId, payload.fileRefId);
  const expectedVersion = await getStreamVersion(deps.db, aggregateId, deps.tenantId);
  const stored = await append(deps.db, {
    aggregateId,
    aggregateType: DOCUMENT_INGEST_AGGREGATE_TYPE,
    tenantId: deps.tenantId,
    expectedVersion,
    type: DOCUMENT_INGEST_PROGRESS_EVENT_QN,
    payload,
    metadata: { userId: deps.actorId },
  });
  await runProjectionsForEvent(stored, deps.registry, deps.db);
}
