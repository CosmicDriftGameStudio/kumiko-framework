// @runtime client
// Server + client i18n for audit (nav labels + audit-log/-detail screens).

type LocalizedString = { readonly en: string };

export const AUDIT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:audit-log.title": { en: "Audit log" },
  "screen:audit-log-detail.title": { en: "Event" },
  "audit.log.description": {
    en: "Table of the tenant's audit events with actor names and event-type and date filters; open a row to see a single event.",
  },
  "audit.log.allTenants.description": {
    en: "Table of audit events across all tenants with tenant and actor names and tenant and date filters; open a row to see a single event.",
  },
  "audit.log.detail.subtitle": {
    en: "Read-only detail view of one audit event showing actor, timestamp, aggregate and the raw event payload and metadata; reached from a row of the audit log.",
  },
  "audit.errors.systemScopeRequiresSystemAdmin": {
    en: "Only SystemAdmin may read system events.",
  },
  "screen:audit-log-all-tenants.title": { en: "Audit log (all tenants)" },
  "screen:audit-log-all-tenants-detail.title": { en: "Event" },
  "audit:nav.auditLog": { en: "Audit" },
  "audit:nav.auditLogAllTenants": { en: "Audit log (all tenants)" },
  "audit.log.col.tenant": { en: "Tenant" },
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
