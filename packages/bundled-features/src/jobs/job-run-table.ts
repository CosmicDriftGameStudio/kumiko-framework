import {
  buildBaseColumns,
  instant,
  integer,
  table as pgTable,
  serial,
  text,
} from "@kumiko/framework/db";

export type JobRunStatus = "queued" | "running" | "completed" | "failed";
export type JobLogLevel = "info" | "warn" | "error";

// jobRun is a system-scoped events-only aggregate: every job execution is
// its own stream, driven entirely by BullMQ-callbacks (onJobStart /
// -Complete / -Failed) via the low-level append() path. Three domain-
// events cover the lifecycle:
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
// No r.entity is registered for `jobRun` — the boot-validator accepts
// events-only projection sources where every apply-key is a registered
// domain-event (see registry.ts).
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
