import {
  defineUnmanagedTable,
  deriveEntityTableMeta,
  type EntityTableMeta,
  instant,
  table as pgTable,
  serial,
  text,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

export type JobRunStatus = "queued" | "running" | "completed" | "failed";
export type JobLogLevel = "info" | "warn" | "error";

// jobRun is a system-scoped direct-write store (#2243): every job execution
// writes straight into jobRunsTable / jobRunLogsTable from the BullMQ
// callbacks (onJobStart / -Complete / -Failed, see job-run-logger.ts) —
// no event-store detour. Pre-#2243 this was an events-only aggregate
// replayed through two inline projections; that generated two permanent
// `kumiko_events` rows per run for data that is itself already the
// system of record (no other consumer replays or MSP-subscribes to it).
//
// Logs are batched onto the completed/failed callback as an array —
// "Option B" from the original design discussion: one write per run
// instead of one write per log line, no log duplication across status
// transitions. job-run-logger.ts expands the batch into N rows in
// jobRunLogsTable.
//
// Entity-derived table (query API + migration meta share one field
// definition). status/$type<JobRunStatus> is not modeled in the entity
// schema — the column type is text, with the status union enforced at the
// app boundary (same pattern as template-resolver kind/scope).
// `table: "store_job_runs"` (not `read_*`) because this is no longer a
// rebuildable projection — `defineUnmanagedTable`/`deriveEntityTableMeta`
// reject the `read_` prefix for `source: "unmanaged"` (#1208/#1220).
export const jobRunEntity = createEntity({
  table: "store_job_runs",
  fields: {
    jobName: createTextField({ required: true }),
    bullJobId: createTextField({ required: true }),
    status: createTextField({ required: true }),
    payload: createTextField(),
    error: createTextField(),
    attempt: createNumberField({ required: true, default: 1, integer: true }),
    startedAt: createTimestampField({ required: true }),
    finishedAt: createTimestampField(),
    duration: createNumberField({ integer: true }),
    triggeredById: createTextField(),
  },
});

// Plain EntityTableMeta, NOT a branded EntityTable (buildEntityTable would
// mark it executor-only): job-run is an unmanaged direct-write store, so
// onJobStart/-Complete/-Failed need to write via ctx.db/insertOne directly
// (same pattern as sessions/schema/user-session.ts).
export const jobRunsTable: EntityTableMeta = deriveEntityTableMeta("job-run", jobRunEntity, {
  source: "unmanaged",
});
export const jobRunsTableMeta = jobRunsTable;

// Child projection keyed by the jobRun aggregate id. Pre-ES used a serial
// PK + integer runId; post-ES runId is still exposed but now holds the
// uuid of the parent jobRun. Existing detail-query callers treat it as an
// opaque identifier, so the type-switch is backward-compatible at the
// query surface.
export const jobRunLogsTable = pgTable("store_job_run_logs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  level: text("level").notNull().$type<JobLogLevel>(),
  message: text("message").notNull(),
  timestamp: instant("timestamp").notNull(),
});

// **Unmanaged table** — deliberately no createEntity. Reasoning:
//   - serial PK (not uuid) — pre-ES legacy, compatible with existing rows
//   - no tenant_id — child table of jobRun, tenant context lives on the parent
//   - no base columns (no version/inserted_at/inserted_by_id) — append-only
//     log, no in-place update, no audit columns needed
// pgTable stays the source of truth for the query API; this meta mirrors it
// for migration generation.
export const jobRunLogsTableMeta: EntityTableMeta = defineUnmanagedTable({
  tableName: "store_job_run_logs",
  columns: [
    { name: "id", pgType: "serial", notNull: true, primaryKey: true },
    { name: "run_id", pgType: "text", notNull: true },
    { name: "level", pgType: "text", notNull: true },
    { name: "message", pgType: "text", notNull: true },
    { name: "timestamp", pgType: "timestamptz", notNull: true },
  ],
});
