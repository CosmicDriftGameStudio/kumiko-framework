// @runtime client
// Server + client i18n for the sessions operator screens.

type LocalizedString = { readonly en: string };

export const SESSIONS_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:session-list.title": { en: "Sessions" },
  "screen:session-detail.title": { en: "Session" },
  "sessions:nav.sessionList": { en: "Sessions" },
  "sessions.list.col.id": { en: "ID" },
  "sessions.list.col.userId": { en: "User ID" },
  "sessions.list.col.createdAt": { en: "Created" },
  "sessions.list.col.expiresAt": { en: "Expires" },
  "sessions.list.col.revokedAt": { en: "Revoked" },
  "sessions.list.action.open": { en: "Details" },
  "sessions.detail.field.id": { en: "ID" },
  "sessions.detail.field.userId": { en: "User ID" },
  "sessions.detail.field.createdAt": { en: "Created" },
  "sessions.detail.field.expiresAt": { en: "Expires" },
  "sessions.detail.field.revokedAt": { en: "Revoked" },
  "sessions.detail.field.ip": { en: "IP address" },
  "sessions.detail.field.userAgent": { en: "User agent" },
};
