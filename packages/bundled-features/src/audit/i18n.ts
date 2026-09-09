// @runtime client
// Server + client i18n for audit (nav labels + audit-log/-detail screens).

type LocalizedString = { readonly en: string };

export const AUDIT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:audit-log.title": { en: "Audit log" },
  "screen:audit-log-detail.title": { en: "Event" },
  "audit:nav.auditLog": { en: "Audit" },
  "audit.log.col.when": { en: "When" },
  "audit.log.col.type": { en: "Event" },
  "audit.log.col.aggregate": { en: "Aggregate" },
  "audit.log.col.actor": { en: "Actor" },
  "audit.log.details": { en: "Details" },
  "audit.log.detail.payload": { en: "Event payload" },
  "audit.log.detail.metadata": { en: "Metadata" },
  "audit.log.detail.field.id": { en: "Event ID" },
};
