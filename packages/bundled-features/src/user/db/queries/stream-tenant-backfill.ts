// Moves legacy user streams onto SYSTEM_TENANT_ID (user is a systemStream
// entity). After a run, rebuild the user projection so read_users.tenant_id
// reflects the move: rebuildProjection("user:projection:user-entity", ...) or
// the jobs:job:projection-rebuild job.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { backfillAggregateStreamTenants } from "../../../shared/stream-tenant-backfill.ts";

export type UserStreamBackfillResult = {
  readonly aggregatesMigrated: number;
  readonly eventsMigrated: number;
  readonly failed: ReadonlyArray<{ readonly aggregateId: string; readonly error: string }>;
};

export function backfillUserStreamTenants(db: DbConnection): Promise<UserStreamBackfillResult> {
  return backfillAggregateStreamTenants(db, { aggregateType: "user", target: { kind: "system" } });
}
