import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { JOB_RUN_DETAIL_SCREEN_ID, JOB_RUNS_SCREEN_ID } from "./constants";
import { catalogQuery } from "./handlers/catalog.query";
import { detailQuery } from "./handlers/detail.query";
import { listQuery } from "./handlers/list.query";
import {
  projectionRebuildJob,
  projectionRebuildPayloadSchema,
} from "./handlers/projection-rebuild.job";
import { reindexEntityJob, reindexEntityPayloadSchema } from "./handlers/reindex-entity.job";
import {
  createRetentionCleanupJob,
  DEFAULT_JOB_RUN_RETENTION_DAYS,
} from "./handlers/retention-cleanup.job";
import { retryWrite } from "./handlers/retry.write";
import { triggerWrite } from "./handlers/trigger.write";
import { JOBS_I18N } from "./i18n";
import { jobRunLogsTableMeta, jobRunsTableMeta } from "./job-run-table";

export type JobsFeatureOptions = {
  // How long a job run (and its logs) stays in store_job_runs/
  // store_job_run_logs before the daily retention-cleanup job deletes it.
  readonly retentionDays?: number;
};

export function createJobsFeature(options: JobsFeatureOptions = {}): FeatureDefinition {
  const retentionDays = options.retentionDays ?? DEFAULT_JOB_RUN_RETENTION_DAYS;
  return defineFeature("jobs", (r) => {
    r.describe(
      "Persistence and operator tooling for background jobs registered via `r.job(...)`. Every job execution writes directly into `store_job_runs` (current status + duration) and `store_job_run_logs` (per-line log rows) from the BullMQ callbacks — no event stream in between (#2243). A daily `retention-cleanup` job deletes runs (and their logs) older than `retentionDays`. Exposes `jobs:write:trigger` (manual run) and `jobs:write:retry` (operator retry of a failed run), plus `jobs:query:list`, `jobs:query:details`, and `jobs:query:catalog` (manual jobs) for the operator UI.",
    );
    r.uiHints({
      displayLabel: "Jobs · Audit & Operator UI",
      category: "operations",
      recommended: false,
    });
    r.systemScope();
    r.storeTable(jobRunsTableMeta, {
      reason: "direct_write.job_runs",
    });
    r.storeTable(jobRunLogsTableMeta, {
      reason: "read_side.job_run_logs",
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

    // store_job_runs/store_job_run_logs are direct-write, unbounded-growth
    // stores (#2243) — nothing else purges them.
    r.job(
      "retention-cleanup",
      { trigger: { cron: "0 3 * * *" }, concurrency: "skip" },
      createRetentionCleanupJob(retentionDays),
    );

    const handlers = {
      trigger: r.writeHandler(triggerWrite),
      retry: r.writeHandler(retryWrite),
    };

    const queries = {
      list: r.queryHandler(listQuery),
      detail: r.queryHandler(detailQuery),
      catalog: r.queryHandler(catalogQuery),
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
