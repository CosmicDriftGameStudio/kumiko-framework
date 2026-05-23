import { buildDrizzleTable, instant, table as pgTable, serial, text } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

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
// Entity-derived table — Phase 3b of drizzle-replacement. Earlier this was
// a hand-written pgTable; the entity-form is the single source for both
// the drizzle-table (query API) and the future EntityTableMeta-based
// migration generator. status/$type<JobRunStatus> ist nicht im entity-
// schema modelliert — Drizzle's column-type ist text mit CHECK-Constraint
// als App-Boundary (gleicher Pattern wie template-resolver kind/scope).
export const jobRunEntity = createEntity({
  table: "read_job_runs",
  fields: {
    jobName: createTextField({ required: true }),
    bullJobId: createTextField({ required: true }),
    status: createTextField({ required: true }),
    payload: createTextField(),
    error: createTextField(),
    attempt: createNumberField({ required: true, default: 1 }),
    startedAt: createTimestampField({ required: true }),
    finishedAt: createTimestampField(),
    duration: createNumberField(),
    triggeredById: createTextField(),
  },
});

export const jobRunsTable = buildDrizzleTable("job-run", jobRunEntity);

// Child projection keyed by the jobRun aggregate id. Pre-ES used a serial
// PK + integer runId; post-ES runId is still exposed but now holds the
// uuid of the parent jobRun. Existing detail-query callers treat it as an
// opaque identifier, so the type-switch is backward-compatible at the
// query surface.
export const jobRunLogsTable = pgTable("read_job_run_logs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  level: text("level").notNull().$type<JobLogLevel>(),
  message: text("message").notNull(),
  timestamp: instant("timestamp").notNull(),
});
