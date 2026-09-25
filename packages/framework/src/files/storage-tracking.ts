// Tenant storage usage — counts bytes + files per tenant from the event log.
//
// Tracking-only for Phase 1: no hard limit, no upload gatekeeping. Apps read
// the row to decide what to do (show a warning, soft-throttle, bill, …).
// Enforcement is a conscious deferred call — we want production numbers
// before picking thresholds (see "Storage tracking: counted now, enforced
// later" in core-files.md).
//
// The MSP is packaged as its own opt-in feature so tests that don't care
// about storage metrics don't pay for the projection-table push or the
// consumer-cursor row. Apps that want it pass filesStorageTrackingFeature
// into createApp / setupTestStack alongside their domain features.

import { type DbRunner, entityEventName, executeRawQueryRead } from "../db";
import { bigint, instant, integer, table as pgTable, sql, uuid } from "../db/dialect";
import { incrementCounter } from "../db/query";
import { defineFeature, qn, type Registry, toKebab } from "../engine";
import {
  type PendingGapEntry,
  SHARED_INSTANCE_SENTINEL,
  selectConsumerCursorForUpdate,
} from "../pipeline";
import { parseJsonOrThrow } from "../utils";

const FILE_REF_AGGREGATE_TYPE = "fileRef";
const STORAGE_TRACKING_FEATURE_NAME = "files-storage-tracking";
const TENANT_STORAGE_USAGE_MSP_NAME = "tenant-storage-usage";

// fileRef is a standard ES entity, so usage tracking subscribes to its
// auto-verb events. `fileRef.created` payload carries the entity fields
// (incl. size); `fileRef.deleted` / `fileRef.restored` carry `{ previous }`
// (the pre-event row), so the byte count to apply lives at previous.size.
const FILE_REF_CREATED = entityEventName(FILE_REF_AGGREGATE_TYPE, "created");
const FILE_REF_DELETED = entityEventName(FILE_REF_AGGREGATE_TYPE, "deleted");
const FILE_REF_RESTORED = entityEventName(FILE_REF_AGGREGATE_TYPE, "restored");

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function sizeFromPrevious(payload: Record<string, unknown>): number {
  const previous = payload["previous"];
  if (previous && typeof previous === "object" && !Array.isArray(previous)) {
    return readNumber((previous as Record<string, unknown>)["size"]); // @cast-boundary engine-payload
  }
  return 0;
}

// Single source of truth for "how much does this fileRef event move the
// tenant's storage counters" — shared by the MSP's own apply handlers and by
// transferTenantStorageUsage's replay of already-applied events during a
// tenant handover.
export function fileRefStorageDelta(event: {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}): { readonly bytes: number; readonly files: number } | null {
  switch (event.type) {
    case FILE_REF_CREATED:
      return { bytes: readNumber(event.payload["size"]), files: 1 };
    case FILE_REF_DELETED:
      // `0 - x`, not `-x`: a zero-byte previous size must stay `0`, not `-0`
      // (toEqual/JSON round-trips treat -0 as distinct from 0).
      return { bytes: 0 - sizeFromPrevious(event.payload), files: -1 };
    case FILE_REF_RESTORED:
      return { bytes: sizeFromPrevious(event.payload), files: 1 };
    default:
      return null;
  }
}

// bigint in `mode: "number"` returns a JS number (safe up to 2^53 ≈ 9e15
// bytes ≈ 8 petabytes per tenant — large enough for any practical storage
// quota). Default "bigint" mode would hand back a bigint value, which
// arithmetic on Drizzle's sql`` template would still accept but forces
// callers to remember the type.
export const tenantStorageUsageTable = pgTable("read_tenant_storage_usage", {
  tenantId: uuid("tenant_id").primaryKey(),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
  lastUpdatedAt: instant("last_updated_at").default(sql`now()`).notNull(),
});

export const filesStorageTrackingFeature = defineFeature(STORAGE_TRACKING_FEATURE_NAME, (r) => {
  r.multiStreamProjection({
    name: TENANT_STORAGE_USAGE_MSP_NAME,
    table: tenantStorageUsageTable,
    apply: {
      [FILE_REF_CREATED]: async (event, tx) => {
        const delta = fileRefStorageDelta(event);
        // skip: not a tracked fileRef storage change
        if (!delta) return;

        // UPSERT: INSERT on first upload per tenant, otherwise atomic increment.
        // The SQL increment guarantees correctness under concurrent dispatcher
        // runs (shouldn't happen with a single consumer, but the invariant is
        // free and cheap — no reason to rely on serial delivery).
        await incrementCounter(
          tx,
          tenantStorageUsageTable,
          { tenantId: event.tenantId, totalBytes: delta.bytes, fileCount: delta.files },
          { totalBytes: delta.bytes, fileCount: delta.files },
          { set: { lastUpdatedAt: sql`now()` } },
        );
      },
      [FILE_REF_DELETED]: async (event, tx) => {
        const delta = fileRefStorageDelta(event);
        // skip: not a tracked fileRef storage change
        if (!delta) return;
        // Decrement on delete. INSERT values are 0/0 so a delete that somehow
        // precedes any upload can't create negative usage; the on-conflict
        // path applies the real negative delta. Async (dispatcher) —
        // eventually-consistent with the write-tx that emitted fileRef.deleted.
        await incrementCounter(
          tx,
          tenantStorageUsageTable,
          { tenantId: event.tenantId, totalBytes: 0, fileCount: 0 },
          { totalBytes: delta.bytes, fileCount: delta.files },
          { set: { lastUpdatedAt: sql`now()` } },
        );
      },
      [FILE_REF_RESTORED]: async (event, tx) => {
        // Restore re-increments by the soft-deleted row's size — symmetric
        // to delete. Without this handler totalBytes/fileCount drift low
        // after every delete→restore round-trip.
        const delta = fileRefStorageDelta(event);
        // skip: not a tracked fileRef storage change
        if (!delta) return;
        await incrementCounter(
          tx,
          tenantStorageUsageTable,
          { tenantId: event.tenantId, totalBytes: delta.bytes, fileCount: delta.files },
          { totalBytes: delta.bytes, fileCount: delta.files },
          { set: { lastUpdatedAt: sql`now()` } },
        );
      },
    },
  });
});

// Qualified name of the tenant-storage-usage MSP consumer row in
// kumiko_event_consumers — the same qualification registry-ingest.ts applies
// to every multiStreamProjection (qualify(featureName, "projection", name)).
const TENANT_STORAGE_USAGE_MSP_QN = qn(
  toKebab(STORAGE_TRACKING_FEATURE_NAME),
  "projection",
  toKebab(TENANT_STORAGE_USAGE_MSP_NAME),
);

const TRACKED_FILE_REF_EVENT_TYPES = [FILE_REF_CREATED, FILE_REF_DELETED, FILE_REF_RESTORED];

function isWithinPendingGap(eventId: bigint, gaps: readonly PendingGapEntry[]): boolean {
  return gaps.some((gap) => eventId >= BigInt(gap.from) && eventId <= BigInt(gap.to));
}

// Moves the already-applied share of the tenant-storage-usage counters from
// source to destination tenant when a tenant-handover claim moves fileRef
// rows. Must run BEFORE moveEventHistory rewrites the events' tenant_id —
// the query below finds "already applied" events by sourceTenantId, and once
// the rewrite runs there is no way to tell an already-applied event from a
// not-yet-applied one by tenant_id alone.
//
// Events with id above the cursor (or inside a pending gap) are NOT summed
// here: the dispatcher hasn't applied them yet, they will carry the
// destination tenant_id once moveEventHistory runs, and the dispatcher will
// apply them against the destination counter on its own next pass.
export async function transferTenantStorageUsage(args: {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly fileRefIds: readonly string[];
  readonly sourceTenantId: string;
  readonly destinationTenantId: string;
}): Promise<void> {
  const { db, registry, fileRefIds, sourceTenantId, destinationTenantId } = args;
  // skip: no fileRefs moved, nothing to transfer
  if (fileRefIds.length === 0) return;
  // skip: storage tracking is not mounted in this app
  if (!registry.getAllMultiStreamProjections().has(TENANT_STORAGE_USAGE_MSP_QN)) return;

  // Locks the same consumer row the dispatcher's own FOR UPDATE SKIP LOCKED
  // pass takes before applying a batch — serializing against it here means no
  // fileRef event for these ids can be applied between reading the cursor
  // below and the tenant move that follows in the caller.
  const cursor = await selectConsumerCursorForUpdate(
    db,
    TENANT_STORAGE_USAGE_MSP_QN,
    SHARED_INSTANCE_SENTINEL,
  );
  // skip: no consumer row means the MSP never applied anything yet
  if (!cursor) return;

  const rows = await executeRawQueryRead<{ id: string; type: string; payload: string }>(
    db,
    `SELECT "id"::text AS id, "type", "payload"::text AS payload FROM kumiko_events
     WHERE "tenant_id" = $1 AND "aggregate_type" = $2 AND "aggregate_id" = ANY($3)
       AND "type" = ANY($4) AND "id" <= $5`,
    [
      sourceTenantId,
      FILE_REF_AGGREGATE_TYPE,
      fileRefIds,
      TRACKED_FILE_REF_EVENT_TYPES,
      cursor.lastProcessedEventId,
    ],
  );

  let bytes = 0;
  let files = 0;
  for (const row of rows) {
    if (isWithinPendingGap(BigInt(row.id), cursor.pendingGaps)) continue;
    const delta = fileRefStorageDelta({
      type: row.type,
      payload: parseJsonOrThrow<Record<string, unknown>>(
        row.payload,
        "transferTenantStorageUsage: kumiko_events.payload",
      ),
    });
    if (!delta) continue;
    bytes += delta.bytes;
    files += delta.files;
  }
  // skip: the moved fileRefs carry no applied storage share
  if (bytes === 0 && files === 0) return;

  // Source: insert-values stay 0/0 (same guard as the DELETED handler above)
  // — the row this subtracts from is expected to already exist (the MSP
  // already applied the create against it), and if it somehow doesn't, this
  // must not conjure a negative balance out of thin air.
  await incrementCounter(
    db,
    tenantStorageUsageTable,
    { tenantId: sourceTenantId, totalBytes: 0, fileCount: 0 },
    { totalBytes: -bytes, fileCount: -files },
    { set: { lastUpdatedAt: sql`now()` } },
  );
  // Destination: insert-values ARE the transferred amount (same as CREATED/
  // RESTORED above) — a tenant claiming its first-ever fileRef must start
  // its counter row at the transferred total, not at 0 with an increment
  // that only fires once a row already exists.
  await incrementCounter(
    db,
    tenantStorageUsageTable,
    { tenantId: destinationTenantId, totalBytes: bytes, fileCount: files },
    { totalBytes: bytes, fileCount: files },
    { set: { lastUpdatedAt: sql`now()` } },
  );
}
