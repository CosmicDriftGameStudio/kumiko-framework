// Lifecycle-Konstanten fuer den Async-Export-Pipeline (S2.U3+U4).
//
// Spec: docs/plans/architecture/user-data-rights.md "Async Export-
// Pipeline → Konstanten". Hardcoded MVP — Migration zu compliance-
// profile.userRights.exportDownloadTtl ist explizit dokumentiert wenn
// ein realer Tenant das per-Tenant konfigurieren will. Memory
// `feedback_no_later`: keine "TODO im Code"-Variante, lieber zentrale
// Konstanten die in einem zukuenftigen Sprint ersetzt werden.
//
// Beim Aendern hier MUSS der Test-Drift-Guard
// `__tests__/export-job-schema.test.ts` mit angepasst werden — sonst
// fallen Worker-Tests die `expiresAt`-Berechnungen pruefen falsch
// silent durch.

/** Wie lange ist der Download-Link nach Job=done abrufbar. */
export const EXPORT_DOWNLOAD_TTL_DAYS = 7;

/** Wenn ein Job laenger als das in `running` haengt, gilt er als stale
 *  (Worker-Crash mid-execution) und wird vom naechsten Worker-Pass auf
 *  `failed` gesetzt damit der User einen neuen Antrag stellen kann. */
export const EXPORT_STALE_TIMEOUT_MINUTES = 30;

/** Pufferzone nach `expiresAt` bevor der Worker den ZIP-Storage-Key
 *  loescht. Schuetzt vor Edge-Case wo ein User in den letzten Sekunden
 *  des TTL den Download laedt + der Cleanup-Pass parallel loescht. */
export const EXPORT_STORAGE_CLEANUP_GRACE_HOURS = 24;
