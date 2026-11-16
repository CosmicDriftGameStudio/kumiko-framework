// Feature name
export const READINESS_FEATURE = "readiness" as const;

// Qualified query handler names (QN format: scope:type:name)
export const ReadinessQueries = {
  status: "readiness:query:status",
  latestResults: "readiness:query:probe-run:latest-results",
  latestSummary: "readiness:query:probe-run:latest-summary",
  runList: "readiness:query:probe-run:list",
  runDetail: "readiness:query:probe-run:detail",
  runResults: "readiness:query:probe-run:results",
} as const;

export const ReadinessWrites = {
  runProbes: "readiness:write:run-probes",
} as const;

export const RUN_OUTCOME = { ok: "ok", failed: "failed", running: "running" } as const;

export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

// Targets of one probe (mailboxes, connections) run in waves so a tenant with many does not open them all at once.
export const PROBE_TARGET_CONCURRENCY = 4;
// secrets.has is one row lookup each; keeps the status query from taking the whole db pool.
export const SECRET_PRESENCE_CONCURRENCY = 4;

// An active run older than this is treated as dead (worker crash) and may be replaced.
export const MIN_STALE_RUN_AFTER_MS = 10 * 60_000;
export const STALE_RUN_TIMEOUT_FACTOR = 3;

// Translation keys of the runner's own result texts.
export const ProbeTextKeys = {
  paidNotRequested: "readiness.probe.paid-not-requested",
  noTargets: "readiness.probe.no-targets",
  timeout: "readiness.probe.timeout",
  failed: "readiness.probe.failed",
  runCrashed: "readiness.probe.run-crashed",
  notConfigured: "readiness.probe.not-configured",
} as const;
