type LocalizedString = { readonly de: string; readonly en: string };

export const TENANT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-list.title": { de: "Mandanten", en: "Tenants" },
  "screen:tenant-edit.title": { de: "Mandant bearbeiten", en: "Edit tenant" },
  "screen:members.title": { de: "Team", en: "Team" },
  "tenant.nav.members": { de: "Team", en: "Team" },
  "tenant:entity:tenant:field:key": { de: "Schlüssel", en: "Key" },
  "tenant:entity:tenant:field:name": { de: "Name", en: "Name" },
  "tenant:entity:tenant:field:isEnabled": { de: "Aktiv", en: "Enabled" },
  "tenant:entity:tenant:field:status": { de: "Status", en: "Status" },
  "tenant:entity:tenant:field:status:option:active": { de: "Aktiv", en: "Active" },
  "tenant:entity:tenant:field:status:option:destroyRequested": {
    de: "Löschung angefordert",
    en: "Destroy requested",
  },
  "tenant:entity:tenant:field:status:option:destroying": {
    de: "Wird gelöscht",
    en: "Destroying",
  },
  "tenant:entity:tenant:field:status:option:destroyFailed": {
    de: "Löschung fehlgeschlagen",
    en: "Destroy failed",
  },
  "tenant:entity:tenant:field:status:option:destroyed": { de: "Gelöscht", en: "Destroyed" },
  "tenant:entity:tenant:field:isEnabled:option:true": { de: "Ja", en: "Yes" },
  "tenant:entity:tenant:field:isEnabled:option:false": { de: "Nein", en: "No" },
};
