// @runtime client
// Server + client i18n for audit (nav labels + AuditLogScreen).

type LocalizedString = { readonly de: string; readonly en: string };

export const AUDIT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:audit-log.title": { de: "Audit-Log", en: "Audit log" },
  "audit:nav.auditLog": { de: "Audit", en: "Audit" },
  "audit.log.title": { de: "Audit-Log", en: "Audit log" },
  "audit.log.loading": { de: "Lade Ereignisse…", en: "Loading events…" },
  "audit.log.empty": { de: "Keine Ereignisse.", en: "No events." },
  "audit.log.newest": { de: "Neueste", en: "Newest" },
  "audit.log.older": { de: "Ältere laden", en: "Load older" },
  "audit.log.col.when": { de: "Zeit", en: "When" },
  "audit.log.col.type": { de: "Ereignis", en: "Event" },
  "audit.log.col.aggregate": { de: "Aggregate", en: "Aggregate" },
  "audit.log.col.actor": { de: "Akteur", en: "Actor" },
  "audit.log.filter.eventType": { de: "Ereignistyp", en: "Event type" },
  "audit.log.filter.aggregateType": { de: "Aggregate-Typ", en: "Aggregate type" },
  "audit.log.filter.from": { de: "Von", en: "From" },
  "audit.log.filter.to": { de: "Bis", en: "To" },
  "audit.log.filter.apply": { de: "Filtern", en: "Filter" },
  "audit.log.filter.reset": { de: "Zurücksetzen", en: "Reset" },
  "audit.log.details": { de: "Details", en: "Details" },
  "audit.log.detail.title": { de: "Ereignis-Payload", en: "Event payload" },
  "audit.log.detail.close": { de: "Schließen", en: "Close" },
};
