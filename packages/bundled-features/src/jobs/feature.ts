import { defineApply, defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import type { z } from "zod";
// Event-payload schemas live in a sibling module so the logger can import
// them without the cycle jobs-feature ↔ job-run-logger. The logger parses
// payloads against these schemas before low-level append() — that's what
// keeps out-of-dispatcher writes as type-safe as ctx.appendEvent.
import { runCompletedSchema, runFailedSchema, runStartedSchema } from "./events";
import { detailQuery } from "./handlers/detail.query";
import { listQuery } from "./handlers/list.query";
import { retryWrite } from "./handlers/retry.write";
import { triggerWrite } from "./handlers/trigger.write";
import {
  JOB_RUN_COMPLETED_EVENT,
  JOB_RUN_FAILED_EVENT,
  JOB_RUN_STARTED_EVENT,
} from "./job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "./job-run-table";

export function createJobsFeature(): FeatureDefinition {
  return defineFeature("jobs", (r) => {
    r.systemScope();
    // Events-only aggregate: "jobRun" has no r.entity registration, because
    // the entire lifecycle is driven by BullMQ-callback → r.defineEvent
    // (no executor, no CRUD). The boot-validator accepts the two
    // projections below because every apply-key is a registered
    // domain-event.
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
        [JOB_RUN_STARTED_EVENT]: defineApply<z.infer<typeof runStartedSchema>>(
          async (event, tx) => {
            const p = event.payload;
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
        ),
        [JOB_RUN_COMPLETED_EVENT]: defineApply<z.infer<typeof runCompletedSchema>>(
          async (event, tx) => {
            const p = event.payload;
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
        ),
        [JOB_RUN_FAILED_EVENT]: defineApply<z.infer<typeof runFailedSchema>>(async (event, tx) => {
          const p = event.payload;
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
        }),
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
        [JOB_RUN_COMPLETED_EVENT]: defineApply<z.infer<typeof runCompletedSchema>>(
          async (event, tx) => {
            const p = event.payload;
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
        ),
        [JOB_RUN_FAILED_EVENT]: defineApply<z.infer<typeof runFailedSchema>>(async (event, tx) => {
          const p = event.payload;
          // skip: empty log batch — the worker ran silent (mirror of completed)
          if (p.logs.length === 0) return;
          await tx.insert(jobRunLogsTable).values(
            p.logs.map((log) => ({
              runId: event.aggregateId,
              level: log.level,
              message: log.message,
              timestamp: Temporal.Instant.from(log.timestamp),
            })),
          );
        }),
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
