type LocalizedString = { readonly en: string };

export const READINESS_I18N: Readonly<Record<string, LocalizedString>> = {
  "readiness.area.infrastructure": { en: "Infrastructure" },
  "readiness.area.run": { en: "System check" },
  "readiness.probe.run": { en: "Run of the system check" },
  "readiness.probe.database.label": { en: "Database" },
  "readiness.probe.database.ok": { en: "Database reachable" },
  "readiness.probe.cache.label": { en: "Cache" },
  "readiness.probe.cache.ok": { en: "Cache reachable" },
  "readiness.probe.search.label": { en: "Search" },
  "readiness.probe.search.ok": { en: "Search reachable" },
  "readiness.probe.paid-not-requested": { en: "Not run, paid checks were not requested" },
  "readiness.probe.no-targets": { en: "Nothing to check" },
  "readiness.probe.timeout": { en: "No answer after {seconds} seconds" },
  "readiness.probe.failed": { en: "The check failed" },
  "readiness.probe.run-crashed": { en: "The check run stopped unexpectedly" },
  "readiness.probe.not-configured": { en: "Not set up" },
  "readiness.summary.ok-of-total": { en: "{ok} of {total} checks passed" },
  "readiness.summary.running": { en: "The check is running" },
};
