import { asEntityTableMeta } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type EntityTableMeta,
  instant,
  table as pgTable,
  serial,
  sql,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

// The tenant's own view of a failed job (fw#3079). Direct-write store like
// store_job_runs: job-run-logger.ts writes it from the BullMQ callbacks,
// outside any dispatcher transaction.
//
// Deliberately holds no error text. `message_key` is a translation key
// (the thrown KumikoError's i18nKey or the one declared at the job), so a
// provider message can never reach the tenant through this table — it stays
// on store_job_runs.error and in store_job_run_logs, both SystemAdmin-only.
//
// One row per (tenant, job, subject): a later final-attempt failure replaces
// it, a later successful run of the same key deletes it. `subject` is the
// canonical JSON of the job's declared subjectFields, or NULL for a job that
// declares none — stored in clear, so a job must not declare a PII field
// as its subject.
export const tenantJobFailuresTable = pgTable("store_tenant_job_failures", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  jobName: text("job_name").notNull(),
  subject: text("subject"),
  messageKey: text("message_key").notNull(),
  failedAt: instant("failed_at").default(sql`now()`).notNull(),
});

const derivedTenantJobFailuresTableMeta = asEntityTableMeta(tenantJobFailuresTable);
if (!derivedTenantJobFailuresTableMeta) {
  throw new Error("tenantJobFailuresTable: table carries no EntityTableMeta — built via table()?");
}
export const tenantJobFailuresTableMeta: EntityTableMeta = derivedTenantJobFailuresTableMeta;
