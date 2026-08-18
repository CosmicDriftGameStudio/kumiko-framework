// @runtime client
// Server + client i18n for audit (nav labels + AuditLogScreen).

type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const AUDIT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:audit-log.title": { de: "Audit-Log", en: "Audit log", es: "Registro de auditoría" },
  "screen:audit-log-detail.title": { de: "Ereignis", en: "Event", es: "Evento" },
  "audit:nav.auditLog": { de: "Audit", en: "Audit", es: "Auditoría" },
  "audit.log.title": { de: "Audit-Log", en: "Audit log", es: "Registro de auditoría" },
  "audit.log.loading": { de: "Lade Ereignisse…", en: "Loading events…", es: "Cargando eventos…" },
  "audit.log.empty": { de: "Keine Ereignisse.", en: "No events.", es: "No hay eventos." },
  "audit.log.newest": { de: "Neueste", en: "Newest", es: "Más recientes" },
  "audit.log.older": { de: "Ältere laden", en: "Load older", es: "Cargar más antiguos" },
  "audit.log.col.when": { de: "Zeit", en: "When", es: "Fecha" },
  "audit.log.col.type": { de: "Ereignis", en: "Event", es: "Evento" },
  "audit.log.col.aggregate": { de: "Aggregate", en: "Aggregate", es: "Agregado" },
  "audit.log.col.actor": { de: "Akteur", en: "Actor", es: "Actor" },
  "audit.log.filter.eventType": { de: "Ereignistyp", en: "Event type", es: "Tipo de evento" },
  "audit.log.filter.aggregateType": {
    de: "Aggregate-Typ",
    en: "Aggregate type",
    es: "Tipo de agregado",
  },
  "audit.log.filter.from": { de: "Von", en: "From", es: "Desde" },
  "audit.log.filter.to": { de: "Bis", en: "To", es: "Hasta" },
  "audit.log.filter.apply": { de: "Filtern", en: "Filter", es: "Filtrar" },
  "audit.log.filter.reset": { de: "Zurücksetzen", en: "Reset", es: "Restablecer" },
  "audit.log.details": { de: "Details", en: "Details", es: "Detalles" },
  "audit.log.detail.loading": {
    de: "Lade Ereignis…",
    en: "Loading event…",
    es: "Cargando evento…",
  },
  "audit.log.detail.missing": {
    de: "Ereignis nicht gefunden.",
    en: "Event not found.",
    es: "Evento no encontrado.",
  },
  "audit.log.detail.payload": {
    de: "Ereignis-Payload",
    en: "Event payload",
    es: "Payload del evento",
  },
  "audit.log.detail.metadata": { de: "Metadaten", en: "Metadata", es: "Metadatos" },
  "audit.log.detail.field.id": { de: "Ereignis-ID", en: "Event ID", es: "ID del evento" },
};
