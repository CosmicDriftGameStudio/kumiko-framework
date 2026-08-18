// @runtime client
// Server + client i18n for audit (nav labels + AuditLogScreen).

type LocalizedString = { readonly en: string };

export const AUDIT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:audit-log.title": { en: "Audit log" },
  "screen:audit-log-detail.title": { en: "Event" },
  "audit:nav.auditLog": { en: "Audit" },
  "audit.log.title": { en: "Audit log" },
  "audit.log.loading": { en: "Loading events…" },
  "audit.log.empty": { en: "No events." },
  "audit.log.newest": { en: "Newest" },
  "audit.log.older": { en: "Load older" },
  "audit.log.col.when": { en: "When" },
  "audit.log.col.type": { en: "Event" },
  "audit.log.col.aggregate": { en: "Aggregate" },
  "audit.log.col.actor": { en: "Actor" },
  "audit.log.filter.eventType": { en: "Event type" },
  "audit.log.filter.aggregateType": { en: "Aggregate type" },
  "audit.log.filter.from": { en: "From" },
  "audit.log.filter.to": { en: "To" },
  "audit.log.filter.apply": { en: "Filter" },
  "audit.log.filter.reset": { en: "Reset" },
  "audit.log.details": { en: "Details" },
  "audit.log.detail.loading": { en: "Loading event…" },
  "audit.log.detail.missing": { en: "Event not found." },
  "audit.log.detail.payload": { en: "Event payload" },
  "audit.log.detail.metadata": { en: "Metadata" },
  "audit.log.detail.field.id": { en: "Event ID" },
};
