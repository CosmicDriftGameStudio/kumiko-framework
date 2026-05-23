import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { JobErrors } from "../constants";
import { jobRunsTable } from "../job-run-table";

type JobRunRow = {
  readonly status: string;
  readonly jobName: string;
  readonly payload: string | null;
};

export const retryWrite = defineWriteHandler({
  name: "retry",
  // Post-ES: runId is the uuid aggregate-id. See detail.query for the
  // rationale — jobs is framework-ops, callers are admin tooling only.
  schema: z.object({ runId: z.uuid() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    // @cast-boundary engine-payload — JobRunner attached by app-boot via ctx-extension
    const jobRunner = ctx["jobRunner"] as JobRunner;

    const run = await fetchOne<JobRunRow>(
      db,
      jobRunsTable,
      { id: event.payload.runId },
    );

    if (!run) {
      return writeFailure(
        new NotFoundError("jobRun", event.payload.runId, {
          i18nKey: "jobs.errors.notFound",
        }),
      );
    }

    if (run.status !== "failed") {
      return writeFailure(
        new UnprocessableError(JobErrors.onlyFailedCanRetry, {
          i18nKey: "jobs.errors.onlyFailedCanRetry",
          details: { status: run.status },
        }),
      );
    }

    const payload = run.payload
      ? parseJsonOrThrow<Record<string, unknown>>(
          run.payload,
          `job run ${event.payload.runId} payload`,
        )
      : {};

    const bullJobId = await jobRunner.dispatch(run.jobName, payload);

    return {
      isSuccess: true,
      data: { jobName: run.jobName, bullJobId, retriedFromRunId: event.payload.runId },
    };
  },
});
