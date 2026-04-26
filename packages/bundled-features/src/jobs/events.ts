// Event-payload schemas for the jobRun aggregate. Shared between
// jobs-feature.ts (registers them via r.defineEvent and consumes them
// in the inline-projections) and job-run-logger.ts (parses payloads
// before low-level append() so out-of-dispatcher writes stay as
// type-safe as ctx.appendEvent writes).
//
// Keeping them in a separate module avoids the circular import between
// jobs-feature.ts (imports the logger) and job-run-logger.ts.

import { z } from "zod";

export const jobLogEntrySchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  timestamp: z.string(),
});

export const runStartedSchema = z.object({
  jobName: z.string(),
  bullJobId: z.string(),
  status: z.literal("running"),
  payload: z.string().nullable(),
  triggeredById: z.string().nullable(),
  startedAt: z.string(),
  attempt: z.number(),
});

export const runCompletedSchema = z.object({
  duration: z.number(),
  finishedAt: z.string(),
  logs: z.array(jobLogEntrySchema),
});

export const runFailedSchema = z.object({
  duration: z.number(),
  finishedAt: z.string(),
  error: z.string(),
  logs: z.array(jobLogEntrySchema),
});
