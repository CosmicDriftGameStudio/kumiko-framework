// GET /api/user/export-status — user polling.
//
// Returns the calling user's most recent ExportJob (active jobs first,
// otherwise the newest done/failed job).
//
// **Cross-User-Isolation:** The filter is `userId === query.user.id`, so no
// user can view another user's job status, even by guessing an ID. The
// pre-check uses ctx.db.unsafeRaw because ExportJob is tenant-agnostic.
//
// **Read-Only-Endpoint:** Polling only; it does not change state. The endpoint
// is idempotent and cacheable. The UI typically polls every 2-5s while running.

import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { exportJobsTable } from "../schema/export-job.ts";

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
    grants: ["unsafeRaw"],
    reason: EXPORT_STATUS_REASON,
  },
  handler: async (query, ctx) => {
    const rows = await selectMany<ExportJobRow>(
      ctx.db.unsafeRaw(),
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
