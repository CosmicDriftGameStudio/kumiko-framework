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

export const triggerWrite = defineWriteHandler({
  name: "trigger",
  schema: z.object({
    jobName: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
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

    if (!("manual" in jobDef.trigger) || jobDef.trigger.manual !== true) {
      return writeFailure(
        new UnprocessableError(JobErrors.notManual, {
          i18nKey: "jobs.errors.notManual",
          details: { jobName: event.payload.jobName },
        }),
      );
    }

    const rawPayload = event.payload.payload ?? {};
    let payload: DbRow = rawPayload as DbRow;
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
