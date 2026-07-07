// @runtime client
// Server + client i18n for jobs operator screens.

type LocalizedString = { readonly de: string; readonly en: string };

export const JOBS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:job-runs.title": { de: "Job-Läufe", en: "Job runs" },
  "screen:job-run-detail.title": { de: "Job-Lauf", en: "Job run" },
  "jobs:nav.jobRuns": { de: "Jobs", en: "Jobs" },
  "jobs.runs.title": { de: "Job-Läufe", en: "Job runs" },
  "jobs.runs.loading": { de: "Lade Läufe…", en: "Loading runs…" },
  "jobs.runs.empty": { de: "Keine Job-Läufe.", en: "No job runs." },
  "jobs.runs.open": { de: "Details", en: "Details" },
  "jobs.runs.filter.status": { de: "Status", en: "Status" },
  "jobs.runs.filter.all": { de: "Alle", en: "All" },
  "jobs.runs.filter.completed": { de: "Abgeschlossen", en: "Completed" },
  "jobs.runs.filter.failed": { de: "Fehlgeschlagen", en: "Failed" },
  "jobs.runs.filter.running": { de: "Läuft", en: "Running" },
  "jobs.runs.filter.queued": { de: "Wartend", en: "Queued" },
  "jobs.runs.col.job": { de: "Job", en: "Job" },
  "jobs.runs.col.status": { de: "Status", en: "Status" },
  "jobs.runs.col.started": { de: "Gestartet", en: "Started" },
  "jobs.runs.col.duration": { de: "Dauer (ms)", en: "Duration (ms)" },
  "jobs.detail.title": { de: "Job-Lauf", en: "Job run" },
  "jobs.detail.loading": { de: "Lade Details…", en: "Loading details…" },
  "jobs.detail.missing": { de: "Lauf nicht gefunden.", en: "Run not found." },
  "jobs.detail.back": { de: "← Zurück zur Liste", en: "← Back to list" },
  "jobs.detail.field.job": { de: "Job", en: "Job" },
  "jobs.detail.field.status": { de: "Status", en: "Status" },
  "jobs.detail.field.id": { de: "Run-ID", en: "Run ID" },
  "jobs.detail.field.error": { de: "Fehler", en: "Error" },
  "jobs.detail.logs": { de: "Logs", en: "Logs" },
  "jobs.detail.logs.empty": { de: "Keine Log-Zeilen.", en: "No log lines." },
  "jobs.detail.retry": { de: "Erneut ausführen", en: "Retry" },
  "jobs.detail.retrying": { de: "Wird erneut gestartet…", en: "Retrying…" },
};
