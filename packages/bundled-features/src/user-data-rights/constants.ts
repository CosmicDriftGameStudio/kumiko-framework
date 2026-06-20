// @runtime client
// Reine String-Konstanten — client-markiert, damit der PrivacyCenterScreen
// (web/) sie importieren darf, ohne das runtime-Barrel des Features (und
// damit dessen Server-/DOM-freien Code) zu ziehen. Runtime-Code
// (feature.ts) darf client-Dateien ohnehin importieren.

export const USER_DATA_RIGHTS_FEATURE = "user-data-rights" as const;

// Dormant registriert (kein r.nav im Feature); Apps platzieren ihn via
// r.nav. Qualifiziert: `user-data-rights:screen:privacy-center`.
export const PRIVACY_CENTER_SCREEN_ID = "privacy-center" as const;

export const UserDataRightsQueries = {
  exportStatus: "user-data-rights:query:export-status",
  myAuditLog: "user-data-rights:query:my-audit-log",
} as const;

export const UserDataRightsHandlers = {
  requestExport: "user-data-rights:write:request-export",
  requestDeletion: "user-data-rights:write:request-deletion",
  cancelDeletion: "user-data-rights:write:cancel-deletion",
  restrictAccount: "user-data-rights:write:restrict-account",
} as const;

// Fremde QN: der Lifecycle-Status (active / deletionRequested / restricted)
// kommt aus dem user-Feature. Lokal gepinnt statt das user-runtime-Barrel zu
// importieren (Runtime-Isolation, wie user-profile). Drift-Schutz: der
// Screen-Test vergleicht gegen UserQueries.me.
export const USER_ME_QUERY = "user:query:user:me" as const;

// Download-Pfad des fertigen Export-Bundles: der dokumentierte UI-Klick-Pfad
// (r.httpRoute in feature.ts), der per 302 auf die signed Storage-URL
// weiterleitet. Anchor-navigierbar (Cookie-Auth wird mitgesendet).
export function userExportByJobPath(jobId: string): string {
  return `/user-export/by-job/${jobId}`;
}

// Client-safe Mirror von EXPORT_JOB_STATUS (schema/export-job.ts ist
// server-only via Drizzle-Import). Drift-Schutz: der Screen-Test vergleicht
// gegen die Schema-Originale.
export const EXPORT_JOB_STATUS = {
  Pending: "pending",
  Running: "running",
  Done: "done",
  Failed: "failed",
} as const;

export type ExportJobStatus = (typeof EXPORT_JOB_STATUS)[keyof typeof EXPORT_JOB_STATUS];
