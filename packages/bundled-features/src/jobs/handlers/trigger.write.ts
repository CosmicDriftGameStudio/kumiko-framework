import type { DbRow } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  validationErrorFromZod,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { z } from "zod";
import { JobErrors } from "../constants";
import { isManualTrigger } from "../is-manual-trigger";

export const triggerWrite = defineWriteHandler({
  name: "trigger",
  description:
    "Starts one manually-triggerable job with the given payload after validating it against the job's schema; use it to run a maintenance or import job on demand.",
  schema: z.object({
    jobName: z.string(),
    payload: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const registry = ctx.registry;
    // `jobRunner` is a dynamic context extension — not a core HandlerContext field.
    const jobRunner = ctx["jobRunner"] as JobRunner; // @cast-boundary dynamic-key

    const jobDef = registry.getJob(event.payload.jobName);
    if (!jobDef) {
      return writeFailure(
        new NotFoundError("job", event.payload.jobName, {
          i18nKey: "jobs.errors.unknownJob",
        }),
      );
    }

    if (!isManualTrigger(jobDef.trigger)) {
      return writeFailure(
        new UnprocessableError(JobErrors.notManual, {
          i18nKey: "jobs.errors.notManual",
          details: { jobName: event.payload.jobName },
        }),
      );
    }

    let rawPayload: DbRow = {};
    if (typeof event.payload.payload === "string" && event.payload.payload.trim() !== "") {
      try {
        const parsed: unknown = JSON.parse(event.payload.payload);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return writeFailure(new UnprocessableError(JobErrors.notManual));
        }
        rawPayload = parsed as DbRow;
      } catch {
        return writeFailure(new UnprocessableError(JobErrors.notManual));
      }
    } else if (event.payload.payload !== undefined) {
      rawPayload = event.payload.payload as DbRow;
    }
    let payload: DbRow = rawPayload;
    if (jobDef.schema !== undefined) {
      const parsed = jobDef.schema.safeParse(rawPayload);
      if (!parsed.success) {
        return writeFailure(validationErrorFromZod(parsed.error));
      }
      payload = parsed.data as DbRow;
    }

    const bullJobId = await jobRunner.dispatch(event.payload.jobName, payload, {
      triggeredById: event.user.id,
      payload: JSON.stringify(payload),
    });

    return {
      isSuccess: true,
      data: { jobName: event.payload.jobName, bullJobId },
    };
  },
});
