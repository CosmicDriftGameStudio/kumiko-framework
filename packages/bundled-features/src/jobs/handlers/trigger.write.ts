import type { DbRow } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { NotFoundError, writeFailure } from "@kumiko/framework/errors";
import type { JobRunner } from "@kumiko/framework/jobs";
import { z } from "zod";

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
    const jobRunner = ctx["jobRunner"] as JobRunner;

    const jobDef = registry.getJob(event.payload.jobName);
    if (!jobDef) {
      return writeFailure(
        new NotFoundError("job", event.payload.jobName, {
          i18nKey: "jobs.errors.unknownJob",
        }),
      );
    }

    const payload = (event.payload.payload ?? {}) as DbRow;
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
