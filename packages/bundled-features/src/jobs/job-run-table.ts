import {
  buildBaseColumns,
  instant,
  integer,
  table as pgTable,
  serial,
  text,
} from "@kumiko/framework/db";
import { createEntity, createSelectField, createTextField } from "@kumiko/framework/engine";

export type JobRunStatus = "queued" | "running" | "completed" | "failed";
export type JobLogLevel = "info" | "warn" | "error";

// jobRun is a system-scoped ES aggregate: every job execution is its own
// stream. Three domain-events cover the lifecycle:
//   - `jobs:event:run-started`   (when BullMQ picks a job off its queue)
//   - `jobs:event:run-completed` (duration + batched log entries)
//   - `jobs:event:run-failed`    (error + duration + batched log entries)
//
// Logs ride the completed/failed event as an array — "Option B" from the
// design discussion: one event per run instead of N events per log line,
// no log duplication across status transitions. The inline projection
// expands the batch into N rows in jobRunLogsTable, keeping the pre-ES
// detail-query-shape intact.
//
// The entity itself is a shape-anchor (minimal fields for registry
// validation); the real projection-table is jobRunsTable below, with
// custom columns that don't need entity-field declarations.
export const jobRunEntity = createEntity({
  table: "job_runs",
  idType: "uuid",
  fields: {
    jobName: createTextField({ required: true }),
    bullJobId: createTextField({ required: true }),
    status: createSelectField({
      required: true,
      options: ["queued", "running", "completed", "failed"],
    }),
  },
});

export const jobRunsTable = pgTable("job_runs", {
  ...buildBaseColumns(false, "uuid"),
  jobName: text("job_name").notNull(),
  bullJobId: text("bull_job_id").notNull(),
  status: text("status").notNull().$type<JobRunStatus>(),
  payload: text("payload"),
  error: text("error"),
  attempt: integer("attempt").default(1).notNull(),
  startedAt: instant("started_at").notNull(),
  finishedAt: instant("finished_at"),
  duration: integer("duration"),
  triggeredById: text("triggered_by_id"),
});

// Child projection keyed by the jobRun aggregate id. Pre-ES used a serial
// PK + integer runId; post-ES runId is still exposed but now holds the
// uuid of the parent jobRun. Existing detail-query callers treat it as an
// opaque identifier, so the type-switch is backward-compatible at the
// query surface.
export const jobRunLogsTable = pgTable("job_run_logs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  level: text("level").notNull().$type<JobLogLevel>(),
  message: text("message").notNull(),
  timestamp: instant("timestamp").notNull(),
});
