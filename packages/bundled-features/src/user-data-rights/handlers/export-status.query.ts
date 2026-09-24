// GET /api/user/export-status (S2.U3 Atom 2) — User-Polling.
//
// Liefert den meist-aktuellen ExportJob des aufrufenden Users (in
// Reihenfolge: aktiver Job zuerst, sonst neuester done/failed).
//
// **Cross-User-Isolation:** Filter ist `userId === query.user.id` — kein
// User kann fremde Job-Status sehen, auch nicht via ID-Guess. Pre-Check
// uses ctx.db.unsafeRaw — ExportJob is tenant-agnostic (see plan doc,
// "Cross-Tenant-Semantik").
//
// **Read-Only-Endpoint:** Pollt nur, kein State-Flip. Idempotent + cache-
// fest. UI poll-Intervall typisch 2-5s waehrend running.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { exportJobsTable } from "../schema/export-job";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

const EXPORT_STATUS_REASON =
  "export jobs are keyed by userId across all of the user's tenant memberships, not the caller's current tenant";

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
  access: {
    openToAll: {
      reason:
        "each signed-in user reads only their own most recent export job; the query " +
        "filters exportJobsTable by the caller's own userId",
    },
  },
  description:
    "Returns the calling user's own most recent data-export job with its status, expiry and error, or hasJob false, for polling after a request-export while the job is still running.",
  escapeHatch: {
    reason: EXPORT_STATUS_REASON,
  },
  handler: async (query, ctx) => {
    const rows = await selectMany<ExportJobRow>(
      ctx.db.unsafeRaw(EXPORT_STATUS_REASON),
      exportJobsTable,
      { userId: query.user.id },
      { limit: 1, orderBy: { col: "requestedAt", direction: "desc" } },
    );

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
