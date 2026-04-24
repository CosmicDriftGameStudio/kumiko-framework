import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { detailQuery } from "./handlers/detail.query";
import { listQuery } from "./handlers/list.query";
import { retryWrite } from "./handlers/retry.write";
import { triggerWrite } from "./handlers/trigger.write";
import {
  JOB_RUN_COMPLETED_EVENT,
  JOB_RUN_FAILED_EVENT,
  JOB_RUN_STARTED_EVENT,
} from "./job-run-logger";
import { jobRunEntity, jobRunLogsTable, jobRunsTable } from "./job-run-table";

// Event-schema registration — domain events are written via low-level
// append() from the job-runner callbacks (BullMQ callbacks run outside
// the dispatcher ctx), but defineEvent keeps the types discoverable for
// ops tools and the audit-feature, AND makes them valid apply-keys for
// the r.projection below.
const logEntrySchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  timestamp: z.string(),
});

const runStartedSchema = z.object({
  jobName: z.string(),
  bullJobId: z.string(),
  status: z.literal("running"),
  payload: z.string().nullable(),
  triggeredById: z.string().nullable(),
  startedAt: z.string(),
  attempt: z.number(),
});

const runCompletedSchema = z.object({
  duration: z.number(),
  finishedAt: z.string(),
  logs: z.array(logEntrySchema),
});

const runFailedSchema = z.object({
  duration: z.number(),
  finishedAt: z.string(),
  error: z.string(),
  logs: z.array(logEntrySchema),
});

export function createJobsFeature(): FeatureDefinition {
  return defineFeature("jobs", (r) => {
    r.systemScope();
    r.entity("jobRun", jobRunEntity);

    r.defineEvent("run-started", runStartedSchema);
    r.defineEvent("run-completed", runCompletedSchema);
    r.defineEvent("run-failed", runFailedSchema);

    // Inline projection: status-row in jobRunsTable. Runs in same TX as
    // the event-append (the logger calls runProjectionsForEvent manually
    // because the BullMQ-callback path has no dispatcher-ctx).
    r.projection({
      name: "job-runs",
      source: "jobRun",
      table: jobRunsTable,
      apply: {
        [JOB_RUN_STARTED_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof runStartedSchema>;
          await tx.insert(jobRunsTable).values({
            id: event.aggregateId,
            tenantId: event.tenantId,
            version: event.version,
            insertedAt: event.createdAt,
            insertedById: event.metadata?.userId ?? "system",
            jobName: p.jobName,
            bullJobId: p.bullJobId,
            status: p.status,
            payload: p.payload,
            attempt: p.attempt,
            startedAt: Temporal.Instant.from(p.startedAt),
            triggeredById: p.triggeredById,
          });
        },
        [JOB_RUN_COMPLETED_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof runCompletedSchema>;
          await tx
            .update(jobRunsTable)
            .set({
              status: "completed",
              duration: p.duration,
              finishedAt: Temporal.Instant.from(p.finishedAt),
              version: event.version,
              modifiedAt: event.createdAt,
              modifiedById: event.metadata?.userId ?? "system",
            })
            .where(eq(jobRunsTable.id, event.aggregateId));
        },
        [JOB_RUN_FAILED_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof runFailedSchema>;
          await tx
            .update(jobRunsTable)
            .set({
              status: "failed",
              error: p.error,
              duration: p.duration,
              finishedAt: Temporal.Instant.from(p.finishedAt),
              version: event.version,
              modifiedAt: event.createdAt,
              modifiedById: event.metadata?.userId ?? "system",
            })
            .where(eq(jobRunsTable.id, event.aggregateId));
        },
      },
    });

    // Second inline projection — same source, different table. Expands
    // the batched logs array from completed/failed events into N rows
    // per run in jobRunLogsTable.
    r.projection({
      name: "job-run-logs",
      source: "jobRun",
      table: jobRunLogsTable,
      apply: {
        [JOB_RUN_COMPLETED_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof runCompletedSchema>;
          // skip: empty log batch — the worker ran silent. No child rows
          // to insert; the completed-event alone already updated the run's
          // status via the sibling job-runs projection.
          if (p.logs.length === 0) return;
          await tx.insert(jobRunLogsTable).values(
            p.logs.map((log) => ({
              runId: event.aggregateId,
              level: log.level,
              message: log.message,
              timestamp: Temporal.Instant.from(log.timestamp),
            })),
          );
        },
        [JOB_RUN_FAILED_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof runFailedSchema>;
          // skip: empty log batch — the worker ran silent. No child rows
          // to insert; the completed-event alone already updated the run's
          // status via the sibling job-runs projection.
          if (p.logs.length === 0) return;
          await tx.insert(jobRunLogsTable).values(
            p.logs.map((log) => ({
              runId: event.aggregateId,
              level: log.level,
              message: log.message,
              timestamp: Temporal.Instant.from(log.timestamp),
            })),
          );
        },
      },
    });

    const handlers = {
      trigger: r.writeHandler(triggerWrite),
      retry: r.writeHandler(retryWrite),
    };

    const queries = {
      list: r.queryHandler(listQuery),
      detail: r.queryHandler(detailQuery),
    };

    return { handlers, queries };
  });
}
