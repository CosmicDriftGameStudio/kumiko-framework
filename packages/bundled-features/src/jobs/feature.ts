import { insertMany, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineApply,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { z } from "zod";
import { JOB_RUN_DETAIL_SCREEN_ID, JOB_RUNS_SCREEN_ID } from "./constants";
// Event-payload schemas live in a sibling module so the logger can import
// them without the cycle jobs-feature ↔ job-run-logger. The logger parses
// payloads against these schemas before low-level append() — that's what
// keeps out-of-dispatcher writes as type-safe as ctx.appendEvent.
import { runCompletedSchema, runFailedSchema, runStartedSchema } from "./events";
import { detailQuery } from "./handlers/detail.query";
import { listQuery } from "./handlers/list.query";
import {
  projectionRebuildJob,
  projectionRebuildPayloadSchema,
} from "./handlers/projection-rebuild.job";
import { reindexEntityJob, reindexEntityPayloadSchema } from "./handlers/reindex-entity.job";
import { retryWrite } from "./handlers/retry.write";
import { triggerWrite } from "./handlers/trigger.write";
import { JOBS_I18N } from "./i18n";
import {
  JOB_RUN_COMPLETED_EVENT,
  JOB_RUN_FAILED_EVENT,
  JOB_RUN_STARTED_EVENT,
} from "./job-run-logger";
import { jobRunLogsTable, jobRunLogsTableMeta, jobRunsTable } from "./job-run-table";

export function createJobsFeature(): FeatureDefinition {
  return defineFeature("jobs", (r) => {
    r.describe(
      "Persistence and operator tooling for background jobs registered via `r.job(...)`. Every job execution appends `run-started`, `run-completed`, and `run-failed` events to the `jobRun` aggregate stream, which two inline projections materialize into `read_job_runs` (current status + duration) and `read_job_run_logs` (per-line log rows). Exposes `jobs:write:trigger` (manual run) and `jobs:write:retry` (operator retry of a failed run), plus `jobs:query:list` and `jobs:query:details` for the operator UI.",
    );
    r.uiHints({
      displayLabel: "Jobs · Audit & Operator UI",
      category: "operations",
      recommended: false,
    });
    r.systemScope();
    r.rawTable(jobRunLogsTableMeta, {
      reason: "read_side.job_run_logs",
    });
    // Events-only aggregate: "jobRun" has no r.entity registration, because
    // the entire lifecycle is driven by BullMQ-callback → r.defineEvent
    // (no executor, no CRUD). The boot-validator accepts the two
    // projections below because every apply-key is a registered
    // domain-event.
    // payload can carry arbitrary user data; triggeredById stays plaintext
    // (pseudonymous fk). System runs (triggeredById null) stay plaintext —
    // no user subject to shred.
    r.defineEvent("run-started", runStartedSchema, {
      piiFields: { payload: { subjectField: "triggeredById" } },
    });
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
          async (event, tx, table) => {
            const p = event.payload;
            await insertOne(tx, table, {
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
          async (event, tx, table) => {
            const p = event.payload;
            await updateMany(
              tx,
              table,
              {
                status: "completed",
                duration: p.duration,
                finishedAt: Temporal.Instant.from(p.finishedAt),
                version: event.version,
                modifiedAt: event.createdAt,
                modifiedById: event.metadata?.userId ?? "system",
              },
              { id: event.aggregateId },
            );
          },
        ),
        [JOB_RUN_FAILED_EVENT]: defineApply<z.infer<typeof runFailedSchema>>(
          async (event, tx, table) => {
            const p = event.payload;
            await updateMany(
              tx,
              table,
              {
                status: "failed",
                error: p.error,
                duration: p.duration,
                finishedAt: Temporal.Instant.from(p.finishedAt),
                version: event.version,
                modifiedAt: event.createdAt,
                modifiedById: event.metadata?.userId ?? "system",
              },
              { id: event.aggregateId },
            );
          },
        ),
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
            await insertMany(
              tx,
              jobRunLogsTable,
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
          await insertMany(
            tx,
            jobRunLogsTable,
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

    // Framework-provided rebuild job — available whenever `jobs` is composed; enqueueProjectionRebuild dispatches it.
    r.job(
      "projectionRebuild",
      { trigger: { manual: true }, schema: projectionRebuildPayloadSchema },
      projectionRebuildJob,
    );

    // Retroactive search backfill (#1206/#1215) — manual + perTenant, so one
    // `jobs:write:trigger` call with { entity } fans out to every active
    // tenant (job-runner.ts perTenant dispatch applies to manual triggers
    // too, not just cron).
    r.job(
      "reindexEntity",
      { trigger: { manual: true }, perTenant: true, schema: reindexEntityPayloadSchema },
      reindexEntityJob,
    );

    const handlers = {
      trigger: r.writeHandler(triggerWrite),
      retry: r.writeHandler(retryWrite),
    };

    const queries = {
      list: r.queryHandler(listQuery),
      detail: r.queryHandler(detailQuery),
    };

    const systemAdminAccess = { roles: ["SystemAdmin"] as const };

    r.translations({ keys: JOBS_I18N });

    r.screen({
      id: JOB_RUNS_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "JobRunsScreen" } },
      access: systemAdminAccess,
    });
    r.screen({
      id: JOB_RUN_DETAIL_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "JobRunDetailScreen" } },
      listScreenId: JOB_RUNS_SCREEN_ID,
      access: systemAdminAccess,
    });
    r.nav({
      id: "job-runs",
      label: "jobs:nav.jobRuns",
      icon: "list",
      screen: "jobs:screen:job-runs",
      order: 10,
    });

    return { handlers, queries };
  });
}
