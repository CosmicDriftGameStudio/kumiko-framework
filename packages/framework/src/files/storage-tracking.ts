// Tenant storage usage — counts bytes + files per tenant from the event log.
//
// Tracking-only for Phase 1: no hard limit, no upload gatekeeping. Apps read
// the row to decide what to do (show a warning, soft-throttle, bill, …).
// Enforcement is a conscious deferred call — we want production numbers
// before picking thresholds (see core-files.md, Architektur-Entscheidung 3).
//
// The MSP is packaged as its own opt-in feature so tests that don't care
// about storage metrics don't pay for the projection-table push or the
// consumer-cursor row. Apps that want it pass filesStorageTrackingFeature
// into createApp / setupTestStack alongside their domain features.

import { entityEventName } from "../db";
import { bigint, instant, integer, table as pgTable, sql, uuid } from "../db/dialect";
import { incrementCounter } from "../db/query";
import { defineFeature } from "../engine";

// fileRef is a standard ES entity, so usage tracking subscribes to its
// auto-verb events. `fileRef.created` payload carries the entity fields
// (incl. size); `fileRef.deleted` carries `{ previous }` (the pre-delete
// row), so the byte count to reverse lives at previous.size.
const FILE_REF_CREATED = entityEventName("fileRef", "created");
const FILE_REF_DELETED = entityEventName("fileRef", "deleted");

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
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

export const filesStorageTrackingFeature = defineFeature("files-storage-tracking", (r) => {
  r.multiStreamProjection({
    name: "tenant-storage-usage",
    table: tenantStorageUsageTable,
    apply: {
      [FILE_REF_CREATED]: async (event, tx) => {
        const size = readNumber(event.payload["size"]);

        // UPSERT: INSERT on first upload per tenant, otherwise atomic increment.
        // The SQL increment guarantees correctness under concurrent dispatcher
        // runs (shouldn't happen with a single consumer, but the invariant is
        // free and cheap — no reason to rely on serial delivery).
        await incrementCounter(
          tx,
          tenantStorageUsageTable,
          { tenantId: event.tenantId, totalBytes: size, fileCount: 1 },
          { totalBytes: size, fileCount: 1 },
          { set: { lastUpdatedAt: sql`now()` } },
        );
      },
      [FILE_REF_DELETED]: async (event, tx) => {
        // Delete events carry the pre-delete row under `previous`.
        const previous = event.payload["previous"];
        const size =
          previous && typeof previous === "object" && !Array.isArray(previous)
            ? readNumber((previous as Record<string, unknown>)["size"]) // @cast-boundary engine-payload
            : 0;
        // Decrement on delete. INSERT values are 0/0 so a delete that somehow
        // precedes any upload can't create negative usage; the on-conflict
        // path applies the real negative delta. Async (dispatcher) —
        // eventually-consistent with the write-tx that emitted fileRef.deleted.
        await incrementCounter(
          tx,
          tenantStorageUsageTable,
          { tenantId: event.tenantId, totalBytes: 0, fileCount: 0 },
          { totalBytes: -size, fileCount: -1 },
          { set: { lastUpdatedAt: sql`now()` } },
        );
      },
    },
  });
});
