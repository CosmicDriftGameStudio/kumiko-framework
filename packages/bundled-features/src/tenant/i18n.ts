type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const TENANT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-list.title": { de: "Mandanten", en: "Tenants", es: "Organizaciones" },
  "screen:tenant-edit.title": {
    de: "Mandant bearbeiten",
    en: "Edit tenant",
    es: "Editar organización",
  },
  "screen:members.title": { de: "Team", en: "Team", es: "Equipo" },
  "tenant.nav.members": { de: "Team", en: "Team", es: "Equipo" },
  "tenant:entity:tenant:field:key": { de: "Schlüssel", en: "Key", es: "Clave" },
  "tenant:entity:tenant:field:name": { de: "Name", en: "Name", es: "Nombre" },
  "tenant:entity:tenant:field:isEnabled": { de: "Aktiv", en: "Enabled", es: "Activado" },
  "tenant:entity:tenant:field:status": { de: "Status", en: "Status", es: "Estado" },
  "tenant:entity:tenant:field:status:option:active": { de: "Aktiv", en: "Active", es: "Activo" },
  "tenant:entity:tenant:field:status:option:destroyRequested": {
    de: "Löschung angefordert",
    en: "Destroy requested",
    es: "Eliminación solicitada",
  },
  "tenant:entity:tenant:field:status:option:destroying": {
    de: "Wird gelöscht",
    en: "Destroying",
    es: "Eliminándose",
  },
  "tenant:entity:tenant:field:status:option:destroyFailed": {
    de: "Löschung fehlgeschlagen",
    en: "Destroy failed",
    es: "Eliminación fallida",
  },
  "tenant:entity:tenant:field:status:option:destroyed": {
    de: "Gelöscht",
    en: "Destroyed",
    es: "Eliminado",
  },
  "tenant:entity:tenant:field:isEnabled:option:true": { de: "Ja", en: "Yes", es: "Sí" },
  "tenant:entity:tenant:field:isEnabled:option:false": { de: "Nein", en: "No", es: "No" },
};
