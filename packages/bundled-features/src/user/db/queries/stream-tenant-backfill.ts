// Moves legacy user streams onto SYSTEM_TENANT_ID (user is a systemStream
// entity). After a run, rebuild the user projection so read_users.tenant_id
// reflects the move: rebuildProjection("user:projection:user-entity", ...) or
// the jobs:job:projection-rebuild job. `backfillUserStreamTenantsWithDerivedState`
// does the move, the old-bucket search cleanup, the rebuild and the reindex in one call.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import {
  backfillAggregateStreamTenants,
  createSearchBucketCleanup,
  type DerivedStateMode,
  rebuildAndReindex,
  type StreamBackfillStepFailure,
  stepFailures,
} from "../../../shared/index.ts";

export type UserStreamBackfillResult = {
  readonly aggregatesMigrated: number;
  readonly eventsMigrated: number;
  readonly failed: ReadonlyArray<{ readonly aggregateId: string; readonly error: string }>;
};

const USER_AGGREGATE = "user";
const USER_PROJECTION = "user:projection:user-entity";

export function backfillUserStreamTenants(
  db: DbConnection,
  options: { readonly scanTenantIds?: readonly string[] } = {},
): Promise<UserStreamBackfillResult> {
  return backfillAggregateStreamTenants(db, {
    aggregateType: USER_AGGREGATE,
    target: { kind: "system" },
    ...options,
  });
}

export type UserStreamBackfillWithDerivedStateResult = {
  readonly streams: UserStreamBackfillResult;
  readonly projectionsRebuilt: readonly string[];
  readonly reindexedUsers: number;
  readonly failures: readonly StreamBackfillStepFailure[];
};

export async function backfillUserStreamTenantsWithDerivedState(deps: {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter?: SearchAdapter;
  readonly derived?: DerivedStateMode;
  readonly scanTenantIds?: readonly string[];
}): Promise<UserStreamBackfillWithDerivedStateResult> {
  const { db, registry, searchAdapter, derived = "if-moved", scanTenantIds } = deps;
  const searchCleanup = createSearchBucketCleanup(searchAdapter, USER_AGGREGATE);
  const streams = await backfillAggregateStreamTenants(db, {
    aggregateType: USER_AGGREGATE,
    target: { kind: "system" },
    beforeMove: searchCleanup.beforeMove,
    ...(scanTenantIds && { scanTenantIds }),
  });
  const failures = stepFailures("user-streams", streams.failed);
  if (streams.aggregatesMigrated === 0 && derived === "if-moved") {
    return { streams, projectionsRebuilt: [], reindexedUsers: 0, failures };
  }
  const rebuilt = await rebuildAndReindex({
    db,
    registry,
    ...(searchAdapter && { searchAdapter }),
    projections: [USER_PROJECTION],
    searchEntity: USER_AGGREGATE,
  });
  return {
    streams,
    projectionsRebuilt: rebuilt.projectionsRebuilt,
    reindexedUsers: rebuilt.reindexedRows,
    failures: [...failures, ...rebuilt.failures],
  };
}
