// Server + client i18n for jobs operator screens.

type LocalizedString = { readonly en: string };

export const JOBS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:job-runs.title": { en: "Job runs" },
  "screen:job-run-detail.title": { en: "Job run" },
  "screen:job-trigger.title": { en: "Trigger job" },
  "jobs.screen.job-trigger.subtitle": {
    en: "Start a job manually by name, with an optional JSON payload.",
  },
  "jobs.screen.job-run-detail.subtitle": {
    en: "Status, timings, error and log lines of one job run.",
  },
  "jobs:entity:__action-form__:field:jobName": { en: "Job name" },
  "jobs:entity:__action-form__:field:payload": { en: "JSON payload" },
  "jobs:nav.jobRuns": { en: "Jobs" },
  "screen:event-consumers.title": { en: "Event consumers" },
  "screen:event-consumer-detail.title": { en: "Event consumer" },
  "jobs:nav.eventConsumers": { en: "Event consumers" },
  "jobs.screen.event-consumers.subtitle": {
    en: "Background readers that process events after they are saved; find stuck ones and get them moving again.",
  },
  "jobs.screen.event-consumer-detail.subtitle": {
    en: "State and last error of one event consumer, with the actions to restart, skip or pause it.",
  },
  "jobs.consumers.col.name": { en: "Consumer" },
  "jobs.consumers.col.status": { en: "Status" },
  "jobs.consumers.col.lag": { en: "Events behind" },
  "jobs.consumers.col.attempts": { en: "Attempts" },
  "jobs.consumers.col.lastError": { en: "Last error" },
  "jobs.consumers.field.instanceId": { en: "Instance" },
  "jobs.consumers.field.updatedAt": { en: "Last change" },
  "jobs.consumers.status.idle": { en: "Up to date" },
  "jobs.consumers.status.processing": { en: "Running" },
  "jobs.consumers.status.dead": { en: "Stopped by error" },
  "jobs.consumers.status.disabled": { en: "Paused" },
  "jobs.consumers.status.never-run": { en: "Not started yet" },
  "jobs.consumers.instance.__shared__": { en: "Shared" },
  "jobs.consumers.restart": { en: "Restart" },
  "jobs.consumers.skip": { en: "Skip event" },
  "jobs.consumers.skip.confirm": {
    en: "The event that keeps failing is skipped and never delivered to this consumer, so its data may stay incomplete. Skip only if the event can never succeed.",
  },
  "jobs.consumers.disable": { en: "Pause" },
  "jobs.consumers.enable": { en: "Resume" },
  "jobs.errors.consumerUnknown": {
    en: "This consumer has not run yet or does not exist.",
  },
  "jobs.errors.consumerWrongStatus": {
    en: "The consumer is not in a state where this action applies. Reload and check its status.",
  },
  "jobs.errors.consumerNothingToSkip": {
    en: "There is no failing event to skip.",
  },
  "jobs.errors.consumerTransitionFailed": {
    en: "The consumer could not be changed. Try again; if it keeps failing, check the server log.",
  },
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
  "jobs.errors.invalidCursor": { en: "The pagination cursor is invalid." },
  "jobs.trigger.submit": { en: "Run" },
  "jobs.errors.unknownJob": { en: "Unknown job." },
  "jobs.errors.notManual": {
    en: "This job cannot be triggered manually.",
  },
  "jobs.errors.invalidPayload": {
    en: "The payload must be a valid JSON object.",
  },
  "jobs.errors.notFound": { en: "Not found." },
  "jobs.errors.onlyFailedCanRetry": {
    en: "Only failed runs can be retried.",
  },
  "jobs.errors.payloadErased": {
    en: "This run's payload can no longer be read — the triggering user's data was erased.",
  },
};
