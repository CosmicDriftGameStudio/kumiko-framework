// @runtime client
// Server + client i18n for the sessions operator screens.

type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const SESSIONS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:session-list.title": { de: "Sitzungen", en: "Sessions", es: "Sesiones" },
  "screen:session-detail.title": { de: "Sitzung", en: "Session", es: "Sesión" },
  "sessions:nav.sessionList": { de: "Sitzungen", en: "Sessions", es: "Sesiones" },
  "sessions.list.col.id": { de: "ID", en: "ID", es: "ID" },
  "sessions.list.col.userId": { de: "User-ID", en: "User ID", es: "ID de usuario" },
  "sessions.list.col.createdAt": { de: "Erstellt", en: "Created", es: "Creado" },
  "sessions.list.col.expiresAt": { de: "Läuft ab", en: "Expires", es: "Caduca" },
  "sessions.list.col.revokedAt": { de: "Widerrufen", en: "Revoked", es: "Revocado" },
  "sessions.list.action.open": { de: "Details", en: "Details", es: "Detalles" },
  "sessions.detail.field.id": { de: "ID", en: "ID", es: "ID" },
  "sessions.detail.field.userId": { de: "User-ID", en: "User ID", es: "ID de usuario" },
  "sessions.detail.field.createdAt": { de: "Erstellt", en: "Created", es: "Creado" },
  "sessions.detail.field.expiresAt": { de: "Läuft ab", en: "Expires", es: "Caduca" },
  "sessions.detail.field.revokedAt": { de: "Widerrufen", en: "Revoked", es: "Revocado" },
  "sessions.detail.field.ip": { de: "IP-Adresse", en: "IP address", es: "Dirección IP" },
  "sessions.detail.field.userAgent": {
    de: "User-Agent",
    en: "User agent",
    es: "Agente de usuario",
  },
};
