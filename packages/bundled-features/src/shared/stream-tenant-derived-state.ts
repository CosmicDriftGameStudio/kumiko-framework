// Derived state of a stream-tenant backfill: search docs in the buckets the streams
// left, projection rows and the index on SYSTEM_TENANT_ID. The stream move itself lives
// in stream-tenant-backfill.ts; this part is repeatable and safe to run without moves.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { type Registry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { reindexEntity, type SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import type { StreamBackfillCandidate, StreamBackfillFailure } from "./stream-tenant-backfill.ts";

export type StreamBackfillStepFailure = StreamBackfillFailure & { readonly step: string };

// "if-moved" skips rebuild and reindex when no stream moved; "always" repairs
// derived state after a run that moved streams and then crashed.
export type DerivedStateMode = "if-moved" | "always";

export function createSearchBucketCleanup(
  searchAdapter: SearchAdapter | undefined,
  entityType: string,
): {
  readonly beforeMove: (candidate: StreamBackfillCandidate) => Promise<void>;
  readonly cleanedAggregates: () => number;
} {
  let cleaned = 0;
  return {
    cleanedAggregates: () => cleaned,
    beforeMove: async (candidate) => {
      // skip: no adapter means no search docs to clean
      if (!searchAdapter) return;
      const oldBuckets = candidate.sourceTenantIds.filter((id) => id !== candidate.targetTenantId);
      for (const bucket of oldBuckets) {
        if (searchAdapter.removeBatch) {
          await searchAdapter.removeBatch(bucket, [
            { entityType, entityId: candidate.aggregateId },
          ]);
        } else {
          await searchAdapter.remove(bucket, entityType, candidate.aggregateId);
        }
      }
      if (oldBuckets.length > 0) cleaned++;
    },
  };
}

export type DerivedStateResult = {
  readonly projectionsRebuilt: readonly string[];
  readonly reindexedRows: number;
  readonly failures: readonly StreamBackfillStepFailure[];
};

export async function rebuildAndReindex(deps: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter?: SearchAdapter;
  readonly projections: readonly string[];
  readonly searchEntity: string;
}): Promise<DerivedStateResult> {
  const { db, registry, searchAdapter, projections, searchEntity } = deps;
  const failures: StreamBackfillStepFailure[] = [];
  const projectionsRebuilt: string[] = [];
  for (const projection of projections) {
    try {
      await rebuildProjection(projection, { db, registry });
      projectionsRebuilt.push(projection);
    } catch (e) {
      failures.push({ aggregateId: projection, step: "rebuild", error: messageOf(e) });
    }
  }

  let reindexedRows = 0;
  if (searchAdapter && isEntitySearchable(registry, searchEntity)) {
    try {
      const reindex = await reindexEntity(
        db,
        registry,
        searchAdapter,
        searchEntity,
        SYSTEM_TENANT_ID,
      );
      reindexedRows = reindex.indexedRows;
      for (const f of reindex.failures) {
        failures.push({ aggregateId: f.entityId, step: "reindex", error: f.reason });
      }
    } catch (e) {
      failures.push({ aggregateId: searchEntity, step: "reindex", error: messageOf(e) });
    }
  }
  return { projectionsRebuilt, reindexedRows, failures };
}

function isEntitySearchable(registry: Registry, entityName: string): boolean {
  return (
    registry.getSearchableFields(entityName).length > 0 ||
    registry.getSearchPayloadExtensions(entityName).length > 0
  );
}

export function stepFailures(
  step: string,
  failed: readonly StreamBackfillFailure[],
): StreamBackfillStepFailure[] {
  return failed.map((f) => ({ ...f, step }));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
