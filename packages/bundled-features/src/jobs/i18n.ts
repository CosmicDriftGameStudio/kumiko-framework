// @runtime client
// Server + client i18n for jobs operator screens.

type LocalizedString = { readonly en: string };

export const JOBS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:job-runs.title": { en: "Job runs" },
  "screen:job-run-detail.title": { en: "Job run" },
  "jobs:nav.jobRuns": { en: "Jobs" },
  "jobs.runs.title": { en: "Job runs" },
  "jobs.runs.loading": { en: "Loading runs…" },
  "jobs.runs.empty": { en: "No job runs." },
  "jobs.runs.open": { en: "Details" },
  "jobs.runs.filter.status": { en: "Status" },
  "jobs.runs.filter.all": { en: "All" },
  "jobs.runs.filter.completed": { en: "Completed" },
  "jobs.runs.filter.failed": { en: "Failed" },
  "jobs.runs.filter.running": { en: "Running" },
  "jobs.runs.filter.queued": { en: "Queued" },
  "jobs.runs.col.job": { en: "Job" },
  "jobs.runs.col.status": { en: "Status" },
  "jobs.runs.col.started": { en: "Started" },
  "jobs.runs.col.duration": { en: "Duration (ms)" },
  "jobs.detail.loading": { en: "Loading details…" },
  "jobs.detail.missing": { en: "Run not found." },
  "jobs.detail.field.job": { en: "Job" },
  "jobs.detail.field.status": { en: "Status" },
  "jobs.detail.field.id": { en: "Run ID" },
  "jobs.detail.field.started": { en: "Started" },
  "jobs.detail.field.finished": { en: "Finished" },
  "jobs.detail.field.duration": { en: "Duration (ms)" },
  "jobs.detail.field.error": { en: "Error" },
  "jobs.detail.logs": { en: "Logs" },
  "jobs.detail.logs.empty": { en: "No log lines." },
  "jobs.detail.retry": { en: "Retry" },
  "jobs.detail.retrying": { en: "Retrying…" },
  "jobs.trigger.title": { en: "Run a job" },
  "jobs.trigger.explainer": {
    en: "Only manually triggerable jobs. After starting, the run appears in the history below.",
  },
  "jobs.trigger.job": { en: "Job" },
  "jobs.trigger.payload": { en: "Payload (JSON)" },
  "jobs.trigger.payload.hint": { en: "Schema hint" },
  "jobs.trigger.payload.invalidJson": {
    en: "Payload is not a valid JSON object.",
  },
  "jobs.trigger.submit": { en: "Run" },
  "jobs.trigger.submitting": { en: "Starting…" },
  "jobs.trigger.success": { en: "Job started." },
  "jobs.trigger.empty": {
    en: "No manually triggerable jobs are registered.",
  },
  "jobs.trigger.perTenant": {
    en: "Runs once per active tenant.",
  },
  "jobs.errors.unknownJob": { en: "Unknown job." },
  "jobs.errors.notManual": {
    en: "This job cannot be triggered manually.",
  },
  "jobs.errors.notFound": { en: "Not found." },
  "jobs.errors.onlyFailedCanRetry": {
    en: "Only failed runs can be retried.",
  },
};
