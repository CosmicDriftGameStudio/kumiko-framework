// One-time migration for tenant and tenant-membership streams written before
// `tenant` became a systemStream/global entity. Those streams, read rows and
// search docs sit on whichever tenant the acting admin's session carried.
//
// Run once right after deploying the fixed framework. Idempotent: a second run
// finds nothing left to move.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { reindexEntity, type SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import {
  backfillAggregateStreamTenants,
  type StreamBackfillFailure,
  type StreamBackfillResult,
} from "../shared/stream-tenant-backfill.ts";

const TENANT_AGGREGATE = "tenant";
const MEMBERSHIP_AGGREGATE = "tenant-membership";
const TENANT_PROJECTION = "tenant:projection:tenant-entity";
const MEMBERSHIP_PROJECTION = "tenant:projection:tenant-membership-entity";

export type TenantStreamBackfillResult = {
  readonly tenants: StreamBackfillResult;
  readonly memberships: StreamBackfillResult;
  readonly searchDocsRemoved: number;
  readonly projectionsRebuilt: readonly string[];
  readonly reindexedTenants: number;
  // Per-step failures across the whole run; step names the failing stage.
  readonly failures: ReadonlyArray<StreamBackfillFailure & { readonly step: string }>;
};

export type TenantStreamBackfillDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter?: SearchAdapter;
};

export async function backfillTenantStreamTenants(
  deps: TenantStreamBackfillDeps,
): Promise<TenantStreamBackfillResult> {
  const { db, registry, searchAdapter } = deps;
  const failures: Array<StreamBackfillFailure & { step: string }> = [];
  let searchDocsRemoved = 0;

  const tenants = await backfillAggregateStreamTenants(db, {
    aggregateType: TENANT_AGGREGATE,
    target: { kind: "system" },
    beforeMove: async (candidate) => {
      if (!searchAdapter) return;
      for (const oldTenantId of candidate.sourceTenantIds) {
        if (oldTenantId === candidate.targetTenantId) continue;
        const items = [{ entityType: TENANT_AGGREGATE, entityId: candidate.aggregateId }];
        if (searchAdapter.removeBatch) {
          await searchAdapter.removeBatch(oldTenantId, items);
        } else {
          await searchAdapter.remove(oldTenantId, TENANT_AGGREGATE, candidate.aggregateId);
        }
        searchDocsRemoved++;
      }
    },
  });
  for (const f of tenants.failed) failures.push({ ...f, step: "tenant-streams" });

  const memberships = await backfillAggregateStreamTenants(db, {
    aggregateType: MEMBERSHIP_AGGREGATE,
    target: { kind: "payload-tenant" },
  });
  for (const f of memberships.failed) failures.push({ ...f, step: "membership-streams" });

  const projectionsRebuilt: string[] = [];
  for (const projection of [TENANT_PROJECTION, MEMBERSHIP_PROJECTION]) {
    try {
      await rebuildProjection(projection, { db, registry });
      projectionsRebuilt.push(projection);
    } catch (e) {
      failures.push({ aggregateId: projection, step: "rebuild", error: messageOf(e) });
    }
  }

  let reindexedTenants = 0;
  if (searchAdapter) {
    try {
      const reindex = await reindexEntity(
        db,
        registry,
        searchAdapter,
        TENANT_AGGREGATE,
        SYSTEM_TENANT_ID,
      );
      reindexedTenants = reindex.indexedRows;
      for (const f of reindex.failures) {
        failures.push({ aggregateId: f.entityId, step: "reindex", error: f.reason });
      }
    } catch (e) {
      failures.push({ aggregateId: TENANT_AGGREGATE, step: "reindex", error: messageOf(e) });
    }
  }

  return {
    tenants,
    memberships,
    searchDocsRemoved,
    projectionsRebuilt,
    reindexedTenants,
    failures,
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
