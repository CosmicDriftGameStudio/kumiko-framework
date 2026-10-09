import { requireEntityTableMeta } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type EntityTableMeta,
  index,
  instant,
  table as pgTable,
  serial,
  sql,
  text,
  uniqueIndex,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

export type TenantJobRunStatus = "queued" | "running" | "completed" | "failed";

// The tenant's own view of a job's run state (fw#3616). Direct-write store
// like store_job_runs, written by job-run-logger.ts from the runner callbacks.
//
// store_job_runs cannot serve the tenant: it anchors every run on the system
// tenant, has no subject, and gets its row only when a run starts, so a queued
// job is invisible there. This table holds no payload, error text or logs by
// design — the tenant learns only that work is waiting, running or finished.
//
// One row per BullMQ job. Active rows (queued/running) are kept as they are;
// a finished row replaces earlier finished rows of the same (tenant, job,
// subject), so only the latest outcome stays. `subject` is the canonical JSON
// of the job's declared subjectFields, or NULL for none — stored in clear, so
// a job must not declare a PII field as its subject.
export const tenantJobRunsTable = pgTable(
  "store_tenant_job_runs",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    jobName: text("job_name").notNull(),
    subject: text("subject"),
    bullJobId: text("bull_job_id").notNull(),
    status: text("status").notNull(),
    queuedAt: instant("queued_at"),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
    updatedAt: instant("updated_at").default(sql`now()`).notNull(),
  },
  (t) => [
    uniqueIndex("store_tenant_job_runs_bull_job_id_unique").on(t.bullJobId),
    // Finishing a run prunes older outcomes by this key; the tenant query reads by it.
    index("store_tenant_job_runs_tenant_job_subject_idx").on(t.tenantId, t.jobName, t.subject),
    // Stale sweep and retention filter on age alone.
    index("store_tenant_job_runs_updated_at_idx").on(t.updatedAt),
  ],
);

export const tenantJobRunsTableMeta: EntityTableMeta = requireEntityTableMeta(
  tenantJobRunsTable,
  "tenantJobRunsTable",
);
