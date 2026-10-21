import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { catalogQuery } from "./handlers/catalog.query.ts";
import {
  consumerDisableWrite,
  consumerEnableWrite,
  consumerRestartWrite,
  consumerSkipWrite,
} from "./handlers/consumer.write.ts";
import { consumerDetailQuery, consumersQuery } from "./handlers/consumers.query.ts";
import { detailQuery } from "./handlers/detail.query.ts";
import { listQuery } from "./handlers/list.query.ts";
import {
  projectionRebuildJob,
  projectionRebuildPayloadSchema,
} from "./handlers/projection-rebuild.job.ts";
import { reindexEntityJob, reindexEntityPayloadSchema } from "./handlers/reindex-entity.job.ts";
import {
  createRetentionCleanupJob,
  DEFAULT_JOB_RUN_RETENTION_DAYS,
} from "./handlers/retention-cleanup.job.ts";
import { retryWrite } from "./handlers/retry.write.ts";
import {
  createStaleRunSweepJob,
  DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS,
} from "./handlers/stale-run-sweep.job.ts";
import { tenantFailuresQuery } from "./handlers/tenant-failures.query.ts";
import { tenantRunsQuery } from "./handlers/tenant-runs.query.ts";
import { triggerWrite } from "./handlers/trigger.write.ts";
import { jobRunLogsTableMeta, jobRunsTableMeta } from "./job-run-table.ts";
import {
  eventConsumerDetailScreen,
  eventConsumersScreen,
  jobRunDetailScreen,
  jobRunsScreen,
  jobTriggerScreen,
} from "./screens.ts";
import { tenantJobFailuresTableMeta } from "./tenant-job-failure-table.ts";
import { tenantJobRunsTableMeta } from "./tenant-job-run-table.ts";
import { JOBS_I18N } from "./web/i18n.ts";

export type JobsFeatureOptions = {
  // How long a job run (and its logs) stays in store_job_runs/
  // store_job_run_logs before the daily retention-cleanup job deletes it. Also the age after
  // which a tenant-visible "queued" row counts as lost and is dropped by the stale-run sweep.
  readonly retentionDays?: number;
  // How long a run can sit at status "running" before the hourly
  // stale-run-sweep job marks it "failed" — a process kill mid-run
  // never fires onJobComplete/onJobFailed, so nothing else ever revisits
  // it). Must clear any legitimately long-running job (reindexEntity,
  // projectionRebuild) — set high, not tight.
  readonly staleRunTimeoutHours?: number;
};

export function createJobsFeature(options: JobsFeatureOptions = {}): FeatureDefinition {
  const retentionDays = options.retentionDays ?? DEFAULT_JOB_RUN_RETENTION_DAYS;
  const staleRunTimeoutHours = options.staleRunTimeoutHours ?? DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS;
  return defineFeature("jobs", (r) => {
    r.describe(
      "Persistence and operator tooling for background jobs registered via `r.job(...)`. Every job execution writes directly into `store_job_runs` (current status + duration) and `store_job_run_logs` (per-line log rows) from the BullMQ callbacks — no event stream in between (#2243). A daily `retention-cleanup` job deletes runs (and their logs) older than `retentionDays`; an hourly `stale-run-sweep` job marks runs stuck at status `running` past `staleRunTimeoutHours` as `failed` (#2246 — a crashed worker never fires the completion callback, so nothing else ever revisits the row). Exposes `jobs:write:trigger` (manual run) and `jobs:write:retry` (operator retry of a failed run), plus `jobs:query:list`, `jobs:query:details`, and `jobs:query:catalog` (manual jobs) for the operator UI. A job that declares `tenantVisibleFailure` also records its last failed attempt per tenant and subject in `store_tenant_job_failures`, which the tenant itself reads through `jobs:query:failures` — a translation key only, never the provider's message (fw#3079). A job that declares `tenantVisibleRun` also keeps its run state per tenant and subject in `store_tenant_job_runs` (queued, running, plus the latest completed or failed run, no payload, error text or logs), which the tenant reads through `jobs:query:tenant-runs` (fw#3616); the stale-run sweep fails its stuck `running` rows and drops `queued` rows older than `retentionDays`.",
    );
    r.uiHints({
      displayLabel: "Jobs · Audit & Operator UI",
      category: "operations",
      recommended: false,
    });
    r.systemScope();
    r.storeTable(jobRunsTableMeta, {
      reason: "direct_write.job_runs",
      // payload/error carry personal:{of:"triggeredById"} (job-run-table.ts): encrypted under the
      // triggering user's DEK, or the system tenant key when triggeredById is null.
      // job-run-logger.ts manually encrypts both before every insert/update
      // (encryptStartedPayload/encryptFailureError) since this store bypasses
      // the executor's automatic PII pipeline.
      piiEncryptedOnWrite: true,
    });
    r.storeTable(jobRunLogsTableMeta, {
      reason: "read_side.job_run_logs",
    });
    r.storeTable(tenantJobFailuresTableMeta, {
      reason: "direct_write.tenant_job_failures",
    });
    r.storeTable(tenantJobRunsTableMeta, {
      reason: "direct_write.tenant_job_runs",
    });

    // Framework-provided rebuild job — available whenever `jobs` is composed; enqueueProjectionRebuild dispatches it.
    r.job(
      "projectionRebuild",
      { trigger: { manual: true }, concurrency: "skip", schema: projectionRebuildPayloadSchema },
      projectionRebuildJob,
    );

    // Retroactive search backfill — manual + perTenant, so one
    // `jobs:write:trigger` call with { entity } fans out to every active
    // tenant (job-runner.ts perTenant dispatch applies to manual triggers
    // too, not just cron).
    r.job(
      "reindexEntity",
      {
        trigger: { manual: true },
        perTenant: true,
        concurrency: "skip",
        schema: reindexEntityPayloadSchema,
      },
      reindexEntityJob,
    );

    // store_job_runs/store_job_run_logs are direct-write, unbounded-growth
    // stores — nothing else purges them.
    r.job(
      "retention-cleanup",
      { trigger: { cron: "0 3 * * *" }, concurrency: "skip" },
      createRetentionCleanupJob(retentionDays),
    );

    // Sweeps store_job_runs for rows stuck at status "running" past the
    // timeout. Hourly matches the timeout's own granularity —
    // frequent enough to catch a stuck run soon after it crosses the
    // threshold, cheap enough that an (almost always empty) result set
    // doesn't matter.
    r.job(
      "stale-run-sweep",
      { trigger: { cron: "0 * * * *" }, concurrency: "skip" },
      createStaleRunSweepJob(staleRunTimeoutHours, retentionDays),
    );

    const handlers = {
      trigger: r.writeHandler(triggerWrite),
      retry: r.writeHandler(retryWrite),
      consumerRestart: r.writeHandler(consumerRestartWrite),
      consumerSkip: r.writeHandler(consumerSkipWrite),
      consumerDisable: r.writeHandler(consumerDisableWrite),
      consumerEnable: r.writeHandler(consumerEnableWrite),
    };

    const queries = {
      list: r.queryHandler(listQuery),
      detail: r.queryHandler(detailQuery),
      catalog: r.queryHandler(catalogQuery),
      failures: r.queryHandler(tenantFailuresQuery),
      tenantRuns: r.queryHandler(tenantRunsQuery),
      consumers: r.queryHandler(consumersQuery),
      consumerDetails: r.queryHandler(consumerDetailQuery),
    };

    r.translations({ keys: JOBS_I18N });

    r.screen(jobRunsScreen);
    r.screen(jobTriggerScreen);
    r.screen(jobRunDetailScreen);
    r.nav({
      id: "job-runs",
      label: "jobs:nav.jobRuns",
      icon: "list",
      screen: "jobs:screen:job-runs",
      order: 10,
    });

    r.screen(eventConsumersScreen);
    r.screen(eventConsumerDetailScreen);
    r.nav({
      id: "event-consumers",
      label: "jobs:nav.eventConsumers",
      icon: "list",
      screen: "jobs:screen:event-consumers",
      order: 11,
    });

    return { handlers, queries };
  });
}
