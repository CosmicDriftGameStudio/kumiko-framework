// @runtime client
// Server + client i18n for user-data-rights (operator screens + nav). Pure
// data, importable from the web bundle (web/i18n.ts derives the client keys).
type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const USER_DATA_RIGHTS_I18N: Readonly<Record<string, LocalizedString>> = {
  "user-data-rights:nav.exportJobs": {
    de: "DSGVO-Exporte",
    en: "GDPR exports",
    es: "Exportaciones RGPD",
  },
  "screen:export-job-list.title": {
    de: "DSGVO-Exporte",
    en: "GDPR exports",
    es: "Exportaciones RGPD",
  },
  "screen:export-job-detail.title": {
    de: "Export-Job",
    en: "Export job",
    es: "Trabajo de exportación",
  },
  "screen:download-attempt-list.title": {
    de: "Download-Versuche",
    en: "Download attempts",
    es: "Intentos de descarga",
  },
  "screen:privacy-center.title": { de: "Datenschutz", en: "Privacy", es: "Privacidad" },
  "user-data-rights:entity:export-job:field:userId": { de: "Benutzer", en: "User", es: "Usuario" },
  "user-data-rights:entity:export-job:field:status": { de: "Status", en: "Status", es: "Estado" },
  "user-data-rights:entity:export-job:field:requestedAt": {
    de: "Angefordert",
    en: "Requested",
    es: "Solicitado",
  },
  "user-data-rights:entity:export-job:field:completedAt": {
    de: "Abgeschlossen",
    en: "Completed",
    es: "Completado",
  },
  "user-data-rights:entity:export-job:field:expiresAt": {
    de: "Läuft ab",
    en: "Expires",
    es: "Caduca",
  },
  "user-data-rights:entity:export-job:field:requestedFromTenantId": {
    de: "Mandant",
    en: "Tenant",
    es: "Organización",
  },
  "user-data-rights:entity:export-job:field:startedAt": {
    de: "Gestartet",
    en: "Started",
    es: "Iniciado",
  },
  "user-data-rights:entity:export-job:field:downloadStorageKey": {
    de: "Speicher-Schlüssel",
    en: "Storage key",
    es: "Clave de almacenamiento",
  },
  "user-data-rights:entity:export-job:field:bytesWritten": {
    de: "Bytes",
    en: "Bytes",
    es: "Bytes",
  },
  "user-data-rights:entity:export-job:field:errorMessage": {
    de: "Fehler",
    en: "Error",
    es: "Error",
  },
  "user-data-rights:entity:download-attempt:field:attemptedAt": {
    de: "Zeitpunkt",
    en: "Attempted at",
    es: "Fecha y hora",
  },
  "user-data-rights:entity:download-attempt:field:result": {
    de: "Ergebnis",
    en: "Result",
    es: "Resultado",
  },
  "user-data-rights:entity:download-attempt:field:via": { de: "Via", en: "Via", es: "Vía" },
  "user-data-rights:entity:download-attempt:field:ip": { de: "IP", en: "IP", es: "IP" },
  "user-data-rights:entity:download-attempt:field:attemptedByUserId": {
    de: "Benutzer",
    en: "User",
    es: "Usuario",
  },
  "user-data-rights:entity:download-attempt:field:jobId": { de: "Job", en: "Job", es: "Trabajo" },
};
