import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-framework/crypto";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
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
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "jobs:write:retry requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant("cross-tenant job monitoring");
    // @cast-boundary engine-payload — JobRunner attached by app-boot via ctx-extension
    const jobRunner = ctx["jobRunner"] as JobRunner;

    const run = await fetchOne<JobRunRow>(db, jobRunsTable, { id: event.payload.runId });

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

    // payload is stored encrypted under the triggering user's DEK (#799),
    // same mechanism as detail.query.ts/list.query.ts — decrypt before
    // parsing it as JSON. A key erased since the run finished decrypts to
    // PII_ERASED_SENTINEL, which is not JSON; reject the retry rather than
    // dispatch it with a silently emptied payload.
    let payload: Record<string, unknown> = {};
    if (run.payload) {
      const decryptedPayload = await decryptStoredPii(
        run.payload,
        "payload",
        `job run ${event.payload.runId} payload`,
      );
      if (decryptedPayload === PII_ERASED_SENTINEL) {
        return writeFailure(
          new UnprocessableError(JobErrors.payloadErased, {
            i18nKey: "jobs.errors.payloadErased",
          }),
        );
      }
      payload = parseJsonOrThrow<Record<string, unknown>>(
        decryptedPayload,
        `job run ${event.payload.runId} payload`,
      );
    }

    const bullJobId = await jobRunner.dispatch(run.jobName, payload);

    return {
      isSuccess: true,
      data: { jobName: run.jobName, bullJobId, retriedFromRunId: event.payload.runId },
    };
  },
});
