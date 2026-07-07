type LocalizedString = { readonly de: string; readonly en: string };

export const USER_DATA_RIGHTS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:export-job-list.title": { de: "DSGVO-Exporte", en: "GDPR exports" },
  "screen:export-job-detail.title": { de: "Export-Job", en: "Export job" },
  "screen:download-attempt-list.title": { de: "Download-Versuche", en: "Download attempts" },
  "screen:privacy-center.title": { de: "Datenschutz", en: "Privacy" },
  "user-data-rights:entity:export-job:field:userId": { de: "Benutzer", en: "User" },
  "user-data-rights:entity:export-job:field:status": { de: "Status", en: "Status" },
  "user-data-rights:entity:export-job:field:requestedAt": { de: "Angefordert", en: "Requested" },
  "user-data-rights:entity:export-job:field:completedAt": { de: "Abgeschlossen", en: "Completed" },
  "user-data-rights:entity:export-job:field:expiresAt": { de: "Läuft ab", en: "Expires" },
  "user-data-rights:entity:export-job:field:requestedFromTenantId": {
    de: "Mandant",
    en: "Tenant",
  },
  "user-data-rights:entity:export-job:field:startedAt": { de: "Gestartet", en: "Started" },
  "user-data-rights:entity:export-job:field:downloadStorageKey": {
    de: "Speicher-Schlüssel",
    en: "Storage key",
  },
  "user-data-rights:entity:export-job:field:bytesWritten": { de: "Bytes", en: "Bytes" },
  "user-data-rights:entity:export-job:field:errorMessage": { de: "Fehler", en: "Error" },
  "user-data-rights:entity:download-attempt:field:attemptedAt": {
    de: "Zeitpunkt",
    en: "Attempted at",
  },
  "user-data-rights:entity:download-attempt:field:result": { de: "Ergebnis", en: "Result" },
  "user-data-rights:entity:download-attempt:field:via": { de: "Via", en: "Via" },
  "user-data-rights:entity:download-attempt:field:ip": { de: "IP", en: "IP" },
  "user-data-rights:entity:download-attempt:field:attemptedByUserId": {
    de: "Benutzer",
    en: "User",
  },
  "user-data-rights:entity:download-attempt:field:jobId": { de: "Job", en: "Job" },
};
