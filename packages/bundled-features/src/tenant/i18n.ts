type LocalizedString = { readonly en: string };

export const TENANT_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-list.title": { en: "Tenants" },
  "screen:tenant-edit.title": { en: "Edit tenant" },
  "screen:members.title": { en: "Team" },
  "tenant.nav.members": { en: "Team" },
  "tenant:entity:tenant:field:key": { en: "Key" },
  "tenant:entity:tenant:field:name": { en: "Name" },
  "tenant:entity:tenant:field:isEnabled": { en: "Enabled" },
  "tenant:entity:tenant:field:status": { en: "Status" },
  "tenant:entity:tenant:field:status:option:active": { en: "Active" },
  "tenant:entity:tenant:field:status:option:destroyRequested": {
    en: "Destroy requested",
  },
  "tenant:entity:tenant:field:status:option:destroying": {
    en: "Destroying",
  },
  "tenant:entity:tenant:field:status:option:destroyFailed": {
    en: "Destroy failed",
  },
  "tenant:entity:tenant:field:status:option:destroyed": { en: "Destroyed" },
  "tenant:entity:tenant:field:isEnabled:option:true": { en: "Yes" },
  "tenant:entity:tenant:field:isEnabled:option:false": { en: "No" },
};
