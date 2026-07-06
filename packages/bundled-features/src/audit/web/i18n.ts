import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "audit.log.title": "Audit-Log",
    "audit.log.loading": "Lade Ereignisse…",
    "audit.log.empty": "Keine Ereignisse.",
    "audit.log.newest": "Neueste",
    "audit.log.older": "Ältere laden",
    "audit.log.col.when": "Zeit",
    "audit.log.col.type": "Ereignis",
    "audit.log.col.aggregate": "Aggregate",
    "audit.log.col.actor": "Akteur",
    "audit.nav.auditLog": "Audit",
  },
  en: {
    "audit.log.title": "Audit log",
    "audit.log.loading": "Loading events…",
    "audit.log.empty": "No events.",
    "audit.log.newest": "Newest",
    "audit.log.older": "Load older",
    "audit.log.col.when": "When",
    "audit.log.col.type": "Event",
    "audit.log.col.aggregate": "Aggregate",
    "audit.log.col.actor": "Actor",
    "audit.nav.auditLog": "Audit",
  },
};
