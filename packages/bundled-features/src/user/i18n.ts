type LocalizedString = { readonly de: string; readonly en: string };

export const USER_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:user-list.title": { de: "Benutzer", en: "Users" },
  "screen:user-edit.title": { de: "Benutzer bearbeiten", en: "Edit user" },
  "user:entity:user:field:email": { de: "E-Mail", en: "Email" },
  "user:entity:user:field:displayName": { de: "Anzeigename", en: "Display name" },
  "user:entity:user:field:status": { de: "Status", en: "Status" },
  "user:entity:user:field:emailVerified": { de: "E-Mail bestätigt", en: "Email verified" },
  "user:entity:user:field:locale": { de: "Sprache", en: "Locale" },
  "user:entity:user:field:status:option:active": { de: "Aktiv", en: "Active" },
  "user:entity:user:field:status:option:restricted": { de: "Eingeschränkt", en: "Restricted" },
  "user:entity:user:field:status:option:deletionRequested": {
    de: "Löschung angefordert",
    en: "Deletion requested",
  },
  "user:entity:user:field:status:option:deleted": { de: "Gelöscht", en: "Deleted" },
  "user:entity:user:field:emailVerified:option:true": { de: "Ja", en: "Yes" },
  "user:entity:user:field:emailVerified:option:false": { de: "Nein", en: "No" },
};
