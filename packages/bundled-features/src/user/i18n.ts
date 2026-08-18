type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const USER_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:user-list.title": { de: "Benutzer", en: "Users", es: "Usuarios" },
  "screen:user-edit.title": { de: "Benutzer bearbeiten", en: "Edit user", es: "Editar usuario" },
  "user:entity:user:field:email": { de: "E-Mail", en: "Email", es: "Correo electrónico" },
  "user:entity:user:field:displayName": {
    de: "Anzeigename",
    en: "Display name",
    es: "Nombre para mostrar",
  },
  "user:entity:user:field:status": { de: "Status", en: "Status", es: "Estado" },
  "user:entity:user:field:emailVerified": {
    de: "E-Mail bestätigt",
    en: "Email verified",
    es: "Correo verificado",
  },
  "user:entity:user:field:locale": { de: "Sprache", en: "Locale", es: "Idioma" },
  "user:entity:user:field:timezone": { de: "Zeitzone", en: "Timezone", es: "Zona horaria" },
  "user:entity:user:field:status:option:active": { de: "Aktiv", en: "Active", es: "Activo" },
  "user:entity:user:field:status:option:restricted": {
    de: "Eingeschränkt",
    en: "Restricted",
    es: "Restringido",
  },
  "user:entity:user:field:status:option:deletionRequested": {
    de: "Löschung angefordert",
    en: "Deletion requested",
    es: "Eliminación solicitada",
  },
  "user:entity:user:field:status:option:deleted": {
    de: "Gelöscht",
    en: "Deleted",
    es: "Eliminado",
  },
  "user:entity:user:field:emailVerified:option:true": { de: "Ja", en: "Yes", es: "Sí" },
  "user:entity:user:field:emailVerified:option:false": { de: "Nein", en: "No", es: "No" },
};
