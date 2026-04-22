import { type DbRow, fetchOne } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { NotFoundError, UnprocessableError, writeFailure } from "@kumiko/framework/errors";
import type { JobRunner } from "@kumiko/framework/jobs";
import { parseJsonOrThrow } from "@kumiko/framework/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { JobErrors } from "../constants";
import { jobRunsTable } from "../job-run-table";

export const retryWrite = defineWriteHandler({
  name: "retry",
  schema: z.object({ runId: z.number() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const jobRunner = ctx["jobRunner"] as JobRunner;

    const run = await fetchOne(db, jobRunsTable, eq(jobRunsTable.id, event.payload.runId));

    if (!run) {
      return writeFailure(
        new NotFoundError("jobRun", event.payload.runId, {
          i18nKey: "jobs.errors.notFound",
        }),
      );
    }

    const runData = run as DbRow;
    if (runData["status"] !== "failed") {
      return writeFailure(
        new UnprocessableError(JobErrors.onlyFailedCanRetry, {
          i18nKey: "jobs.errors.onlyFailedCanRetry",
          details: { status: runData["status"] },
        }),
      );
    }

    const jobName = runData["jobName"] as string;
    const payload = runData["payload"]
      ? parseJsonOrThrow<Record<string, unknown>>(
          runData["payload"] as string,
          `job run ${event.payload.runId} payload`,
        )
      : {};

    const bullJobId = await jobRunner.dispatch(jobName, payload);

    return {
      isSuccess: true,
      data: { jobName, bullJobId, retriedFromRunId: event.payload.runId },
    };
  },
});
