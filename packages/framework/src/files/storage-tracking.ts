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

// sql now comes from native dialect
import { asRawClient } from "../bun-db/query";
import { sql, bigint, instant, integer, table as pgTable, uuid  } from "../db/dialect";
import { defineFeature, typedPayload } from "../engine";
import { fileUploadedEvent } from "./file-routes";

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
      [fileUploadedEvent.name]: async (event, tx) => {
        const payload = typedPayload(event, fileUploadedEvent);

        // UPSERT: INSERT on first upload per tenant, otherwise atomic increment.
        // The SQL increment guarantees correctness under concurrent dispatcher
        // runs (shouldn't happen with a single consumer, but the invariant is
        // free and cheap — no reason to rely on serial delivery).
        await asRawClient(tx).unsafe(
          `INSERT INTO "read_tenant_storage_usage" ("tenant_id", "total_bytes", "file_count")
           VALUES ($1, $2, 1)
           ON CONFLICT ("tenant_id") DO UPDATE SET
             "total_bytes" = "read_tenant_storage_usage"."total_bytes" + $2,
             "file_count" = "read_tenant_storage_usage"."file_count" + 1,
             "last_updated_at" = NOW()`,
          [event.tenantId, payload.size],
        );
      },
    },
  });
});
