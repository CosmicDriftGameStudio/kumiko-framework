// @runtime client
// Server + client i18n for user-data-rights (operator screens + nav). Pure
// data, importable from the web bundle (web/i18n.ts derives the client keys).
type LocalizedString = { readonly en: string };

export const USER_DATA_RIGHTS_I18N: Readonly<Record<string, LocalizedString>> = {
  "user-data-rights:nav.exportJobs": { en: "GDPR exports" },
  "screen:export-job-list.title": { en: "GDPR exports" },
  "screen:export-job-detail.title": { en: "Export job" },
  "screen:download-attempt-list.title": { en: "Download attempts" },
  "screen:privacy-center.title": { en: "Privacy" },
  "user-data-rights:entity:export-job:field:userId": { en: "User" },
  "user-data-rights:entity:export-job:field:status": { en: "Status" },
  "user-data-rights:entity:export-job:field:requestedAt": { en: "Requested" },
  "user-data-rights:entity:export-job:field:completedAt": { en: "Completed" },
  "user-data-rights:entity:export-job:field:expiresAt": { en: "Expires" },
  "user-data-rights:entity:export-job:field:requestedFromTenantId": {
    en: "Tenant",
  },
  "user-data-rights:entity:export-job:field:startedAt": { en: "Started" },
  "user-data-rights:entity:export-job:field:downloadStorageKey": {
    en: "Storage key",
  },
  "user-data-rights:entity:export-job:field:bytesWritten": { en: "Bytes" },
  "user-data-rights:entity:export-job:field:errorMessage": { en: "Error" },
  "user-data-rights:entity:download-attempt:field:attemptedAt": {
    en: "Attempted at",
  },
  "user-data-rights:entity:download-attempt:field:result": { en: "Result" },
  "user-data-rights:entity:download-attempt:field:via": { en: "Via" },
  "user-data-rights:entity:download-attempt:field:ip": { en: "IP" },
  "user-data-rights:entity:download-attempt:field:attemptedByUserId": {
    en: "User",
  },
  "user-data-rights:entity:download-attempt:field:jobId": { en: "Job" },
};
