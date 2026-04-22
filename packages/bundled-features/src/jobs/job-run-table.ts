import { instant, integer, table as pgTable, serial, text } from "@kumiko/framework/db";
import { sql } from "drizzle-orm";

export type JobRunStatus = "queued" | "running" | "completed" | "failed";

export const jobRunsTable = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  bullJobId: text("bull_job_id").notNull(),
  status: text("status").notNull().$type<JobRunStatus>(),
  payload: text("payload"),
  error: text("error"),
  attempt: integer("attempt").default(1).notNull(),
  startedAt: instant("started_at").default(sql`now()`).notNull(),
  finishedAt: instant("finished_at"),
  duration: integer("duration"),
  triggeredById: text("triggered_by_id"),
});

export type JobLogLevel = "info" | "warn" | "error";

export const jobRunLogsTable = pgTable("job_run_logs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  level: text("level").notNull().$type<JobLogLevel>(),
  message: text("message").notNull(),
  timestamp: instant("timestamp").default(sql`now()`).notNull(),
});
