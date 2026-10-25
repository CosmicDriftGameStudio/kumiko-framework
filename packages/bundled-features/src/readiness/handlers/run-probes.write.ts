// Starts a system-check run. The job on the worker lane (run-probes-job.ts) executes it after commit.
//
// Idempotency: an app-side pre-check returns the active run; the partial UNIQUE index
// (ACTIVE_PROBE_RUN_CONSTRAINT) catches a click that slips in between check and create (23505).

import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { staleRunAfterMs } from "../collect-probes.ts";
import {
  ACTIVE_PROBE_RUN_CONSTRAINT,
  PROBE_RUN_STATUS,
  probeRunEntity,
  probeRunsTable,
} from "../schema/probe-run.ts";

const crud = createEventStoreExecutor(probeRunsTable, probeRunEntity, {
  entityName: "probe-run",
});

const ACTIVE_STATUSES = [PROBE_RUN_STATUS.Pending, PROBE_RUN_STATUS.Running];

type ActiveRunRow = {
  readonly id: string;
  readonly version: number;
  readonly requestedAt: { readonly epochMilliseconds: number };
};

function isActiveRunConflict(failure: WriteFailure): boolean {
  return (
    failure.error.code === "unique_violation" &&
    propertyOf(failure.error.details, "constraintName") === ACTIVE_PROBE_RUN_CONSTRAINT
  );
}

export const runProbesWrite = defineWriteHandler({
  name: "run-probes",
  schema: z.object({ includePaid: z.boolean().default(false) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Starts the system check: real calls against mail, storage, search, inbound mailboxes and PDF that show what works in this environment. Returns the run id (isExisting true while a run is still active); the worker fills the run, read the outcome via readiness:query:probe-run:latest-results. Paid probes only run with includePaid true.",
  handler: async (event, ctx) => {
    if (!ctx.services.jobRunner) {
      throw new InternalError({
        message: "readiness:run-probes needs a job runner; mount the jobs infrastructure",
      });
    }

    const findActive = () =>
      ctx.db.fetchOne<ActiveRunRow>(probeRunsTable, { status: ACTIVE_STATUSES });

    const nowMs = ctx.tz.now().epochMilliseconds;
    const active = await findActive();
    if (active) {
      if (nowMs - active.requestedAt.epochMilliseconds <= staleRunAfterMs(ctx.registry)) {
        return { isSuccess: true as const, data: { runId: active.id, isExisting: true } };
      }
      const abandoned = await crud.update(
        {
          id: active.id,
          version: active.version,
          changes: { status: PROBE_RUN_STATUS.Abandoned, finishedAt: ctx.tz.now() },
        },
        event.user,
        ctx.db,
      );
      if (!abandoned.isSuccess) return abandoned;
    }

    const created = await crud.create(
      {
        status: PROBE_RUN_STATUS.Pending,
        includePaid: event.payload.includePaid,
        includeSystemProbes: event.user.roles.includes("SystemAdmin"),
        triggeredByUserId: event.user.id,
        requestedAt: ctx.tz.now(),
        results: { rows: [] },
        tenantId: event.user.tenantId,
      },
      event.user,
      ctx.db,
    );
    if (created.isSuccess) {
      return {
        isSuccess: true as const,
        data: { runId: String(created.data.id), isExisting: false },
      };
    }
    if (!isActiveRunConflict(created)) return created;

    const winner = await findActive();
    if (!winner) return created;
    return { isSuccess: true as const, data: { runId: winner.id, isExisting: true } };
  },
});
