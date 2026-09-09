// @runtime client
// Server + client i18n for jobs operator screens.

type LocalizedString = { readonly en: string };

export const JOBS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:job-runs.title": { en: "Job runs" },
  "screen:job-run-detail.title": { en: "Job run" },
  "screen:job-trigger.title": { en: "Trigger job" },
  "jobs:entity:__action-form__:field:jobName": { en: "Job name" },
  "jobs:entity:__action-form__:field:payload": { en: "JSON payload" },
  "jobs:nav.jobRuns": { en: "Jobs" },
  "jobs.runs.open": { en: "Details" },
  "jobs.runs.filter.status": { en: "Status" },
  "jobs.runs.filter.completed": { en: "Completed" },
  "jobs.runs.filter.failed": { en: "Failed" },
  "jobs.runs.filter.running": { en: "Running" },
  "jobs.runs.filter.queued": { en: "Queued" },
  "jobs.runs.col.job": { en: "Job" },
  "jobs.runs.col.status": { en: "Status" },
  "jobs.runs.col.started": { en: "Started" },
  "jobs.runs.col.duration": { en: "Duration (ms)" },
  "jobs.detail.field.job": { en: "Job" },
  "jobs.detail.field.status": { en: "Status" },
  "jobs.detail.field.id": { en: "Run ID" },
  "jobs.detail.field.started": { en: "Started" },
  "jobs.detail.field.finished": { en: "Finished" },
  "jobs.detail.field.duration": { en: "Duration (ms)" },
  "jobs.detail.field.error": { en: "Error" },
  "jobs.detail.logs": { en: "Logs" },
  "jobs.detail.retry": { en: "Retry" },
  "jobs.trigger.title": { en: "Run a job" },
  "jobs.trigger.submit": { en: "Run" },
  "jobs.errors.unknownJob": { en: "Unknown job." },
  "jobs.errors.notManual": {
    en: "This job cannot be triggered manually.",
  },
  "jobs.errors.notFound": { en: "Not found." },
  "jobs.errors.onlyFailedCanRetry": {
    en: "Only failed runs can be retried.",
  },
  "jobs.errors.payloadErased": {
    en: "This run's payload can no longer be read — the triggering user's data was erased.",
  },
};
