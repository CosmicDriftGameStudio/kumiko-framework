// GET /api/user/export-status (S2.U3 Atom 2) — User-Polling.
//
// Liefert den meist-aktuellen ExportJob des aufrufenden Users (in
// Reihenfolge: aktiver Job zuerst, sonst neuester done/failed).
//
// **Cross-User-Isolation:** Filter ist `userId === query.user.id` — kein
// User kann fremde Job-Status sehen, auch nicht via ID-Guess. Pre-Check
// nutzt ctx.db.raw weil ExportJob tenant-agnostisch ist (Plan-Doc-
// "Cross-Tenant-Semantik").
//
// **Read-Only-Endpoint:** Pollt nur, kein State-Flip. Idempotent + cache-
// fest. UI poll-Intervall typisch 2-5s waehrend running.

import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { exportJobsTable } from "../schema/export-job";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

// @cast-boundary db-row — drizzle's typed-select gibt korrekte Shapes
// fuer instant-Spalten zurueck (Temporal.Instant), aber TS-Inference
// ueber TenantDb-Wrapper kennt das nicht. Cast auf den narrow-Shape
// macht den Read-Pfad explizit. requestedAt ist `notNull` im Schema
// → niemals null. Lifecycle-Felder (completedAt/expiresAt) sind
// nullable bis Worker sie setzt.
type ExportJobRow = {
  readonly id: string;
  readonly status: string;
  readonly requestedAt: Instant;
  readonly completedAt: Instant | null;
  readonly expiresAt: Instant | null;
  readonly errorMessage: string | null;
  readonly bytesWritten: number | null;
};

export const exportStatusQuery = defineQueryHandler({
  name: "export-status",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    // ctx.db.raw weil tenant-agnostisch — ein User der aus Tenant B
    // pollt, sieht den aus Tenant A erstellten Job.
    const rows = (await ctx.db.raw
      .select({
        id: exportJobsTable["id"],
        status: exportJobsTable["status"],
        requestedAt: exportJobsTable["requestedAt"],
        completedAt: exportJobsTable["completedAt"],
        expiresAt: exportJobsTable["expiresAt"],
        errorMessage: exportJobsTable["errorMessage"],
        bytesWritten: exportJobsTable["bytesWritten"],
      })
      .from(exportJobsTable)
      .where(eq(exportJobsTable["userId"], query.user.id))
      .orderBy(desc(exportJobsTable["requestedAt"]))
      .limit(1)) as ExportJobRow[]; // @cast-boundary db-row

    const latest = rows[0];
    if (!latest) return { hasJob: false as const };

    return {
      hasJob: true as const,
      job: {
        id: latest.id,
        status: latest.status,
        requestedAt: latest.requestedAt.toString(),
        completedAt: latest.completedAt?.toString() ?? null,
        expiresAt: latest.expiresAt?.toString() ?? null,
        errorMessage: latest.errorMessage,
        bytesWritten: latest.bytesWritten,
      },
    };
  },
});
