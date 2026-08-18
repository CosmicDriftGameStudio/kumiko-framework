// @runtime client
// Server + client i18n for the sessions operator screens.

type LocalizedString = { readonly de: string; readonly en: string };

export const SESSIONS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:session-list.title": { de: "Sitzungen", en: "Sessions" },
  "screen:session-detail.title": { de: "Sitzung", en: "Session" },
  "sessions:nav.sessionList": { de: "Sitzungen", en: "Sessions" },
  "sessions.list.col.id": { de: "ID", en: "ID" },
  "sessions.list.col.userId": { de: "User-ID", en: "User ID" },
  "sessions.list.col.createdAt": { de: "Erstellt", en: "Created" },
  "sessions.list.col.expiresAt": { de: "Läuft ab", en: "Expires" },
  "sessions.list.col.revokedAt": { de: "Widerrufen", en: "Revoked" },
  "sessions.list.action.open": { de: "Details", en: "Details" },
  "sessions.detail.field.id": { de: "ID", en: "ID" },
  "sessions.detail.field.userId": { de: "User-ID", en: "User ID" },
  "sessions.detail.field.createdAt": { de: "Erstellt", en: "Created" },
  "sessions.detail.field.expiresAt": { de: "Läuft ab", en: "Expires" },
  "sessions.detail.field.revokedAt": { de: "Widerrufen", en: "Revoked" },
  "sessions.detail.field.ip": { de: "IP-Adresse", en: "IP address" },
  "sessions.detail.field.userAgent": { de: "User-Agent", en: "User agent" },
};
