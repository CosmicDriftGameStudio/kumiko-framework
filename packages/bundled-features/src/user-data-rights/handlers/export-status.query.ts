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

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { exportJobsTable } from "../schema/export-job";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

type ExportJobRow = {
  readonly id: string;
  readonly status: string;
  readonly requested_at: Instant;
  readonly completed_at: Instant | null;
  readonly expires_at: Instant | null;
  readonly error_message: string | null;
  readonly bytes_written: number | null;
};

export const exportStatusQuery = defineQueryHandler({
  name: "export-status",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    // ctx.db.raw weil tenant-agnostisch — ein User der aus Tenant B
    // pollt, sieht den aus Tenant A erstellten Job.
    const rows = await selectMany<ExportJobRow>(
      ctx.db.raw,
      exportJobsTable,
      { userId: query.user.id },
      { limit: 1, orderBy: { col: "requestedAt", direction: "desc" } },
    );

    const latest = rows[0];
    if (!latest) return { hasJob: false as const };

    return {
      hasJob: true as const,
      job: {
        id: latest["id"],
        status: latest["status"],
        requestedAt: latest["requested_at"].toString(),
        completedAt: latest["completed_at"]?.toString() ?? null,
        expiresAt: latest["expires_at"]?.toString() ?? null,
        errorMessage: latest["error_message"],
        bytesWritten: latest["bytes_written"],
      },
    };
  },
});
