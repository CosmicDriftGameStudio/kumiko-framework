// @runtime client
// Server + client i18n for audit (nav labels + audit-log/-detail screens).

type LocalizedString = { readonly en: string };

export const AUDIT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:audit-log.title": { en: "Audit log" },
  "screen:audit-log-detail.title": { en: "Event" },
  "audit.log.detail.subtitle": {
    en: "Read-only detail view of one audit event showing actor, timestamp, aggregate and the raw event payload and metadata; reached from a row of the audit log.",
  },
  "audit:nav.auditLog": { en: "Audit" },
  "audit.log.col.when": { en: "When" },
  "audit.log.col.type": { en: "Event" },
  "audit.log.col.aggregateType": { en: "Aggregate type" },
  "audit.log.col.aggregateId": { en: "Aggregate ID" },
  "audit.log.col.actor": { en: "Actor" },
  "audit.log.details": { en: "Details" },
  "audit.log.detail.payload": { en: "Event payload" },
  "audit.log.detail.metadata": { en: "Metadata" },
  "audit.log.detail.field.id": { en: "Event ID" },
};
