// One-time migration for tenant and tenant-membership streams written before
// `tenant` became a systemStream/global entity. Those streams, read rows and
// search docs sit on whichever tenant the acting admin's session carried.
//
// Runs at boot (server-runtime) and can be called by hand. Idempotent: a second
// run finds nothing left to move.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import {
  backfillAggregateStreamTenants,
  createSearchBucketCleanup,
  type DerivedStateMode,
  rebuildAndReindex,
  type StreamBackfillResult,
  type StreamBackfillStepFailure,
  stepFailures,
} from "../shared/index.ts";
import {
  type ArchivedMembershipStream,
  archiveUnreplayableMembershipStreams,
} from "./membership-stream-history.ts";
import { MEMBERSHIP_UNIQUE_INDEX_NAME } from "./membership-table.ts";

const TENANT_AGGREGATE = "tenant";
const MEMBERSHIP_AGGREGATE = "tenant-membership";
const TENANT_PROJECTION = "tenant:projection:tenant-entity";
const MEMBERSHIP_PROJECTION = "tenant:projection:tenant-membership-entity";

export type TenantStreamBackfillResult = {
  readonly tenants: StreamBackfillResult;
  readonly memberships: StreamBackfillResult;
  // Tenants for which at least one stale search doc bucket was cleaned.
  readonly searchDocsRemoved: number;
  readonly projectionsRebuilt: readonly string[];
  readonly reindexedTenants: number;
  readonly membershipStreamsArchived: readonly ArchivedMembershipStream[];
  // Per-step failures across the whole run; step names the failing stage.
  readonly failures: readonly StreamBackfillStepFailure[];
};

export type TenantStreamBackfillDeps = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter?: SearchAdapter;
  readonly derived?: DerivedStateMode;
  readonly scanTenantIds?: readonly string[];
  readonly onFirstCandidate?: () => Promise<"proceed" | "skip">;
};

export async function backfillTenantStreamTenants(
  deps: TenantStreamBackfillDeps,
): Promise<TenantStreamBackfillResult> {
  const {
    db,
    registry,
    searchAdapter,
    derived = "if-moved",
    scanTenantIds,
    onFirstCandidate,
  } = deps;
  const scan = {
    ...(scanTenantIds && { scanTenantIds }),
    ...(onFirstCandidate && { onFirstCandidate }),
  };
  const searchCleanup = createSearchBucketCleanup(searchAdapter, TENANT_AGGREGATE);

  const tenants = await backfillAggregateStreamTenants(db, {
    aggregateType: TENANT_AGGREGATE,
    target: { kind: "system" },
    beforeMove: searchCleanup.beforeMove,
    ...scan,
  });
  const memberships = await backfillAggregateStreamTenants(db, {
    aggregateType: MEMBERSHIP_AGGREGATE,
    target: { kind: "payload-tenant" },
    ...scan,
  });
  const failures: StreamBackfillStepFailure[] = [
    ...stepFailures("tenant-streams", tenants.failed),
    ...stepFailures("membership-streams", memberships.failed),
  ];

  const moved = tenants.aggregatesMigrated + memberships.aggregatesMigrated > 0;
  if (!moved && derived === "if-moved") {
    return emptyDerived({ tenants, memberships, searchCleanup, failures });
  }

  const archive = await archiveMembershipStreamsBeforeRebuild(db);
  const rebuilt = await rebuildAndReindex({
    db,
    registry,
    ...(searchAdapter && { searchAdapter }),
    projections: [TENANT_PROJECTION, MEMBERSHIP_PROJECTION],
    searchEntity: TENANT_AGGREGATE,
  });
  return {
    tenants,
    memberships,
    searchDocsRemoved: searchCleanup.cleanedAggregates(),
    projectionsRebuilt: rebuilt.projectionsRebuilt,
    reindexedTenants: rebuilt.reindexedRows,
    membershipStreamsArchived: archive.archived,
    failures: [
      ...failures,
      ...archive.failures,
      ...rebuilt.failures.map(explainMembershipCollision),
    ],
  };
}

async function archiveMembershipStreamsBeforeRebuild(db: DbConnection): Promise<{
  readonly archived: readonly ArchivedMembershipStream[];
  readonly failures: readonly StreamBackfillStepFailure[];
}> {
  try {
    return { archived: await archiveUnreplayableMembershipStreams(db), failures: [] };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      archived: [],
      failures: [{ aggregateId: MEMBERSHIP_PROJECTION, step: "rebuild", error }],
    };
  }
}

function explainMembershipCollision(failure: StreamBackfillStepFailure): StreamBackfillStepFailure {
  if (
    failure.aggregateId !== MEMBERSHIP_PROJECTION ||
    !failure.error.includes(MEMBERSHIP_UNIQUE_INDEX_NAME)
  ) {
    return failure;
  }
  return {
    ...failure,
    error:
      `two membership streams of one (userId, tenantId) pair still replay alive after the boot ` +
      `archived the colliding streams it found in the event log. The live table is untouched and ` +
      `the step runs again on the next boot. Cause: ${failure.error}`,
  };
}

function emptyDerived(args: {
  readonly tenants: StreamBackfillResult;
  readonly memberships: StreamBackfillResult;
  readonly searchCleanup: { readonly cleanedAggregates: () => number };
  readonly failures: readonly StreamBackfillStepFailure[];
}): TenantStreamBackfillResult {
  return {
    tenants: args.tenants,
    memberships: args.memberships,
    searchDocsRemoved: args.searchCleanup.cleanedAggregates(),
    projectionsRebuilt: [],
    reindexedTenants: 0,
    membershipStreamsArchived: [],
    failures: args.failures,
  };
}
