// The event store's own tenant-transfer primitive: the ONE place allowed to
// move a stream across the tenant boundary (enforced by
// guard-event-store-writes' allowlist). Each move leaves an audit event in
// the destination tenant.
//
// Runs entirely on the caller-supplied DbRunner, so the move rides whatever
// transaction the caller is already inside (tenant-handover's claim handler
// commits it together with the root row's ownership write — see
// move-entity-graph.ts's file header for why that matters).

import { AGGREGATE_TRANSFERRED_EVENT_TYPE } from "../crypto/system-event-pii.js";
import type { DbRunner } from "../db/index.js";
import {
  deleteSnapshotsForAggregates,
  transferArchivedStreamRows,
  transferEventRows,
} from "../db/queries/event-store-transfer.js";
import type { TenantId } from "../engine/types/index.js";
import { generateId } from "../utils/ids.js";
import { append } from "./event-store.js";

export const AGGREGATE_TRANSFER_STREAM_TYPE = "aggregate-transfer";
export { AGGREGATE_TRANSFERRED_EVENT_TYPE };

export type TransferAggregateStreamsArgs = {
  readonly sourceTenantId: TenantId;
  readonly destinationTenantId: TenantId;
  readonly aggregateType: string;
  readonly aggregateIds: readonly string[];
  readonly transferredBy: string;
};

// Moves one aggregate type's event history, drops its cached snapshots, and
// carries any archive marker across the tenant boundary. Returns the number
// of aggregates that actually had events (and therefore moved) — an id in
// `aggregateIds` with no events under `sourceTenantId`/`aggregateType`
// contributes nothing and gets no follow-up event.
export async function transferAggregateStreams(
  db: DbRunner,
  args: TransferAggregateStreamsArgs,
): Promise<number> {
  if (args.aggregateIds.length === 0) return 0;

  const movedAggregateIds = await transferEventRows(db, {
    sourceTenantId: args.sourceTenantId,
    destinationTenantId: args.destinationTenantId,
    aggregateType: args.aggregateType,
    aggregateIds: args.aggregateIds,
  });
  if (movedAggregateIds.length === 0) return 0;

  await deleteSnapshotsForAggregates(db, {
    tenantId: args.sourceTenantId,
    aggregateIds: movedAggregateIds,
  });
  await transferArchivedStreamRows(db, {
    sourceTenantId: args.sourceTenantId,
    destinationTenantId: args.destinationTenantId,
    aggregateType: args.aggregateType,
    aggregateIds: movedAggregateIds,
  });

  for (const aggregateId of movedAggregateIds) {
    // A fresh, own stream — not an append onto the moved aggregate's own
    // stream — so the marker never bumps the moved aggregate's version or
    // shows up when a projection replays that aggregate's history.
    await append(db, {
      aggregateId: generateId(),
      aggregateType: AGGREGATE_TRANSFER_STREAM_TYPE,
      tenantId: args.destinationTenantId,
      expectedVersion: 0,
      type: AGGREGATE_TRANSFERRED_EVENT_TYPE,
      payload: {
        aggregateType: args.aggregateType,
        aggregateId,
        sourceTenantId: args.sourceTenantId,
        destinationTenantId: args.destinationTenantId,
      },
      metadata: { userId: args.transferredBy },
    });
  }

  return movedAggregateIds.length;
}
