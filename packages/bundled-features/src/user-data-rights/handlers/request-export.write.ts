// POST /api/user/request-export — GDPR Art. 15 and 20 trigger.
//
// The user triggers an export job, persisted through
// createEventStoreExecutor (event-sourced pattern; ES has no CRUD).
// Idempotency uses two stages:
//
//   1) **App-side pre-check (primary path):** fetch active jobs with
//      (status pending|running) for the userId. If one exists, return
//      `{jobId, isExisting: true}` without creating an event, so a click
//      storm produces one audit event rather than N.
//
//   2) **DB constraint as race protection (secondary path):** if a parallel
//      click occurs between fetchOne and crud.create, the transaction raises
//      23505 with constraint_name === "read_export_jobs_one_active_per_user".
//      Catch, re-fetch, and return the existing job with isExisting=true.
//
// **Cross-tenant semantics:** ExportJob is tenant-agnostic (one job per
// userId across all memberships), so the pre-check uses ctx.db.unsafeRaw
// (no TenantDb filter) and a click from tenant B can find the job from tenant
// A. `requestedFromTenantId` persists the tenant from the first click; the
// worker reads its compliance profile from this tenant for job TTL, stale
// handling, and cleanup.

import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import {
  ACTIVE_JOB_CONSTRAINT,
  EXPORT_JOB_STATUS,
  exportJobEntity,
  exportJobsTable,
} from "../schema/export-job.ts";

const crud = createEventStoreExecutor(exportJobsTable, exportJobEntity, {
  entityName: "export-job",
});

const REQUEST_EXPORT_REASON =
  "export jobs are keyed by userId across all of the user's tenant memberships, not the caller's current tenant";

/**
 * `createEventStoreExecutor.create` catches 23505 internally and returns
 * `WriteFailure(UniqueViolationError)` rather than throwing. Check the
 * failure code and constraintName to distinguish the app-side and race
 * paths; propagate other failures (validation, version conflicts, ...)
 * unchanged.
 */
function isActiveJobConflict(failure: WriteFailure): boolean {
  const error = failure.error as {
    code?: string;
    details?: { constraintName?: string };
  }; // @cast-boundary error-details
  return (
    error.code === "unique_violation" && error.details?.constraintName === ACTIVE_JOB_CONSTRAINT
  );
}

export const requestExportWrite = defineWriteHandler({
  name: "request-export",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "each signed-in user queues only their own data export; the active-job " +
        "check and the created job are both keyed by the caller's own userId",
    },
  },
  description:
    "Queues a GDPR Art. 15 and 20 data export for the calling user and returns its job id, handing back the running job with isExisting true instead of a second one when an export is already pending.",
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: REQUEST_EXPORT_REASON,
  },
  handler: async (event, ctx) => {
    const userId = event.user.id;
    const T = getTemporal();
    const now = T.Now.instant();
    const exportJobRunner = ctx.db.unsafeRaw();

    // Pre-Check: exportJobRunner bypasses the TenantDb-Filter — the
    // TenantDb-Wrapper would hide cross-tenant jobs.
    const existing = await findActiveJob(exportJobRunner, userId);
    if (existing) {
      // The returned status is a snapshot and can become stale between fetchOne
      // and the response if the worker changes the state concurrently. The
      // window is minimal; clients poll export-status.query for live status.
      return {
        isSuccess: true as const,
        data: {
          jobId: existing.id,
          status: existing.status,
          isExisting: true,
        },
      };
    }

    // No active job exists, so create one through crud.create. Persist the
    // user's current tenant in requestedFromTenantId so the worker reads the
    // compliance profile from that tenant.
    const result = await crud.create(
      {
        userId,
        requestedFromTenantId: event.user.tenantId,
        requestedAt: now,
        tenantId: event.user.tenantId,
      },
      event.user,
      ctx.db,
    );

    if (!result.isSuccess) {
      // A parallel click may create an active job between findActiveJob and
      // crud.create, causing UniqueViolationError for our constraint. Re-fetch
      // and return the existing job with isExisting=true. Propagate other
      // failures (validation, version conflicts, ...) unchanged.
      if (isActiveJobConflict(result)) {
        const winner = await findActiveJob(exportJobRunner, userId);
        if (!winner) {
          // This should be impossible: a constraint violation without an existing
          // active job would mean the constraint matched something else.
          // Return the original failure so the inconsistency is visible.
          return result;
        }
        return {
          isSuccess: true as const,
          data: {
            jobId: winner.id,
            status: winner.status,
            isExisting: true,
          },
        };
      }
      return result;
    }

    // SaveContext.id is EntityId (number | string), while exportJobEntity has
    // idType:"uuid" and therefore guarantees a string. String() protects
    // against drift if the entity is migrated to serial.
    const created = result.data as SaveContext; // @cast-boundary engine-payload
    return {
      isSuccess: true as const,
      data: {
        jobId: String(created.id),
        // This is a snapshot: a just-created job is pending. Live status comes
        // from export-status.query; this value is only a convenience for the
        // initial UI render ("Anfrage angenommen, currently pending").
        status: EXPORT_JOB_STATUS.Pending,
        isExisting: false,
      },
    };
  },
});

async function findActiveJob(
  db: import("@cosmicdrift/kumiko-framework/db").DbRunner,
  userId: string,
): Promise<{ id: string; status: string } | null> {
  const row = await fetchOne<{ id: string; status: string }>(db, exportJobsTable, {
    userId,
    status: [EXPORT_JOB_STATUS.Pending, EXPORT_JOB_STATUS.Running],
  });
  return row ?? null;
}
