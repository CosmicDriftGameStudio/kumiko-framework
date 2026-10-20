import {
  defineFeature,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
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
import { tenantJobFailuresTableMeta } from "./tenant-job-failure-table.ts";
import { tenantJobRunsTableMeta } from "./tenant-job-run-table.ts";
import {
  CONSUMER_INSTANCE_OPTION_KEY_PREFIX,
  CONSUMER_STATUS_OPTION_KEY_PREFIX,
  CONSUMER_STATUSES,
  EVENT_CONSUMER_DETAIL_SCREEN_ID,
  EVENT_CONSUMERS_SCREEN_ID,
  JOB_RUN_DETAIL_SCREEN_ID,
  JOB_RUNS_SCREEN_ID,
  JobHandlers,
  JobQueries,
} from "./web/constants.ts";
import { JOBS_I18N } from "./web/i18n.ts";

export type JobsFeatureOptions = {
  // How long a job run (and its logs) stays in store_job_runs/
  // store_job_run_logs before the daily retention-cleanup job deletes it. Also the age after
  // which a tenant-visible "queued" row counts as lost and is dropped by the stale-run sweep.
  readonly retentionDays?: number;
  // How long a run can sit at status "running" before the hourly
  // stale-run-sweep job marks it "failed" (#2246 — a process kill mid-run
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
      // triggering user's DEK, or the system tenant key when triggeredById is null
      // (whenAbsent: "tenant", fw#3654).
      // job-run-logger.ts manually encrypts both before every insert/update
      // (encryptStartedPayload/encryptFailureError) since this store bypasses
      // the executor's automatic PII pipeline (#2243).
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

    // Retroactive search backfill (#1206/#1215) — manual + perTenant, so one
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
    // stores (#2243) — nothing else purges them.
    r.job(
      "retention-cleanup",
      { trigger: { cron: "0 3 * * *" }, concurrency: "skip" },
      createRetentionCleanupJob(retentionDays),
    );

    // Sweeps store_job_runs for rows stuck at status "running" past the
    // timeout (#2246). Hourly matches the timeout's own granularity —
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

    const systemAdminAccess = { roles: ["SystemAdmin"] as const };

    r.translations({ keys: JOBS_I18N });

    r.screen({
      id: JOB_RUNS_SCREEN_ID,
      type: "projectionList",
      query: JobQueries.list,
      columns: [
        { field: "jobName", label: i18nKey("jobs.runs.col.job") },
        { field: "status", label: i18nKey("jobs.runs.col.status") },
        {
          field: "startedAt",
          label: i18nKey("jobs.runs.col.started"),
          renderer: { format: "timestamp" },
        },
        { field: "duration", label: i18nKey("jobs.runs.col.duration") },
      ],
      defaultSort: { field: "startedAt", dir: "desc" },
      facets: [
        {
          field: "status",
          type: "select",
          label: i18nKey("jobs.runs.filter.status"),
          options: [
            { value: "queued", label: i18nKey("jobs.runs.filter.queued") },
            { value: "running", label: i18nKey("jobs.runs.filter.running") },
            { value: "completed", label: i18nKey("jobs.runs.filter.completed") },
            { value: "failed", label: i18nKey("jobs.runs.filter.failed") },
          ],
        },
      ],
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: i18nKey("jobs.runs.open"),
          screen: JOB_RUN_DETAIL_SCREEN_ID,
          entityId: "id",
          rowClick: true,
        },
      ],
      toolbarActions: [
        {
          kind: "drawer",
          id: "trigger",
          label: i18nKey("jobs.trigger.title"),
          screen: "job-trigger",
          style: "primary",
        },
      ],
      pagination: "infinite",
      access: systemAdminAccess,
    });
    r.screen({
      id: "job-trigger",
      type: "actionForm",
      handler: JobHandlers.trigger,
      fields: {
        jobName: { type: "text", required: true },
        payload: { type: "longText", multiline: true, default: "{}" },
      },
      layout: { sections: [{ fields: ["jobName", "payload"] }] },
      submitLabel: i18nKey("jobs.trigger.submit"),
      access: systemAdminAccess,
      description: "jobs.screen.job-trigger.subtitle",
    });
    r.screen({
      id: JOB_RUN_DETAIL_SCREEN_ID,
      type: "projectionDetail",
      query: JobQueries.details,
      idParam: "runId",
      fieldLabels: {
        jobName: i18nKey("jobs.detail.field.job"),
        status: i18nKey("jobs.detail.field.status"),
        id: i18nKey("jobs.detail.field.id"),
        startedAt: i18nKey("jobs.detail.field.started"),
        finishedAt: i18nKey("jobs.detail.field.finished"),
        duration: i18nKey("jobs.detail.field.duration"),
        error: i18nKey("jobs.detail.field.error"),
        logs: i18nKey("jobs.detail.logs"),
      },
      layout: {
        sections: [
          {
            fields: [
              "jobName",
              "status",
              "id",
              { field: "startedAt", renderer: { format: "timestamp" } },
              { field: "finishedAt", renderer: { format: "timestamp" } },
              "duration",
              "error",
            ],
          },
          // No section `title` here (fw#2312 label-dedup fix): the section
          // holds exactly one field, so a title would repeat the field's own
          // label (rendered by RenderField as the Field's heading) verbatim.
          {
            fields: [{ field: "logs", renderer: { format: "json" } }],
          },
        ],
      },
      actions: [
        {
          kind: "writeHandler",
          id: "retry",
          label: i18nKey("jobs.detail.retry"),
          handler: JobHandlers.retry,
          payload: { map: { runId: "id" } },
          visible: { field: "status", eq: "failed" },
          style: "primary",
        },
      ],
      description: "jobs.screen.job-run-detail.subtitle",
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

    r.screen({
      id: EVENT_CONSUMERS_SCREEN_ID,
      type: "projectionList",
      query: JobQueries.consumers,
      columns: [
        { field: "name", label: i18nKey("jobs.consumers.col.name") },
        {
          field: "status",
          label: i18nKey("jobs.consumers.col.status"),
          renderer: { format: "enumOption", keyPrefix: CONSUMER_STATUS_OPTION_KEY_PREFIX },
        },
        { field: "lag", label: i18nKey("jobs.consumers.col.lag"), hideOnNarrow: true },
        { field: "attempts", label: i18nKey("jobs.consumers.col.attempts"), hideOnNarrow: true },
        { field: "lastError", label: i18nKey("jobs.consumers.col.lastError") },
      ],
      defaultSort: { field: "status", dir: "asc" },
      facets: [
        {
          field: "status",
          type: "select",
          label: i18nKey("jobs.consumers.col.status"),
          options: CONSUMER_STATUSES.map((status) => ({
            value: status,
            label: i18nKey(`${CONSUMER_STATUS_OPTION_KEY_PREFIX}${status}`),
          })),
        },
      ],
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: i18nKey("jobs.runs.open"),
          screen: EVENT_CONSUMER_DETAIL_SCREEN_ID,
          entityId: "id",
          rowClick: true,
        },
      ],
      pagination: "infinite",
      access: systemAdminAccess,
      description: "jobs.screen.event-consumers.subtitle",
    });
    r.screen({
      id: EVENT_CONSUMER_DETAIL_SCREEN_ID,
      type: "projectionDetail",
      query: JobQueries.consumerDetails,
      idParam: "consumerId",
      fieldLabels: {
        name: i18nKey("jobs.consumers.col.name"),
        instanceId: i18nKey("jobs.consumers.field.instanceId"),
        status: i18nKey("jobs.consumers.col.status"),
        lag: i18nKey("jobs.consumers.col.lag"),
        attempts: i18nKey("jobs.consumers.col.attempts"),
        lastError: i18nKey("jobs.consumers.col.lastError"),
        updatedAt: i18nKey("jobs.consumers.field.updatedAt"),
      },
      layout: {
        sections: [
          {
            fields: [
              "name",
              {
                field: "instanceId",
                renderer: { format: "enumOption", keyPrefix: CONSUMER_INSTANCE_OPTION_KEY_PREFIX },
              },
              {
                field: "status",
                renderer: { format: "enumOption", keyPrefix: CONSUMER_STATUS_OPTION_KEY_PREFIX },
              },
              "lag",
              "attempts",
              { field: "updatedAt", renderer: { format: "timestamp" } },
            ],
          },
          { fields: ["lastError"] },
        ],
      },
      actions: [
        {
          kind: "writeHandler",
          id: "restart",
          icon: "refresh",
          label: i18nKey("jobs.consumers.restart"),
          handler: JobHandlers.consumerRestart,
          payload: { map: { name: "name", instanceId: "instanceId" } },
          visible: { field: "status", eq: "dead" },
          style: "primary",
        },
        {
          kind: "writeHandler",
          id: "skip",
          icon: "arrow-right",
          label: i18nKey("jobs.consumers.skip"),
          handler: JobHandlers.consumerSkip,
          payload: { map: { name: "name", instanceId: "instanceId" } },
          visible: { field: "status", eq: "dead" },
          confirm: i18nKey("jobs.consumers.skip.confirm"),
          style: "danger",
        },
        {
          kind: "writeHandler",
          id: "disable",
          icon: "x",
          label: i18nKey("jobs.consumers.disable"),
          handler: JobHandlers.consumerDisable,
          payload: { map: { name: "name", instanceId: "instanceId" } },
          visible: { field: "status", ne: "disabled" },
          style: "secondary",
        },
        {
          kind: "writeHandler",
          id: "enable",
          icon: "check",
          label: i18nKey("jobs.consumers.enable"),
          handler: JobHandlers.consumerEnable,
          payload: { map: { name: "name", instanceId: "instanceId" } },
          visible: { field: "status", eq: "disabled" },
          style: "primary",
        },
      ],
      primaryAction: "restart",
      description: "jobs.screen.event-consumer-detail.subtitle",
      listScreenId: EVENT_CONSUMERS_SCREEN_ID,
      access: systemAdminAccess,
    });
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
