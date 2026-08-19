// Payload schemas for the jobRun direct-write path (#2243). Pre-#2243 these
// backed jobRun's event-store payloads (r.defineEvent + inline projections);
// now job-run-logger.ts parses against them before writing straight into
// jobRunsTable/jobRunLogsTable, so an out-of-dispatcher write still gets the
// same validation guarantee ctx.appendEvent used to give it.

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
